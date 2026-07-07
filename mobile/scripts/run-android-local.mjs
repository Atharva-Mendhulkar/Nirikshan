#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(scriptDir);
const port = Number(process.env.RCT_METRO_PORT || process.env.METRO_PORT || 8081);
const sdkRoot =
  process.env.ANDROID_HOME ||
  process.env.ANDROID_SDK_ROOT ||
  join(homedir(), 'Library', 'Android', 'sdk');
const javaHome =
  process.env.JAVA_HOME ||
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
const reactNativeBin = join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'react-native.cmd' : 'react-native',
);

const env = {
  ...process.env,
  ANDROID_HOME: sdkRoot,
  ANDROID_SDK_ROOT: sdkRoot,
  JAVA_HOME: javaHome,
  RCT_METRO_PORT: String(port),
  PATH: [
    join(sdkRoot, 'platform-tools'),
    join(sdkRoot, 'emulator'),
    process.env.PATH,
  ]
    .filter(Boolean)
    .join(':'),
};

async function main() {
  if (!existsSync(reactNativeBin)) {
    throw new Error('React Native CLI not found. Run `npm install` first.');
  }

  await ensureMetro();
  await waitForOfflineDeviceToRecover();
  await runReactNativeAndroid();
}

async function ensureMetro() {
  if (await isMetroReady()) {
    console.log(`Metro is already running on port ${port}.`);
    return;
  }

  if (await isPortOpen(port)) {
    throw new Error(
      `Port ${port} is in use, but it does not look like Metro. Stop that process or set RCT_METRO_PORT.`,
    );
  }

  const logDir = join(projectRoot, '.nirikshan');
  const logPath = join(logDir, 'metro.log');
  mkdirSync(logDir, { recursive: true });

  const logFd = openSync(logPath, 'a');
  const child = spawn(reactNativeBin, ['start', '--port', String(port)], {
    cwd: projectRoot,
    detached: true,
    env,
    stdio: ['ignore', logFd, logFd],
  });
  child.unref();
  closeSync(logFd);

  console.log(`Started Metro on port ${port}. Logs: ${logPath}`);
  await waitUntil(isMetroReady, 60000, 500, 'Metro did not become ready in 60s');
}

async function waitForOfflineDeviceToRecover() {
  const devices = await getAdbDevices();
  const hasOnlineDevice = devices.some(device => device.state === 'device');
  const hasOfflineDevice = devices.some(device => device.state === 'offline');

  if (!hasOfflineDevice || hasOnlineDevice) {
    return;
  }

  console.log('Android device is offline; waiting for ADB to report it as ready...');
  await waitUntil(async () => {
    const nextDevices = await getAdbDevices();
    return nextDevices.some(device => device.state === 'device');
  }, 60000, 1000, 'Android device stayed offline for 60s. Finish emulator boot, then rerun `npm run android`.');
}

async function getAdbDevices() {
  try {
    const result = await capture('adb', ['devices']);
    return result
      .split('\n')
      .slice(1)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [id, state] = line.split(/\s+/);
        return { id, state };
      });
  } catch {
    return [];
  }
}

async function runReactNativeAndroid() {
  const userArgs = process.argv.slice(2).filter(arg => arg !== '--no-packager');
  const args = ['run-android', '--no-packager', ...userArgs];

  await new Promise((resolve, reject) => {
    const child = spawn(reactNativeBin, args, {
      cwd: projectRoot,
      env,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`react-native ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function isMetroReady() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(1000),
    });
    const text = await response.text();
    return text.includes('packager-status:running');
  } catch {
    return false;
  }
}

async function isPortOpen(targetPort) {
  return new Promise(resolve => {
    const socket = createConnection({ host: '127.0.0.1', port: targetPort });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(stderr || `${command} exited with code ${code}`));
      }
    });
  });
}

async function waitUntil(predicate, timeoutMs, intervalMs, timeoutMessage) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(timeoutMessage);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
