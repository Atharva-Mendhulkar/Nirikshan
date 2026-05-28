import fs from 'node:fs';
import path from 'node:path';

const settingsPath = path.join(
  process.cwd(),
  'node_modules',
  '@react-native',
  'gradle-plugin',
  'settings.gradle.kts',
);

if (!fs.existsSync(settingsPath)) {
  process.exit(0);
}

const original = fs.readFileSync(settingsPath, 'utf8');
const patched = original.replace(
  'org.gradle.toolchains.foojay-resolver-convention").version("0.5.0"',
  'org.gradle.toolchains.foojay-resolver-convention").version("1.0.0"',
);

if (patched !== original) {
  fs.writeFileSync(settingsPath, patched);
  console.log('Patched React Native Gradle plugin foojay resolver to 1.0.0');
}
