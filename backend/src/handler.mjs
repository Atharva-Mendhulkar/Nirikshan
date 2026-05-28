import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({});
const tableName = process.env.EVENTS_TABLE;

export async function handler(event) {
  try {
    const method = event.requestContext?.http?.method ?? event.httpMethod;
    const path = event.rawPath ?? event.path ?? '/';

    if (method === 'GET' && path === '/health') {
      return json(200, { ok: true });
    }

    if (method === 'POST' && path === '/sync/events') {
      return await syncEvents(event);
    }

    return json(404, { error: 'not_found' });
  } catch (error) {
    console.error(error);
    return json(500, { error: 'internal_error' });
  }
}

async function syncEvents(event) {
  if (!tableName) {
    return json(500, { error: 'missing_events_table' });
  }

  const body = parseBody(event.body);
  const events = Array.isArray(body.events) ? body.events : [];
  if (events.length === 0) {
    return json(400, { error: 'events_required' });
  }

  for (const authEvent of events) {
    validateEvent(authEvent);
    await client.send(
      new PutItemCommand({
        TableName: tableName,
        Item: toDynamoItem(authEvent),
      }),
    );
  }

  return json(200, {
    synced: events.length,
    event_ids: events.map(authEvent => authEvent.event_id),
  });
}

function parseBody(body) {
  if (typeof body !== 'string' || body.length === 0) {
    return {};
  }
  return JSON.parse(body);
}

function validateEvent(authEvent) {
  for (const field of ['event_id', 'device_id', 'result', 'timestamp']) {
    if (authEvent[field] === undefined || authEvent[field] === null) {
      throw new Error(`missing_${field}`);
    }
  }
}

function toDynamoItem(authEvent) {
  return {
    event_id: { S: String(authEvent.event_id) },
    device_id: { S: String(authEvent.device_id) },
    result: { S: String(authEvent.result) },
    timestamp: { N: String(authEvent.timestamp) },
    received_at: { N: String(Date.now()) },
    user_id: nullableString(authEvent.user_id),
    user_name: nullableString(authEvent.user_name),
    confidence: nullableNumber(authEvent.confidence),
    liveness_score: nullableNumber(authEvent.liveness_score),
    latency_ms: nullableNumber(authEvent.latency_ms),
  };
}

function nullableString(value) {
  return value == null ? { NULL: true } : { S: String(value) };
}

function nullableNumber(value) {
  return value == null ? { NULL: true } : { N: String(value) };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}
