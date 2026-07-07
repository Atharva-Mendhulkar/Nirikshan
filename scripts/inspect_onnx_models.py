#!/usr/bin/env python3
"""Inspect downloaded ONNX model input/output tensor metadata."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW_MODELS = [
    ROOT / "models/raw/face_detection_yunet_2023mar.onnx",
    ROOT / "models/raw/minifasnet_v2.onnx",
    ROOT / "models/raw/w600k_mbf.onnx",
]


def main() -> int:
    try:
        import onnxruntime as ort
    except ImportError as error:
        raise SystemExit(
            "onnxruntime is required. Install it with: "
            "python3 -m pip install onnxruntime"
        ) from error

    report = []
    for path in RAW_MODELS:
        if not path.exists():
            raise SystemExit(
                f"Missing {path.relative_to(ROOT)}. Run scripts/download_models.py first."
            )

        session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
        report.append(
            {
                "path": str(path.relative_to(ROOT)),
                "inputs": [tensor_info(item) for item in session.get_inputs()],
                "outputs": [tensor_info(item) for item in session.get_outputs()],
            }
        )

    print(json.dumps(report, indent=2))
    return 0


def tensor_info(item) -> dict[str, object]:
    return {
        "name": item.name,
        "shape": item.shape,
        "type": item.type,
    }


if __name__ == "__main__":
    raise SystemExit(main())
