#!/usr/bin/env python3
"""Convert downloaded ONNX models to TFLite.

Prerequisites:
  uv venv --python python3.11 .venv-models
  uv pip install --python .venv-models/bin/python \
    'tensorflow>=2.16,<2.21' onnx onnxruntime onnx2tf tf-keras \
    onnxsim onnx-graphsurgeon sng4onnx onnx2json ai-edge-litert psutil

Run:
  python3 scripts/convert_models.py

Raw and converted model folders are ignored by git.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
VENV_BIN = ROOT / ".venv-models" / "bin"
ONNX2TF = VENV_BIN / "onnx2tf"
CALIBRATION_FILE = ROOT / "calibration_image_sample_data_20x128x128x3_float32.npy"


@dataclass(frozen=True)
class ModelConversion:
    id: str
    source: Path
    output_dir: Path
    input_shape_arg: str
    generated_float32: Path
    mobile_target: Path


MODELS = [
    ModelConversion(
        id="detector",
        source=ROOT / "models/raw/face_detection_yunet_2023mar.onnx",
        output_dir=ROOT / "models/converted/yunet",
        input_shape_arg="input:1,3,640,640",
        generated_float32=ROOT
        / "models/converted/yunet/face_detection_yunet_2023mar_float32.tflite",
        mobile_target=ROOT / "mobile/src/assets/models/yunet_detector.tflite",
    ),
    ModelConversion(
        id="liveness",
        source=ROOT / "models/raw/minifasnet_v2.onnx",
        output_dir=ROOT / "models/converted/minifasnet_v2",
        input_shape_arg="input:1,3,80,80",
        generated_float32=ROOT
        / "models/converted/minifasnet_v2/minifasnet_v2_float32.tflite",
        mobile_target=ROOT / "mobile/src/assets/models/minifasnet_v2.tflite",
    ),
    ModelConversion(
        id="recognition",
        source=ROOT / "models/raw/w600k_mbf.onnx",
        output_dir=ROOT / "models/converted/w600k_mbf",
        input_shape_arg="input.1:1,3,112,112",
        generated_float32=ROOT
        / "models/converted/w600k_mbf/w600k_mbf_float32.tflite",
        mobile_target=ROOT / "mobile/src/assets/models/mobilefacenet_arcface.tflite",
    ),
]


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert ONNX model files to TFLite.")
    parser.add_argument(
        "--install",
        action="store_true",
        help="Validate and copy float32 TFLite files into mobile/src/assets/models.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Remove existing converted output folders before converting.",
    )
    args = parser.parse_args()

    ensure_converter_ready()
    ensure_calibration_file()

    for model in MODELS:
        convert_model(model, force=args.force)

    print("Conversion complete.")

    if args.install:
        validate_conversions()
        install_models()
    else:
        print("Run: .venv-models/bin/python scripts/validate_tflite_models.py")

    return 0


def ensure_converter_ready() -> None:
    if not ONNX2TF.exists():
        raise SystemExit(
            f"Missing {ONNX2TF.relative_to(ROOT)}. Create .venv-models and install "
            "conversion dependencies first."
        )

    missing = [model.source.relative_to(ROOT) for model in MODELS if not model.source.exists()]
    if missing:
        raise SystemExit(
            "Missing raw model files. Run scripts/download_models.py first: "
            f"{missing}"
        )


def ensure_calibration_file() -> None:
    if CALIBRATION_FILE.exists():
        return
    rng = np.random.default_rng(42)
    data = rng.random((20, 128, 128, 3), dtype=np.float32)
    np.save(CALIBRATION_FILE, data)
    print(f"Wrote {CALIBRATION_FILE.relative_to(ROOT)}")


def convert_model(model: ModelConversion, force: bool) -> None:
    if force and model.output_dir.exists():
        shutil.rmtree(model.output_dir)

    if model.generated_float32.exists():
        print(f"Using existing {model.generated_float32.relative_to(ROOT)}")
        return

    model.output_dir.parent.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["PATH"] = f"{VENV_BIN}:{env['PATH']}"
    command = [
        str(ONNX2TF),
        "-i",
        str(model.source),
        "-o",
        str(model.output_dir),
        "-b",
        "1",
        "-ois",
        model.input_shape_arg,
        "-v",
        "warn",
    ]
    print(f"Converting {model.id}: {model.source.relative_to(ROOT)}")
    subprocess.run(command, cwd=ROOT, env=env, check=True)

    if not model.generated_float32.exists():
        raise SystemExit(
            f"Conversion did not produce {model.generated_float32.relative_to(ROOT)}"
        )


def install_models() -> None:
    for model in MODELS:
        if not model.generated_float32.exists():
            raise SystemExit(
                f"Cannot install missing {model.generated_float32.relative_to(ROOT)}"
            )
        shutil.copyfile(model.generated_float32, model.mobile_target)
        print(
            f"Installed {model.generated_float32.relative_to(ROOT)} -> "
            f"{model.mobile_target.relative_to(ROOT)}"
        )


def validate_conversions() -> None:
    validation_script = ROOT / "scripts/validate_tflite_models.py"
    command = [sys.executable, str(validation_script)]
    print("Validating converted TFLite files before install")
    subprocess.run(command, cwd=ROOT, check=True)


if __name__ == "__main__":
    raise SystemExit(main())
