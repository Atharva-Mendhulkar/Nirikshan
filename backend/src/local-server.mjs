import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const defaultDataFile = join(backendRoot, '.local', 'events.json');
const maxBodyBytes = 1024 * 1024;

export function createLocalSyncServer({ dataFile = defaultDataFile } = {}) {
  return createServer(async (request, response) => {
    try {
      response.setHeader('access-control-allow-origin', '*');
      response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      response.setHeader('access-control-allow-headers', 'content-type');

      if (request.method === 'OPTIONS') {
        sendJson(response, 204, {});
        return;
      }

      const url = new URL(request.url ?? '/', 'http://localhost');

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, { ok: true, mode: 'local' });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/sync/events') {
        const events = await readLocalEvents(dataFile);
        sendJson(response, 200, { count: events.length, events });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/sync/events') {
        const body = await readJsonBody(request);
        const events = Array.isArray(body.events) ? body.events : [];

        if (events.length === 0) {
          sendJson(response, 400, { error: 'events_required' });
          return;
        }

        for (const event of events) {
          validateEvent(event);
        }

        const result = await upsertLocalEvents(events, dataFile);
        sendJson(response, 200, result);
        return;
      }

      sendJson(response, 404, { error: 'not_found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    }
  });
}

export async function readLocalEvents(dataFile = defaultDataFile) {
  try {
    const contents = await readFile(dataFile, 'utf8');
    const parsed = JSON.parse(contents);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function upsertLocalEvents(events, dataFile = defaultDataFile) {
  const existing = await readLocalEvents(dataFile);
  const byId = new Map(existing.map(event => [String(event.event_id), event]));
  let inserted = 0;

  for (const event of events) {
    const eventId = String(event.event_id);
    if (!byId.has(eventId)) {
      byId.set(eventId, {
        ...event,
        event_id: eventId,
        received_at: Date.now(),
      });
      inserted += 1;
    }
  }

  const nextEvents = [...byId.values()].sort((a, b) => {
    return Number(a.timestamp ?? 0) - Number(b.timestamp ?? 0);
  });

  await mkdir(dirname(dataFile), { recursive: true });
  await writeFile(dataFile, `${JSON.stringify(nextEvents, null, 2)}\n`);

  return {
    synced: events.length,
    inserted,
    duplicates: events.length - inserted,
    event_ids: events.map(event => String(event.event_id)),
  };
}

async function readJsonBody(request) {
  let size = 0;
  const chunks = [];

  for await (const chunk of request) {
    size += chunk.byteLength;
    if (size > maxBodyBytes) {
      throw new Error('request_body_too_large');
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateEvent(event) {
  for (const field of ['event_id', 'device_id', 'result', 'timestamp']) {
    if (event[field] === undefined || event[field] === null) {
      throw new Error(`missing_${field}`);
    }
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, { 'content-type': 'application/json' });
  response.end(statusCode === 204 ? undefined : JSON.stringify(body));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3001);
  createLocalSyncServer().listen(port, '0.0.0.0', () => {
    console.log(`Nirikshan local sync listening on http://localhost:${port}`);
    console.log(`Android emulator URL: http://10.0.2.2:${port}`);
  });
}
