# Nirikshan ML Evaluation

This folder-level workflow turns the PRD targets into repeatable reports.

## Current Scope

`scripts/run_tflite_scores.py` generates model scores from image manifests using
the installed TFLite assets. `scripts/evaluate.py` then evaluates the generated
score columns. That separation is intentional:

- score evaluation can be validated before real models are available;
- the same `scores.csv`, `metrics.json`, and `thresholds.json` format can be
  reused for desktop image runs and later Android benchmark exports;
- conversion parity can be checked independently from dataset quality.

## Runtime Correction

The PRD runtime stack should follow the implemented app:

- React Native 0.85.x
- VisionCamera v5
- `react-native-fast-tflite` v3/Nitro
- `@op-engineering/op-sqlite`
- `react-native-keychain`

Older references to VisionCamera v4, `react-native-quick-sqlite`, and
`react-native-encrypted-storage` should be treated as superseded.

## Manifest

Use `data/manifest.example.csv` as the template. Required identity columns:

```csv
sample_id,user_id,path,label,attack_type,condition,split
```

The evaluator currently also expects precomputed score columns:

```csv
detection_success,landmark_success,liveness_score,embedding_generated,best_match_user,best_match_score,detection_latency_ms,liveness_latency_ms,recognition_latency_ms,total_latency_ms
```

Allowed values:

- `label`: `real`, `spoof`
- `attack_type`: `none`, `print`, `screen`, `unknown`
- `split`: `train`, `dev`, `test`

Tune thresholds only on `dev`. Report final metrics from `test`.

## Generate Scores

Install the runner dependency in the model environment:

```sh
uv pip install --python .venv-models/bin/python opencv-python
```

Use `split=train` real rows as the enrollment gallery, then score all rows:

```sh
.venv-models/bin/python scripts/run_tflite_scores.py \
  --manifest data/manifest.csv \
  --output reports/eval-run-001/scores.csv \
  --enrollment-split train
```

Runner defaults:

- YuNet detector threshold: `0.6`
- YuNet preprocessing: BGR `0..255`, direct resize to `640x640`
- face minimum size ratio: `0.18`
- brightness range: `40..220`
- MiniFASNet preprocessing: BGR `0..255`, `2.7x` expanded face crop
- MiniFASNet live class index: `1`
- liveness threshold: `0.72`
- recognition preprocessing: ArcFace 5-point aligned crop, RGB normalized to
  `[-1, 1]`
- recognition threshold: `0.75`

The live class index, color order, and normalization must still be verified on
collected real/print/screen samples before final reporting.

## Evaluate Scores

```sh
python3 scripts/evaluate.py \
  --manifest reports/eval-run-001/scores.csv \
  --output reports/eval-run-001/report
```

Outputs:

- `metrics.json`
- `scores.csv`
- `thresholds.json`
- `summary.md`

## Metrics

Detection:

- detection success rate
- no-face rate if `detection_reason` is supplied
- multiple-face rate if `detection_reason` is supplied
- landmark availability rate

Liveness:

- APCER
- BPCER
- ACER
- ROC AUC

Recognition:

- FAR
- FRR
- EER
- TAR at FAR 1%
- TAR at FAR 0.1%
- genuine/impostor similarity distributions

End to end:

- real accept rate
- spoof reject rate
- p50/p95 total latency
- decision counts

## Current Runner Scope

The runner handles static image manifests. It does not yet process videos,
export Android live-frame benchmark logs, or tune preprocessing automatically.

See `docs/MODELS.md` for the raw source model download and tensor inspection
workflow.
