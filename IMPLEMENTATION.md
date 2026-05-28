# Nirikshan Implementation

This repository now contains an Android-first MVP scaffold.

## Layout

- `mobile/`: React Native 0.85 app with VisionCamera v5, fast-tflite v3,
  OP-SQLite, Keychain-backed encryption, local matching, tests, and model gate
  tooling.
- `backend/`: AWS SAM HTTP API, Lambda, and DynamoDB event sync backend.

## Mobile

```sh
cd mobile
npm install
npm run validate
npm start
npm run android
```

The app defaults to deterministic mock embeddings because the real model files
are placeholders. Replace the files in `mobile/src/assets/models/`, then run:

```sh
npm run model:gate:strict
```

Set `SYNC_API_BASE_URL` in `mobile/src/config/runtime.ts` after deploying the
backend.

## Backend

```sh
cd backend
npm install
npm test
npm run deploy:guided
```

Copy the `SyncApiUrl` output into the mobile runtime config.

## Current Known Gaps

- Real YuNet/MiniFASNet/MobileFaceNet assets are not included.
- Real frame post-processing is scaffolded but not wired into the camera loop
  until validated model tensor shapes are available.
- Android build verification requires a local Android SDK via `ANDROID_HOME` or
  `mobile/android/local.properties`.
