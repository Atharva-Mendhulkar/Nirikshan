# Nirikshan Model Assets

Raw source model artifacts are downloaded into `models/raw/`. This directory is
ignored by git because model files are large and may have license constraints.

## Download

```sh
python3 scripts/download_models.py
```

Downloaded artifacts:

| Purpose | Local file | Source |
|---|---|---|
| Face detection | `models/raw/face_detection_yunet_2023mar.onnx` | OpenCV Zoo YuNet: <https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet> |
| Liveness | `models/raw/minifasnet_v2.onnx` | MiniFASNet-V2 ONNX conversion: <https://huggingface.co/garciafido/minifasnet-v2-anti-spoofing-onnx> |
| Liveness provenance | `models/raw/2.7_80x80_MiniFASNetV2.pth` | minivision-ai upstream weight: <https://github.com/minivision-ai/Silent-Face-Anti-Spoofing> |
| Recognition pack | `models/raw/buffalo_s.zip` | InsightFace v0.7 release: <https://github.com/deepinsight/insightface/releases/tag/v0.7> |
| Recognition | `models/raw/w600k_mbf.onnx` | extracted from `buffalo_s.zip` |

The downloader writes `models/raw/MANIFEST.json` with sizes and SHA-256 hashes.

The raw and converted model folders are ignored by git. Recreate them locally
with the commands in this file.

## Inspect Tensor Shapes

```sh
python3 scripts/inspect_onnx_models.py
```

Validated source ONNX metadata:

| Model | Input | Output |
|---|---|---|
| YuNet | `[1, 3, 640, 640]` | 12 tensors: cls/obj/bbox/kps for strides 8, 16, 32 |
| MiniFASNetV2 | `[batch, 3, 80, 80]` | `[batch, 3]` |
| buffalo_s MBF | `[batch, 3, 112, 112]` | `[1, 512]` |

## Convert And Install

Create the conversion environment once:

```sh
uv venv --python python3.11 .venv-models
uv pip install --python .venv-models/bin/python \
  'tensorflow>=2.16,<2.21' onnx onnxruntime onnx2tf tf-keras \
  onnxsim onnx-graphsurgeon sng4onnx onnx2json ai-edge-litert psutil \
  opencv-python
```

Convert, validate, and install float32 TFLite files:

```sh
.venv-models/bin/python scripts/convert_models.py --install
```

The install step validates ONNX-vs-TFLite parity before copying files to:

```text
mobile/src/assets/models/yunet_detector.tflite
mobile/src/assets/models/minifasnet_v2.tflite
mobile/src/assets/models/mobilefacenet_arcface.tflite
```

Then run:

```sh
cd mobile
npm run model:gate:strict
```

## Validated TFLite Metadata

The current converted files are float32 TFLite models with NHWC inputs:

| Model | TFLite input | Output | Max abs diff vs ONNX |
|---|---|---|---|
| YuNet | `[1, 640, 640, 3]` | 12 tensors: cls/obj/bbox/kps | `5.245208740234375e-06` |
| MiniFASNetV2 | `[1, 80, 80, 3]` | `[1, 3]` | `7.152557373046875e-07` |
| buffalo_s MBF | `[1, 112, 112, 3]` | `[1, 512]` | `3.993511199951172e-06` |

The validation report is written to `models/converted/VALIDATION.json`.

## Current Conversion Notes

- YuNet is officially distributed as ONNX by OpenCV Zoo. TFLite conversion must
  preserve the 12 output tensors and postprocess decoder assumptions.
- The source ONNX models use NCHW. The converted TFLite models expose NHWC
  float32 inputs.
- The Python score runner uses OpenCV-style YuNet decoding, BGR detector input
  in `0..255`, BGR liveness crops in `0..255`, and ArcFace RGB aligned crops
  normalized to `[-1, 1]`.
- MiniFASNetV2 uses `80x80` input and 3 classes. The score runner defaults to
  live class index `1`, which matched the local smoke test; confirm this on the
  real/print/screen dev split before final reporting.
- buffalo_s MBF outputs 512-dimensional embeddings. The mobile app must
  normalize the output before cosine matching.
- VisionCamera Resizer float32 output is normalized, so the Android real-frame
  path still needs explicit per-model preprocessing before switching
  `MODEL_MODE` away from `mock`.
- Use Python 3.10 or 3.11 for conversion tooling; Python 3.14 is too new for
  many TensorFlow conversion packages.
