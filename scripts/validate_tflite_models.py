#!/usr/bin/env python3
"""Validate converted TFLite models against their source ONNX models.

This is a numerical parity check for the conversion step. It does not prove
model quality; it proves the converted TFLite files preserve the source ONNX
graph outputs for deterministic synthetic inputs.
"""

from __future__ import annotations

import itertools
import json
import os
import warnings
from dataclasses import dataclass
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
warnings.filterwarnings("ignore", category=UserWarning, module="tensorflow.lite")

import numpy as np
import onnxruntime as ort
import tensorflow as tf


ROOT = Path(__file__).resolve().parents[1]
REPORT_PATH = ROOT / "models/converted/VALIDATION.json"


@dataclass(frozen=True)
class ModelValidation:
    id: str
    onnx_path: Path
    tflite_path: Path
    onnx_input_name: str
    nchw_shape: tuple[int, int, int, int]
    tflite_input_shape: tuple[int, int, int, int]
    max_abs_tolerance: float = 1e-4
    mean_abs_tolerance: float = 1e-5


MODELS = [
    ModelValidation(
        id="detector",
        onnx_path=ROOT / "models/raw/face_detection_yunet_2023mar.onnx",
        tflite_path=ROOT
        / "models/converted/yunet/face_detection_yunet_2023mar_float32.tflite",
        onnx_input_name="input",
        nchw_shape=(1, 3, 640, 640),
        tflite_input_shape=(1, 640, 640, 3),
    ),
    ModelValidation(
        id="liveness",
        onnx_path=ROOT / "models/raw/minifasnet_v2.onnx",
        tflite_path=ROOT / "models/converted/minifasnet_v2/minifasnet_v2_float32.tflite",
        onnx_input_name="input",
        nchw_shape=(1, 3, 80, 80),
        tflite_input_shape=(1, 80, 80, 3),
    ),
    ModelValidation(
        id="recognition",
        onnx_path=ROOT / "models/raw/w600k_mbf.onnx",
        tflite_path=ROOT / "models/converted/w600k_mbf/w600k_mbf_float32.tflite",
        onnx_input_name="input.1",
        nchw_shape=(1, 3, 112, 112),
        tflite_input_shape=(1, 112, 112, 3),
    ),
]


def main() -> int:
    report = []

    for index, model in enumerate(MODELS):
        validate_file_exists(model.onnx_path)
        validate_file_exists(model.tflite_path)
        result = validate_model(model, seed=1337 + index)
        report.append(result)
        print(
            f"{model.id}: max_abs={result['max_abs_diff']:.8f}, "
            f"mean_abs={result['mean_abs_diff']:.8f}, outputs={len(result['outputs'])}"
        )

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {REPORT_PATH.relative_to(ROOT)}")
    return 0


def validate_file_exists(path: Path) -> None:
    if not path.exists():
        raise SystemExit(f"Missing {path.relative_to(ROOT)}")


def validate_model(model: ModelValidation, seed: int) -> dict[str, object]:
    rng = np.random.default_rng(seed)
    nchw_input = rng.random(model.nchw_shape, dtype=np.float32)
    nhwc_input = np.transpose(nchw_input, (0, 2, 3, 1))

    onnx_outputs = run_onnx(model, nchw_input)
    tflite_input_shape, tflite_outputs = run_tflite(model, nhwc_input)

    if tuple(tflite_input_shape) != model.tflite_input_shape:
        raise SystemExit(
            f"{model.id}: expected TFLite input {model.tflite_input_shape}, "
            f"got {tuple(tflite_input_shape)}"
        )

    matched_outputs = match_outputs(onnx_outputs, tflite_outputs)
    max_abs_diff = max(item["max_abs_diff"] for item in matched_outputs)
    mean_abs_diff = max(item["mean_abs_diff"] for item in matched_outputs)

    if max_abs_diff > model.max_abs_tolerance:
        raise SystemExit(
            f"{model.id}: max_abs_diff {max_abs_diff:.8f} exceeds "
            f"{model.max_abs_tolerance:.8f}"
        )
    if mean_abs_diff > model.mean_abs_tolerance:
        raise SystemExit(
            f"{model.id}: mean_abs_diff {mean_abs_diff:.8f} exceeds "
            f"{model.mean_abs_tolerance:.8f}"
        )

    return {
        "id": model.id,
        "onnx_path": str(model.onnx_path.relative_to(ROOT)),
        "tflite_path": str(model.tflite_path.relative_to(ROOT)),
        "onnx_input_shape": list(model.nchw_shape),
        "tflite_input_shape": list(tflite_input_shape),
        "max_abs_diff": max_abs_diff,
        "mean_abs_diff": mean_abs_diff,
        "outputs": matched_outputs,
    }


def run_onnx(
    model: ModelValidation, nchw_input: np.ndarray
) -> list[dict[str, object]]:
    session = ort.InferenceSession(
        str(model.onnx_path), providers=["CPUExecutionProvider"]
    )
    outputs = session.run(None, {model.onnx_input_name: nchw_input})
    output_infos = session.get_outputs()
    return [
        {
            "name": info.name,
            "shape": shape_list(np.asarray(value).shape),
            "value": np.asarray(value),
        }
        for info, value in zip(output_infos, outputs)
    ]


def run_tflite(
    model: ModelValidation, nhwc_input: np.ndarray
) -> tuple[list[int], list[dict[str, object]]]:
    interpreter = tf.lite.Interpreter(model_path=str(model.tflite_path), num_threads=1)
    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    if len(input_details) != 1:
        raise SystemExit(f"{model.id}: expected 1 TFLite input, got {len(input_details)}")

    input_detail = input_details[0]
    if input_detail["dtype"] != np.float32:
        raise SystemExit(
            f"{model.id}: expected float32 TFLite input, got {input_detail['dtype']}"
        )

    interpreter.set_tensor(input_detail["index"], nhwc_input.astype(np.float32))
    interpreter.invoke()

    outputs = []
    for detail in interpreter.get_output_details():
        value = interpreter.get_tensor(detail["index"])
        outputs.append(
            {
                "name": detail["name"],
                "shape": shape_list(value.shape),
                "value": np.asarray(value),
            }
        )

    return shape_list(input_detail["shape"]), outputs


def shape_list(shape) -> list[int]:
    return [int(dim) for dim in shape]


def match_outputs(
    onnx_outputs: list[dict[str, object]],
    tflite_outputs: list[dict[str, object]],
) -> list[dict[str, object]]:
    if len(onnx_outputs) != len(tflite_outputs):
        raise SystemExit(
            f"Output count mismatch: ONNX={len(onnx_outputs)}, "
            f"TFLite={len(tflite_outputs)}"
        )

    tflite_by_shape: dict[tuple[int, ...], list[dict[str, object]]] = {}
    for output in tflite_outputs:
        tflite_by_shape.setdefault(tuple(output["shape"]), []).append(output)

    matched = []
    for shape, onnx_group in group_by_shape(onnx_outputs).items():
        tflite_group = tflite_by_shape.get(shape)
        if tflite_group is None or len(tflite_group) != len(onnx_group):
            raise SystemExit(
                f"Output shape mismatch for {shape}: "
                f"ONNX={len(onnx_group)}, TFLite={0 if tflite_group is None else len(tflite_group)}"
            )

        best = best_group_permutation(onnx_group, tflite_group)
        matched.extend(best)

    return sorted(matched, key=lambda item: item["onnx_name"])


def group_by_shape(
    outputs: list[dict[str, object]]
) -> dict[tuple[int, ...], list[dict[str, object]]]:
    groups: dict[tuple[int, ...], list[dict[str, object]]] = {}
    for output in outputs:
        groups.setdefault(tuple(output["shape"]), []).append(output)
    return groups


def best_group_permutation(
    onnx_group: list[dict[str, object]],
    tflite_group: list[dict[str, object]],
) -> list[dict[str, object]]:
    best_score = None
    best_match = None

    for permutation in itertools.permutations(tflite_group):
        current = []
        group_score = 0.0
        for onnx_output, tflite_output in zip(onnx_group, permutation):
            onnx_value = onnx_output["value"]
            tflite_value = tflite_output["value"]
            diff = np.abs(onnx_value - tflite_value)
            max_abs = float(np.max(diff))
            mean_abs = float(np.mean(diff))
            group_score += max_abs
            current.append(
                {
                    "onnx_name": onnx_output["name"],
                    "tflite_name": tflite_output["name"],
                    "shape": onnx_output["shape"],
                    "max_abs_diff": max_abs,
                    "mean_abs_diff": mean_abs,
                }
            )

        if best_score is None or group_score < best_score:
            best_score = group_score
            best_match = current

    if best_match is None:
        raise SystemExit("No output permutation candidates found")

    return best_match


if __name__ == "__main__":
    raise SystemExit(main())
