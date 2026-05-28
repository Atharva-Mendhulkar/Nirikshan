import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from './handler.mjs';

test('health endpoint responds ok without DynamoDB', async () => {
  const response = await handler({
    rawPath: '/health',
    requestContext: { http: { method: 'GET' } },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });
});
