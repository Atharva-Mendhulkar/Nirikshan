import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createLocalSyncServer } from './local-server.mjs';

test('local sync server stores events idempotently', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'nirikshan-local-sync-'));
  const server = createLocalSyncServer({
    dataFile: join(tempDir, 'events.json'),
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, mode: 'local' });

    const payload = {
      events: [
        {
          event_id: 'evt_local_1',
          device_id: 'device_local',
          user_id: 'user_local',
          user_name: 'Local User',
          result: 'authenticated',
          confidence: 0.91,
          liveness_score: 0.98,
          latency_ms: 42,
          timestamp: 1710000000000,
        },
      ],
    };

    const firstSync = await postEvents(baseUrl, payload);
    assert.equal(firstSync.synced, 1);
    assert.equal(firstSync.inserted, 1);
    assert.equal(firstSync.duplicates, 0);

    const secondSync = await postEvents(baseUrl, payload);
    assert.equal(secondSync.synced, 1);
    assert.equal(secondSync.inserted, 0);
    assert.equal(secondSync.duplicates, 1);

    const storedResponse = await fetch(`${baseUrl}/sync/events`);
    const stored = await storedResponse.json();
    assert.equal(stored.count, 1);
    assert.equal(stored.events[0].event_id, 'evt_local_1');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(tempDir, { recursive: true, force: true });
  }
});

async function postEvents(baseUrl, payload) {
  const response = await fetch(`${baseUrl}/sync/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  assert.equal(response.status, 200);
  return response.json();
}
