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
npm run android
```

`npm run android` starts Metro automatically when port 8081 is free, waits for
the packager to become ready, and then installs the Android debug app. Metro
logs are written to `mobile/.nirikshan/metro.log`.

The app defaults to deterministic mock embeddings while the real frame
post-processing path is completed. Validated float32 TFLite assets are installed
in `mobile/src/assets/models/`; rerun the asset gate after replacing them:

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

- Real YuNet/MiniFASNet/MobileFaceNet assets are installed locally, but model
  files are not checked into source control history intentionally until final
  licensing and size decisions are made.
- Real frame post-processing is scaffolded but not wired into the camera loop
  until YuNet decoding, alignment, liveness class order, and recognition
  preprocessing are validated on real samples.
- Android build verification requires a local Android SDK via `ANDROID_HOME` or
  `mobile/android/local.properties`.

## ML Evaluation

The PRD-backed score runner and evaluator live at `scripts/run_tflite_scores.py`
and `scripts/evaluate.py`.

```sh
.venv-models/bin/python scripts/run_tflite_scores.py \
  --manifest data/manifest.csv \
  --output reports/eval-run-001/scores.csv \
  --enrollment-split train
python3 scripts/evaluate.py \
  --manifest reports/eval-run-001/scores.csv \
  --output reports/eval-run-001/report
```

For harness-only validation without real images, use `data/manifest.example.csv`.
See `docs/ML_EVALUATION.md` for the manifest schema, metrics, and runner scope.

Raw source model downloads are handled by:

```sh
python3 scripts/download_models.py
python3 scripts/inspect_onnx_models.py
.venv-models/bin/python scripts/convert_models.py --install
```

See `docs/MODELS.md` for source files, validated tensor shapes, and conversion
targets.
