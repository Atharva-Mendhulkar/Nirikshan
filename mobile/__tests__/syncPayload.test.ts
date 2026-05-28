import { buildSyncPayload } from '../src/sync/payload';

test('sync payload uses idempotent event ids', () => {
  const payload = buildSyncPayload([
    {
      id: 'evt_1',
      deviceId: 'dev_1',
      result: 'authenticated',
      userId: 'usr_1',
      userName: 'User One',
      confidence: 0.91,
      livenessScore: 0.98,
      latencyMs: 87,
      timestamp: 123,
      synced: false,
    },
  ]);

  expect(payload.events[0]).toEqual({
    event_id: 'evt_1',
    device_id: 'dev_1',
    user_id: 'usr_1',
    user_name: 'User One',
    result: 'authenticated',
    confidence: 0.91,
    liveness_score: 0.98,
    latency_ms: 87,
    timestamp: 123,
  });
});
