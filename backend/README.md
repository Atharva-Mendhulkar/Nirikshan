# Nirikshan Sync Backend

Minimal sync backend for the Android MVP.

## Local Test Server

Run this before tapping Sync in the Android app:

```sh
npm install
npm run dev
```

The local server listens on:

- Mac/browser: `http://localhost:3001`
- Android emulator: `http://10.0.2.2:3001`

The debug mobile app is already configured to use `http://10.0.2.2:3001`.
Synced events are stored locally in `.local/events.json`.

Useful checks:

```sh
curl http://localhost:3001/health
curl http://localhost:3001/sync/events
```

## Deploy

```sh
npm install
npm run deploy:guided
```

After deployment, copy the `SyncApiUrl` output into
`mobile/src/config/runtime.ts` as `SYNC_API_BASE_URL`.

## Endpoints

- `GET /health`
- `POST /sync/events`

`POST /sync/events` expects:

```json
{
  "events": [
    {
      "event_id": "evt_...",
      "device_id": "dev_...",
      "user_id": "usr_...",
      "user_name": "User One",
      "result": "authenticated",
      "confidence": 0.91,
      "liveness_score": 0.98,
      "latency_ms": 87,
      "timestamp": 1779970000000
    }
  ]
}
```
