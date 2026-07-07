#!/usr/bin/env python3
"""Generate Nirikshan score CSVs from image manifests using TFLite models.

The output CSV is designed to be passed into scripts/evaluate.py. This runner is
for offline image datasets first; Android live-frame integration should mirror
the validated preprocessing after dataset metrics are acceptable.
"""

from __future__ import annotations

import argparse
import csv
import math
import os
import time
import warnings
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
warnings.filterwarnings("ignore", category=UserWarning, module="tensorflow.lite")

import cv2
import numpy as np
import tensorflow as tf


ROOT = Path(__file__).resolve().parents[1]
DETECTOR_INPUT_SIZE = 640
LIVENESS_INPUT_SIZE = 80
RECOGNITION_INPUT_SIZE = 112
YUNET_STRIDES = (8, 16, 32)
ARC_FACE_TEMPLATE = np.asarray(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)

BASE_COLUMNS = [
    "sample_id",
    "user_id",
    "path",
    "label",
    "attack_type",
    "condition",
    "split",
]

SCORE_COLUMNS = [
    "detection_success",
    "landmark_success",
    "detection_reason",
    "liveness_score",
    "embedding_generated",
    "best_match_user",
    "best_match_score",
    "auth_decision",
    "detection_latency_ms",
    "liveness_latency_ms",
    "recognition_latency_ms",
    "total_latency_ms",
]


@dataclass(frozen=True)
class Detection:
    x: float
    y: float
    width: float
    height: float
    landmarks: np.ndarray
    score: float


@dataclass
class SampleResult:
    row: dict[str, str]
    detection_success: bool = False
    landmark_success: bool = False
    detection_reason: str = "not_run"
    liveness_score: float | None = None
    embedding: np.ndarray | None = None
    best_match_user: str | None = None
    best_match_score: float | None = None
    auth_decision: str = "reject"
    detection_latency_ms: float = 0.0
    liveness_latency_ms: float = 0.0
    recognition_latency_ms: float = 0.0
    total_latency_ms: float = 0.0


class TFLiteModel:
    def __init__(self, path: Path) -> None:
        if not path.exists():
            raise SystemExit(f"Missing model file: {path.relative_to(ROOT)}")
        self.path = path
        self.interpreter = tf.lite.Interpreter(model_path=str(path), num_threads=1)
        self.interpreter.allocate_tensors()
        self.inputs = self.interpreter.get_input_details()
        self.outputs = self.interpreter.get_output_details()
        if len(self.inputs) != 1:
            raise SystemExit(
                f"{path.relative_to(ROOT)} expected 1 input, got {len(self.inputs)}"
            )

    def run(self, tensor: np.ndarray) -> list[np.ndarray]:
        input_detail = self.inputs[0]
        expected_shape = tuple(int(dim) for dim in input_detail["shape"])
        if tuple(tensor.shape) != expected_shape:
            raise SystemExit(
                f"{self.path.relative_to(ROOT)} expected input {expected_shape}, "
                f"got {tuple(tensor.shape)}"
            )
        self.interpreter.set_tensor(input_detail["index"], tensor.astype(np.float32))
        self.interpreter.invoke()
        return [
            self.interpreter.get_tensor(output_detail["index"])
            for output_detail in self.outputs
        ]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run TFLite detector/liveness/recognition models on an image manifest."
    )
    parser.add_argument("--manifest", required=True, help="Input CSV manifest")
    parser.add_argument("--output", required=True, help="Output scored CSV path")
    parser.add_argument(
        "--detector-model",
        default="mobile/src/assets/models/yunet_detector.tflite",
        help="YuNet TFLite model path",
    )
    parser.add_argument(
        "--liveness-model",
        default="mobile/src/assets/models/minifasnet_v2.tflite",
        help="MiniFASNetV2 TFLite model path",
    )
    parser.add_argument(
        "--recognition-model",
        default="mobile/src/assets/models/mobilefacenet_arcface.tflite",
        help="ArcFace/MobileFaceNet TFLite model path",
    )
    parser.add_argument("--enrollment-split", default="train")
    parser.add_argument("--max-enrollment-per-user", type=int, default=5)
    parser.add_argument("--detector-threshold", type=float, default=0.6)
    parser.add_argument("--detector-nms-threshold", type=float, default=0.3)
    parser.add_argument("--detector-top-k", type=int, default=5000)
    parser.add_argument("--face-min-size-ratio", type=float, default=0.18)
    parser.add_argument("--brightness-min", type=float, default=40.0)
    parser.add_argument("--brightness-max", type=float, default=220.0)
    parser.add_argument("--liveness-threshold", type=float, default=0.72)
    parser.add_argument("--liveness-live-index", type=int, default=1)
    parser.add_argument("--recognition-threshold", type=float, default=0.75)
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    rows, fieldnames = read_manifest(manifest_path)
    validate_manifest_columns(fieldnames)

    detector = TFLiteModel(resolve_path(args.detector_model))
    liveness = TFLiteModel(resolve_path(args.liveness_model))
    recognition = TFLiteModel(resolve_path(args.recognition_model))

    results = [
        process_sample(
            row=row,
            manifest_path=manifest_path,
            detector=detector,
            liveness=liveness,
            recognition=recognition,
            args=args,
        )
        for row in rows
    ]

    gallery = build_enrollment_gallery(
        results,
        enrollment_split=args.enrollment_split,
        max_per_user=args.max_enrollment_per_user,
    )
    apply_matching_and_decisions(results, gallery, args)
    write_scores(Path(args.output), fieldnames, results)

    print(f"Wrote scored manifest to {args.output}")
    print(f"Enrollment embeddings: {len(gallery)}")
    return 0


def read_manifest(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    if not path.exists():
        raise SystemExit(f"Manifest not found: {path}")
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise SystemExit("Manifest has no header row")
        return list(reader), list(reader.fieldnames)


def validate_manifest_columns(fieldnames: list[str]) -> None:
    missing = [column for column in BASE_COLUMNS if column not in fieldnames]
    if missing:
        raise SystemExit(f"Manifest missing required columns: {missing}")


def resolve_path(value: str) -> Path:
    path = Path(value)
    if path.is_absolute():
        return path
    return ROOT / path


def process_sample(
    row: dict[str, str],
    manifest_path: Path,
    detector: TFLiteModel,
    liveness: TFLiteModel,
    recognition: TFLiteModel,
    args: argparse.Namespace,
) -> SampleResult:
    result = SampleResult(row=row)
    start_total = time.perf_counter()
    image_path = resolve_sample_path(row["path"], manifest_path)
    image_bgr = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image_bgr is None:
        result.detection_reason = "image_load_failed"
        result.total_latency_ms = elapsed_ms(start_total)
        return result

    start = time.perf_counter()
    detections = detect_faces(
        image_bgr=image_bgr,
        detector=detector,
        score_threshold=args.detector_threshold,
        nms_threshold=args.detector_nms_threshold,
        top_k=args.detector_top_k,
    )
    result.detection_latency_ms = elapsed_ms(start)

    quality_reason = quality_rejection_reason(image_bgr, detections, args)
    if quality_reason is not None:
        result.detection_reason = quality_reason
        result.total_latency_ms = elapsed_ms(start_total)
        return result

    face = detections[0]
    result.detection_success = True
    result.landmark_success = face.landmarks.shape == (5, 2)
    result.detection_reason = "ok"

    start = time.perf_counter()
    liveness_input = liveness_tensor(image_bgr, face)
    liveness_output = liveness.run(liveness_input)[0].reshape(-1)
    liveness_probabilities = probability_vector(liveness_output)
    if args.liveness_live_index >= len(liveness_probabilities):
        raise SystemExit(
            f"liveness live index {args.liveness_live_index} is outside "
            f"output length {len(liveness_probabilities)}"
        )
    result.liveness_score = float(liveness_probabilities[args.liveness_live_index])
    result.liveness_latency_ms = elapsed_ms(start)

    start = time.perf_counter()
    aligned_face = align_face(image_bgr, face.landmarks)
    if aligned_face is not None:
        embedding = recognition.run(recognition_tensor(aligned_face))[0].reshape(-1)
        result.embedding = normalize_vector(embedding.astype(np.float32))
    result.recognition_latency_ms = elapsed_ms(start)
    result.total_latency_ms = elapsed_ms(start_total)
    return result


def resolve_sample_path(sample_path: str, manifest_path: Path) -> Path:
    path = Path(sample_path)
    if path.is_absolute():
        return path
    if path.exists():
        return path
    return manifest_path.parent / path


def detect_faces(
    image_bgr: np.ndarray,
    detector: TFLiteModel,
    score_threshold: float,
    nms_threshold: float,
    top_k: int,
) -> list[Detection]:
    original_h, original_w = image_bgr.shape[:2]
    resized = cv2.resize(
        image_bgr,
        (DETECTOR_INPUT_SIZE, DETECTOR_INPUT_SIZE),
        interpolation=cv2.INTER_LINEAR,
    )
    input_tensor = resized.astype(np.float32)[np.newaxis, ...]
    outputs = detector.run(input_tensor)
    if len(outputs) != 12:
        raise SystemExit(f"YuNet expected 12 outputs, got {len(outputs)}")

    decoded = decode_yunet_outputs(
        outputs=outputs,
        score_threshold=score_threshold,
        nms_threshold=nms_threshold,
        top_k=top_k,
    )
    x_scale = original_w / DETECTOR_INPUT_SIZE
    y_scale = original_h / DETECTOR_INPUT_SIZE
    return [scale_detection(face, x_scale, y_scale) for face in decoded]


def decode_yunet_outputs(
    outputs: list[np.ndarray],
    score_threshold: float,
    nms_threshold: float,
    top_k: int,
) -> list[Detection]:
    detections: list[Detection] = []
    for stride_index, stride in enumerate(YUNET_STRIDES):
        cols = DETECTOR_INPUT_SIZE // stride
        rows = DETECTOR_INPUT_SIZE // stride
        cls = outputs[stride_index].reshape(-1)
        obj = outputs[stride_index + 3].reshape(-1)
        bbox = outputs[stride_index + 6].reshape(-1, 4)
        kps = outputs[stride_index + 9].reshape(-1, 10)

        scores = np.sqrt(np.clip(cls, 0.0, 1.0) * np.clip(obj, 0.0, 1.0))
        candidate_indices = np.where(scores >= score_threshold)[0]
        for index in candidate_indices:
            r = index // cols
            c = index % cols
            cx = (c + bbox[index, 0]) * stride
            cy = (r + bbox[index, 1]) * stride
            width = math.exp(float(bbox[index, 2])) * stride
            height = math.exp(float(bbox[index, 3])) * stride
            x = cx - width / 2.0
            y = cy - height / 2.0
            landmarks = np.zeros((5, 2), dtype=np.float32)
            for point_index in range(5):
                landmarks[point_index, 0] = (
                    kps[index, point_index * 2] + c
                ) * stride
                landmarks[point_index, 1] = (
                    kps[index, point_index * 2 + 1] + r
                ) * stride
            detections.append(
                Detection(
                    x=float(x),
                    y=float(y),
                    width=float(width),
                    height=float(height),
                    landmarks=landmarks,
                    score=float(scores[index]),
                )
            )

    return nms_detections(detections, score_threshold, nms_threshold, top_k)


def nms_detections(
    detections: list[Detection],
    score_threshold: float,
    nms_threshold: float,
    top_k: int,
) -> list[Detection]:
    if not detections:
        return []
    boxes = [
        [int(face.x), int(face.y), int(face.width), int(face.height)]
        for face in detections
    ]
    scores = [face.score for face in detections]
    keep = cv2.dnn.NMSBoxes(
        boxes,
        scores,
        score_threshold,
        nms_threshold,
        eta=1.0,
        top_k=top_k,
    )
    if len(keep) == 0:
        return []
    indices = np.asarray(keep).reshape(-1).tolist()
    return sorted((detections[index] for index in indices), key=lambda face: face.score, reverse=True)


def scale_detection(face: Detection, x_scale: float, y_scale: float) -> Detection:
    landmarks = face.landmarks.copy()
    landmarks[:, 0] *= x_scale
    landmarks[:, 1] *= y_scale
    return Detection(
        x=face.x * x_scale,
        y=face.y * y_scale,
        width=face.width * x_scale,
        height=face.height * y_scale,
        landmarks=landmarks,
        score=face.score,
    )


def quality_rejection_reason(
    image_bgr: np.ndarray,
    detections: list[Detection],
    args: argparse.Namespace,
) -> str | None:
    if not detections:
        return "no_face"
    if len(detections) > 1:
        return "multiple_faces"

    height, width = image_bgr.shape[:2]
    face = detections[0]
    face_size_ratio = max(face.width / width, face.height / height)
    if face_size_ratio < args.face_min_size_ratio:
        return "face_too_small"

    crop = crop_bbox(image_bgr, face, scale=1.0)
    if crop is None or crop.size == 0:
        return "invalid_face_crop"
    brightness = float(np.mean(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)))
    if brightness < args.brightness_min:
        return "too_dark"
    if brightness > args.brightness_max:
        return "too_bright"
    return None


def crop_bbox(image_bgr: np.ndarray, face: Detection, scale: float) -> np.ndarray | None:
    image_h, image_w = image_bgr.shape[:2]
    cx = face.x + face.width / 2.0
    cy = face.y + face.height / 2.0
    side = max(face.width, face.height) * scale
    x1 = int(round(cx - side / 2.0))
    y1 = int(round(cy - side / 2.0))
    x2 = int(round(cx + side / 2.0))
    y2 = int(round(cy + side / 2.0))
    x1 = max(0, min(image_w, x1))
    y1 = max(0, min(image_h, y1))
    x2 = max(0, min(image_w, x2))
    y2 = max(0, min(image_h, y2))
    if x2 <= x1 or y2 <= y1:
        return None
    return image_bgr[y1:y2, x1:x2]


def liveness_tensor(image_bgr: np.ndarray, face: Detection) -> np.ndarray:
    crop = crop_bbox(image_bgr, face, scale=2.7)
    if crop is None:
        crop = crop_bbox(image_bgr, face, scale=1.0)
    if crop is None:
        raise SystemExit("Unable to create liveness crop")
    resized = cv2.resize(
        crop,
        (LIVENESS_INPUT_SIZE, LIVENESS_INPUT_SIZE),
        interpolation=cv2.INTER_LINEAR,
    )
    return resized.astype(np.float32)[np.newaxis, ...]


def probability_vector(values: np.ndarray) -> np.ndarray:
    values = values.astype(np.float32)
    if np.all(values >= 0.0) and np.all(values <= 1.0):
        total = float(np.sum(values))
        if 0.98 <= total <= 1.02:
            return values
    shifted = values - np.max(values)
    exp_values = np.exp(shifted)
    return exp_values / np.sum(exp_values)


def align_face(image_bgr: np.ndarray, landmarks: np.ndarray) -> np.ndarray | None:
    if landmarks.shape != (5, 2):
        return None
    transform, _ = cv2.estimateAffinePartial2D(
        landmarks.astype(np.float32),
        ARC_FACE_TEMPLATE,
        method=cv2.LMEDS,
    )
    if transform is None:
        return None
    return cv2.warpAffine(
        image_bgr,
        transform,
        (RECOGNITION_INPUT_SIZE, RECOGNITION_INPUT_SIZE),
        flags=cv2.INTER_LINEAR,
        borderValue=0.0,
    )


def recognition_tensor(aligned_bgr: np.ndarray) -> np.ndarray:
    rgb = cv2.cvtColor(aligned_bgr, cv2.COLOR_BGR2RGB)
    normalized = (rgb.astype(np.float32) - 127.5) / 127.5
    return normalized[np.newaxis, ...]


def normalize_vector(vector: np.ndarray) -> np.ndarray:
    norm = float(np.linalg.norm(vector))
    if norm == 0.0:
        return vector
    return vector / norm


def build_enrollment_gallery(
    results: list[SampleResult],
    enrollment_split: str,
    max_per_user: int,
) -> list[tuple[str, str, np.ndarray]]:
    counts: dict[str, int] = defaultdict(int)
    gallery = []
    for result in results:
        row = result.row
        if row["split"] != enrollment_split:
            continue
        if row["label"] != "real":
            continue
        if result.embedding is None:
            continue
        user_id = row["user_id"]
        if counts[user_id] >= max_per_user:
            continue
        counts[user_id] += 1
        gallery.append((row["sample_id"], user_id, result.embedding))
    return gallery


def apply_matching_and_decisions(
    results: list[SampleResult],
    gallery: list[tuple[str, str, np.ndarray]],
    args: argparse.Namespace,
) -> None:
    for result in results:
        if result.embedding is not None and gallery:
            best_user = None
            best_score = -1.0
            for sample_id, user_id, embedding in gallery:
                if sample_id == result.row["sample_id"]:
                    continue
                score = float(np.dot(result.embedding, embedding))
                if score > best_score:
                    best_score = score
                    best_user = user_id
            if best_user is not None:
                result.best_match_user = best_user
                result.best_match_score = best_score

        if not result.detection_success:
            result.auth_decision = "reject"
        elif result.liveness_score is None or result.liveness_score < args.liveness_threshold:
            result.auth_decision = "spoof"
        elif (
            result.best_match_score is not None
            and result.best_match_score >= args.recognition_threshold
        ):
            result.auth_decision = "accept"
        else:
            result.auth_decision = "reject"


def write_scores(
    output_path: Path,
    input_fieldnames: list[str],
    results: list[SampleResult],
) -> None:
    fieldnames = dedupe_columns(BASE_COLUMNS + input_fieldnames + SCORE_COLUMNS)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for result in results:
            row = {column: result.row.get(column, "") for column in fieldnames}
            row.update(
                {
                    "detection_success": csv_bool(result.detection_success),
                    "landmark_success": csv_bool(result.landmark_success),
                    "detection_reason": result.detection_reason,
                    "liveness_score": csv_float(result.liveness_score),
                    "embedding_generated": csv_bool(result.embedding is not None),
                    "best_match_user": result.best_match_user or "",
                    "best_match_score": csv_float(result.best_match_score),
                    "auth_decision": result.auth_decision,
                    "detection_latency_ms": f"{result.detection_latency_ms:.3f}",
                    "liveness_latency_ms": f"{result.liveness_latency_ms:.3f}",
                    "recognition_latency_ms": f"{result.recognition_latency_ms:.3f}",
                    "total_latency_ms": f"{result.total_latency_ms:.3f}",
                }
            )
            writer.writerow(row)


def dedupe_columns(columns: list[str]) -> list[str]:
    seen = set()
    deduped = []
    for column in columns:
        if column in seen:
            continue
        seen.add(column)
        deduped.append(column)
    return deduped


def csv_bool(value: bool) -> str:
    return "true" if value else "false"


def csv_float(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:.8f}"


def elapsed_ms(start: float) -> float:
    return (time.perf_counter() - start) * 1000.0


if __name__ == "__main__":
    raise SystemExit(main())
