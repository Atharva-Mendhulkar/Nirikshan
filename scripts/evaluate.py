#!/usr/bin/env python3
"""Nirikshan ML score evaluator.

This script evaluates detector/liveness/recognition scores from a manifest.
It intentionally uses only the Python standard library so it can run on a
fresh machine before model-runtime dependencies are installed.

The first evaluator mode expects precomputed scores in the manifest. The TFLite
model runner can be added later without changing the report schema.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


REQUIRED_COLUMNS = {
    "sample_id",
    "user_id",
    "path",
    "label",
    "attack_type",
    "condition",
    "split",
}

SCORE_COLUMNS = {
    "detection_success",
    "liveness_score",
    "embedding_generated",
    "best_match_user",
    "best_match_score",
    "total_latency_ms",
}

SCORES_COLUMNS = [
    "sample_id",
    "user_id",
    "label",
    "attack_type",
    "condition",
    "detection_success",
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

ALLOWED_LABELS = {"real", "spoof"}
ALLOWED_ATTACK_TYPES = {"none", "print", "screen", "unknown"}
ALLOWED_SPLITS = {"train", "dev", "test"}

DEFAULT_THRESHOLDS = {
    "faceMinSizeRatio": 0.18,
    "brightnessMin": 40,
    "brightnessMax": 220,
    "livenessThreshold": 0.72,
    "recognitionThreshold": 0.75,
}


@dataclass(frozen=True)
class Sample:
    sample_id: str
    user_id: str
    path: str
    label: str
    attack_type: str
    condition: str
    split: str
    detection_success: bool | None
    landmark_success: bool | None
    liveness_score: float | None
    embedding_generated: bool | None
    best_match_user: str | None
    best_match_score: float | None
    detection_latency_ms: float | None
    liveness_latency_ms: float | None
    recognition_latency_ms: float | None
    total_latency_ms: float | None
    detection_reason: str | None


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate Nirikshan ML scores and threshold tradeoffs.",
    )
    parser.add_argument("--manifest", required=True, help="CSV manifest path")
    parser.add_argument("--output", required=True, help="Output report folder")
    parser.add_argument(
        "--target-far",
        type=float,
        default=0.01,
        help="Recognition FAR target used when selecting threshold",
    )
    parser.add_argument(
        "--allow-missing-scores",
        action="store_true",
        help="Allow manifests that do not yet include model scores",
    )
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    output_dir = Path(args.output)
    rows, fieldnames = read_manifest(manifest_path)
    validate_columns(fieldnames, args.allow_missing_scores)
    samples = [sample_from_row(row) for row in rows]
    warnings = validate_samples(samples, manifest_path)

    tune_rows = split_rows(samples, "dev")
    if not tune_rows:
        tune_rows = samples
        warnings.append("No dev split found; thresholds were tuned on all rows.")

    report_rows = split_rows(samples, "test")
    if not report_rows:
        report_rows = samples
        warnings.append("No test split found; final metrics were reported on all rows.")

    thresholds = {
        **DEFAULT_THRESHOLDS,
        "livenessThreshold": tune_liveness_threshold(tune_rows),
        "recognitionThreshold": tune_recognition_threshold(
            tune_rows,
            target_far=args.target_far,
            default_threshold=DEFAULT_THRESHOLDS["recognitionThreshold"],
        ),
    }

    scored_rows = [
        score_output_row(sample, thresholds)
        for sample in samples
    ]
    metrics = build_metrics(
        samples=samples,
        report_rows=report_rows,
        thresholds=thresholds,
        target_far=args.target_far,
        warnings=warnings,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    write_json(output_dir / "metrics.json", metrics)
    write_json(output_dir / "thresholds.json", thresholds)
    write_scores_csv(output_dir / "scores.csv", scored_rows)
    write_summary(output_dir / "summary.md", metrics)

    print(f"Wrote evaluation report to {output_dir}")
    print(
        "Recommended thresholds: "
        f"liveness={thresholds['livenessThreshold']:.4f}, "
        f"recognition={thresholds['recognitionThreshold']:.4f}"
    )
    return 0


def read_manifest(path: Path) -> tuple[list[dict[str, str]], list[str]]:
    if not path.exists():
        raise SystemExit(f"Manifest not found: {path}")

    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise SystemExit("Manifest has no header row")
        rows = list(reader)
        return rows, list(reader.fieldnames)


def validate_columns(fieldnames: Iterable[str], allow_missing_scores: bool) -> None:
    names = set(fieldnames)
    missing_required = sorted(REQUIRED_COLUMNS - names)
    if missing_required:
        raise SystemExit(f"Manifest missing required columns: {missing_required}")

    missing_scores = sorted(SCORE_COLUMNS - names)
    if missing_scores and not allow_missing_scores:
        raise SystemExit(
            "Manifest is missing score columns needed for quantitative evaluation: "
            f"{missing_scores}. Add model scores or pass --allow-missing-scores "
            "for manifest-only validation."
        )


def validate_samples(samples: list[Sample], manifest_path: Path) -> list[str]:
    warnings: list[str] = []
    ids = [sample.sample_id for sample in samples]
    duplicates = sorted(id_ for id_, count in Counter(ids).items() if count > 1)
    if duplicates:
        raise SystemExit(f"Duplicate sample_id values: {duplicates}")

    for sample in samples:
        if sample.label not in ALLOWED_LABELS:
            raise SystemExit(f"{sample.sample_id}: invalid label {sample.label!r}")
        if sample.attack_type not in ALLOWED_ATTACK_TYPES:
            raise SystemExit(
                f"{sample.sample_id}: invalid attack_type {sample.attack_type!r}"
            )
        if sample.split not in ALLOWED_SPLITS:
            raise SystemExit(f"{sample.sample_id}: invalid split {sample.split!r}")
        if sample.label == "real" and sample.attack_type != "none":
            warnings.append(
                f"{sample.sample_id}: real sample uses non-none attack_type"
            )
        if sample.label == "spoof" and sample.attack_type == "none":
            warnings.append(
                f"{sample.sample_id}: spoof sample should specify attack_type"
            )

    missing_paths = count_missing_paths(samples, manifest_path)
    if missing_paths:
        warnings.append(
            f"{missing_paths} sample path(s) do not exist yet; "
            "metrics are based on supplied scores only."
        )

    return warnings


def count_missing_paths(samples: list[Sample], manifest_path: Path) -> int:
    root = manifest_path.parent
    missing = 0
    for sample in samples:
        if not sample.path:
            continue
        sample_path = Path(sample.path)
        if not sample_path.is_absolute():
            sample_path = root / sample_path
        if not sample_path.exists():
            missing += 1
    return missing


def sample_from_row(row: dict[str, str]) -> Sample:
    return Sample(
        sample_id=cell(row, "sample_id"),
        user_id=cell(row, "user_id"),
        path=cell(row, "path"),
        label=cell(row, "label").lower(),
        attack_type=cell(row, "attack_type").lower(),
        condition=cell(row, "condition").lower(),
        split=cell(row, "split").lower(),
        detection_success=parse_bool(row.get("detection_success")),
        landmark_success=parse_bool(row.get("landmark_success")),
        liveness_score=parse_float(row.get("liveness_score")),
        embedding_generated=parse_bool(row.get("embedding_generated")),
        best_match_user=parse_optional_text(row.get("best_match_user")),
        best_match_score=parse_float(row.get("best_match_score")),
        detection_latency_ms=parse_float(row.get("detection_latency_ms")),
        liveness_latency_ms=parse_float(row.get("liveness_latency_ms")),
        recognition_latency_ms=parse_float(row.get("recognition_latency_ms")),
        total_latency_ms=parse_float(row.get("total_latency_ms")),
        detection_reason=parse_optional_text(row.get("detection_reason")),
    )


def cell(row: dict[str, str], key: str) -> str:
    return (row.get(key) or "").strip()


def parse_optional_text(value: str | None) -> str | None:
    text = (value or "").strip()
    return text or None


def parse_bool(value: str | None) -> bool | None:
    text = (value or "").strip().lower()
    if text == "":
        return None
    if text in {"1", "true", "yes", "y"}:
        return True
    if text in {"0", "false", "no", "n"}:
        return False
    raise SystemExit(f"Invalid boolean value: {value!r}")


def parse_float(value: str | None) -> float | None:
    text = (value or "").strip()
    if text == "":
        return None
    try:
        return float(text)
    except ValueError as error:
        raise SystemExit(f"Invalid numeric value: {value!r}") from error


def split_rows(samples: list[Sample], split: str) -> list[Sample]:
    return [sample for sample in samples if sample.split == split]


def detection_passed(sample: Sample) -> bool:
    return sample.detection_success is True


def landmark_passed(sample: Sample) -> bool:
    if sample.landmark_success is None:
        return detection_passed(sample)
    return sample.landmark_success


def tune_liveness_threshold(samples: list[Sample]) -> float:
    rows = [
        sample
        for sample in samples
        if sample.liveness_score is not None
        and sample.label in ALLOWED_LABELS
        and detection_passed(sample)
    ]
    if not rows:
        return DEFAULT_THRESHOLDS["livenessThreshold"]

    candidates = threshold_candidates(sample.liveness_score for sample in rows)
    best = min(
        candidates,
        key=lambda threshold: liveness_selection_key(rows, threshold),
    )
    return round(best, 6)


def liveness_selection_key(
    samples: list[Sample],
    threshold: float,
) -> tuple[float, float, float]:
    metrics = liveness_metrics(samples, threshold)
    apcer = metrics["apcer"] if metrics["apcer"] is not None else 1.0
    bpcer = metrics["bpcer"] if metrics["bpcer"] is not None else 1.0
    acer = metrics["acer"] if metrics["acer"] is not None else 1.0
    return (
        acer,
        abs(apcer - bpcer),
        abs(threshold - DEFAULT_THRESHOLDS["livenessThreshold"]),
    )


def tune_recognition_threshold(
    samples: list[Sample],
    target_far: float,
    default_threshold: float,
) -> float:
    rows = recognition_rows(samples)
    genuine = [row for row in rows if row.best_match_user == row.user_id]
    impostor = [row for row in rows if row.best_match_user != row.user_id]

    if not genuine or not impostor:
        return default_threshold

    candidates = threshold_candidates(row.best_match_score for row in rows)
    viable = []
    fallback = []

    for threshold in candidates:
        metrics = recognition_metrics(rows, threshold)
        far = metrics["far"] if metrics["far"] is not None else 1.0
        frr = metrics["frr"] if metrics["frr"] is not None else 1.0
        key = (frr, abs(threshold - default_threshold))
        if far <= target_far:
            viable.append((key, threshold))
        fallback.append(((far, frr, abs(threshold - default_threshold)), threshold))

    if viable:
        return round(min(viable)[1], 6)
    return round(min(fallback)[1], 6)


def threshold_candidates(scores: Iterable[float | None]) -> list[float]:
    values = sorted({score for score in scores if score is not None})
    if not values:
        return [0.0]

    candidates = {0.0, 1.0, *values}
    for left, right in zip(values, values[1:]):
        candidates.add((left + right) / 2)
    candidates.add(max(0.0, values[0] - 1e-6))
    candidates.add(min(1.0, values[-1] + 1e-6))
    return sorted(candidates)


def recognition_rows(samples: list[Sample]) -> list[Sample]:
    return [
        sample
        for sample in samples
        if sample.label == "real"
        and detection_passed(sample)
        and sample.embedding_generated is True
        and sample.best_match_user is not None
        and sample.best_match_score is not None
    ]


def build_metrics(
    samples: list[Sample],
    report_rows: list[Sample],
    thresholds: dict[str, float],
    target_far: float,
    warnings: list[str],
) -> dict[str, object]:
    liveness_threshold = thresholds["livenessThreshold"]
    recognition_threshold = thresholds["recognitionThreshold"]
    report_recognition_rows = recognition_rows(report_rows)
    liveness_rows = [
        sample
        for sample in report_rows
        if sample.liveness_score is not None and detection_passed(sample)
    ]

    decisions = [auth_decision(sample, thresholds) for sample in report_rows]
    spoof_rows = [sample for sample in report_rows if sample.label == "spoof"]
    accepted_spoofs = sum(
        1
        for sample, decision in zip(report_rows, decisions)
        if sample.label == "spoof" and decision == "accept"
    )
    genuine_rows = [sample for sample in report_rows if sample.label == "real"]
    accepted_genuine = sum(
        1
        for sample, decision in zip(report_rows, decisions)
        if sample.label == "real"
        and decision == "accept"
        and sample.best_match_user == sample.user_id
    )

    return {
        "input": {
            "sample_count": len(samples),
            "report_sample_count": len(report_rows),
            "split_counts": dict(Counter(sample.split for sample in samples)),
            "label_counts": dict(Counter(sample.label for sample in samples)),
            "condition_counts": dict(Counter(sample.condition for sample in samples)),
            "attack_type_counts": dict(
                Counter(sample.attack_type for sample in samples)
            ),
        },
        "thresholds": thresholds,
        "detection": detection_metrics(report_rows),
        "liveness": liveness_metrics(liveness_rows, liveness_threshold),
        "recognition": {
            **recognition_metrics(report_recognition_rows, recognition_threshold),
            "target_far": target_far,
            "tar_at_far_1pct": tar_at_far(report_recognition_rows, 0.01),
            "tar_at_far_0_1pct": tar_at_far(report_recognition_rows, 0.001),
            "eer": recognition_eer(report_recognition_rows),
        },
        "end_to_end": {
            "real_accept_rate": safe_div(accepted_genuine, len(genuine_rows)),
            "spoof_reject_rate": (
                None
                if not spoof_rows
                else 1.0 - safe_div(accepted_spoofs, len(spoof_rows))
            ),
            "accepted_spoofs": accepted_spoofs,
            "decision_counts": dict(Counter(decisions)),
            "latency_ms": latency_metrics(report_rows),
        },
        "warnings": warnings,
    }


def detection_metrics(samples: list[Sample]) -> dict[str, float | int | None]:
    total = len(samples)
    success = sum(1 for sample in samples if detection_passed(sample))
    reasons = Counter(
        sample.detection_reason
        for sample in samples
        if sample.detection_reason is not None
    )
    landmark_total = sum(1 for sample in samples if sample.landmark_success is not None)
    landmark_success = sum(1 for sample in samples if landmark_passed(sample))

    return {
        "sample_count": total,
        "detection_success_rate": safe_div(success, total),
        "no_face_rate": reason_rate(reasons, "no_face", total),
        "multiple_face_rate": reason_rate(reasons, "multiple_faces", total),
        "landmark_availability_rate": (
            safe_div(landmark_success, total)
            if landmark_total > 0
            else safe_div(success, total)
        ),
    }


def reason_rate(reasons: Counter[str | None], reason: str, total: int) -> float | None:
    if not reasons:
        return None
    return safe_div(reasons[reason], total)


def liveness_metrics(
    samples: list[Sample],
    threshold: float,
) -> dict[str, float | int | None]:
    real_scores = [
        sample.liveness_score
        for sample in samples
        if sample.label == "real" and sample.liveness_score is not None
    ]
    spoof_scores = [
        sample.liveness_score
        for sample in samples
        if sample.label == "spoof" and sample.liveness_score is not None
    ]

    apcer = (
        None
        if not spoof_scores
        else safe_div(sum(score >= threshold for score in spoof_scores), len(spoof_scores))
    )
    bpcer = (
        None
        if not real_scores
        else safe_div(sum(score < threshold for score in real_scores), len(real_scores))
    )
    acer = mean_defined([apcer, bpcer])

    return {
        "sample_count": len(samples),
        "threshold": threshold,
        "apcer": apcer,
        "bpcer": bpcer,
        "acer": acer,
        "roc_auc": binary_auc(real_scores, spoof_scores),
    }


def recognition_metrics(
    samples: list[Sample],
    threshold: float,
) -> dict[str, float | int | None]:
    genuine_scores = [
        sample.best_match_score
        for sample in samples
        if sample.best_match_user == sample.user_id
        and sample.best_match_score is not None
    ]
    impostor_scores = [
        sample.best_match_score
        for sample in samples
        if sample.best_match_user != sample.user_id
        and sample.best_match_score is not None
    ]

    far = (
        None
        if not impostor_scores
        else safe_div(sum(score >= threshold for score in impostor_scores), len(impostor_scores))
    )
    frr = (
        None
        if not genuine_scores
        else safe_div(sum(score < threshold for score in genuine_scores), len(genuine_scores))
    )
    tar = None if frr is None else 1.0 - frr

    return {
        "sample_count": len(samples),
        "threshold": threshold,
        "far": far,
        "frr": frr,
        "tar": tar,
        "genuine_count": len(genuine_scores),
        "impostor_count": len(impostor_scores),
        "genuine_similarity": distribution(genuine_scores),
        "impostor_similarity": distribution(impostor_scores),
    }


def recognition_eer(samples: list[Sample]) -> float | None:
    rows = recognition_rows(samples)
    if not rows:
        return None
    candidates = threshold_candidates(row.best_match_score for row in rows)
    best = None
    for threshold in candidates:
        metrics = recognition_metrics(rows, threshold)
        far = metrics["far"]
        frr = metrics["frr"]
        if far is None or frr is None:
            continue
        candidate = (abs(far - frr), (far + frr) / 2)
        if best is None or candidate < best:
            best = candidate
    return None if best is None else best[1]


def tar_at_far(samples: list[Sample], target_far: float) -> float | None:
    rows = recognition_rows(samples)
    if not rows:
        return None
    candidates = threshold_candidates(row.best_match_score for row in rows)
    best_tar = None
    for threshold in candidates:
        metrics = recognition_metrics(rows, threshold)
        far = metrics["far"]
        frr = metrics["frr"]
        if far is None or frr is None:
            continue
        if far <= target_far:
            tar = 1.0 - frr
            best_tar = tar if best_tar is None else max(best_tar, tar)
    return best_tar


def auth_decision(sample: Sample, thresholds: dict[str, float]) -> str:
    if not detection_passed(sample):
        return "reject"
    if sample.liveness_score is None:
        return "reject"
    if sample.liveness_score < thresholds["livenessThreshold"]:
        return "spoof"
    if sample.embedding_generated is not True:
        return "reject"
    if sample.best_match_score is None or sample.best_match_user is None:
        return "reject"
    if sample.best_match_score >= thresholds["recognitionThreshold"]:
        return "accept"
    return "reject"


def score_output_row(sample: Sample, thresholds: dict[str, float]) -> dict[str, object]:
    return {
        "sample_id": sample.sample_id,
        "user_id": sample.user_id,
        "label": sample.label,
        "attack_type": sample.attack_type,
        "condition": sample.condition,
        "detection_success": bool_text(sample.detection_success),
        "liveness_score": number_text(sample.liveness_score),
        "embedding_generated": bool_text(sample.embedding_generated),
        "best_match_user": sample.best_match_user or "",
        "best_match_score": number_text(sample.best_match_score),
        "auth_decision": auth_decision(sample, thresholds),
        "detection_latency_ms": number_text(sample.detection_latency_ms),
        "liveness_latency_ms": number_text(sample.liveness_latency_ms),
        "recognition_latency_ms": number_text(sample.recognition_latency_ms),
        "total_latency_ms": number_text(sample.total_latency_ms),
    }


def latency_metrics(samples: list[Sample]) -> dict[str, float | int | None]:
    total = [sample.total_latency_ms for sample in samples if sample.total_latency_ms is not None]
    detection = [
        sample.detection_latency_ms
        for sample in samples
        if sample.detection_latency_ms is not None
    ]
    liveness = [
        sample.liveness_latency_ms
        for sample in samples
        if sample.liveness_latency_ms is not None
    ]
    recognition = [
        sample.recognition_latency_ms
        for sample in samples
        if sample.recognition_latency_ms is not None
    ]

    return {
        "total_p50": percentile(total, 50),
        "total_p95": percentile(total, 95),
        "detection_p50": percentile(detection, 50),
        "liveness_p50": percentile(liveness, 50),
        "recognition_p50": percentile(recognition, 50),
        "sample_count": len(total),
    }


def distribution(values: list[float]) -> dict[str, float | int | None]:
    return {
        "count": len(values),
        "min": min(values) if values else None,
        "max": max(values) if values else None,
        "mean": safe_div(sum(values), len(values)) if values else None,
        "p50": percentile(values, 50),
        "p95": percentile(values, 95),
    }


def percentile(values: list[float], percent: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, math.ceil((percent / 100) * len(ordered)) - 1))
    return ordered[index]


def binary_auc(positive_scores: list[float], negative_scores: list[float]) -> float | None:
    if not positive_scores or not negative_scores:
        return None
    wins = 0.0
    for positive in positive_scores:
        for negative in negative_scores:
            if positive > negative:
                wins += 1.0
            elif positive == negative:
                wins += 0.5
    return wins / (len(positive_scores) * len(negative_scores))


def safe_div(numerator: float, denominator: float) -> float | None:
    if denominator == 0:
        return None
    return numerator / denominator


def mean_defined(values: list[float | None]) -> float | None:
    defined = [value for value in values if value is not None]
    if not defined:
        return None
    return sum(defined) / len(defined)


def bool_text(value: bool | None) -> str:
    if value is None:
        return ""
    return "true" if value else "false"


def number_text(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:.6g}"


def write_json(path: Path, payload: object) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def write_scores_csv(path: Path, rows: list[dict[str, object]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SCORES_COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def write_summary(path: Path, metrics: dict[str, object]) -> None:
    thresholds = metrics["thresholds"]
    detection = metrics["detection"]
    liveness = metrics["liveness"]
    recognition = metrics["recognition"]
    end_to_end = metrics["end_to_end"]
    latency = end_to_end["latency_ms"]
    warnings = metrics["warnings"]

    lines = [
        "# Nirikshan ML Evaluation Summary",
        "",
        "## Thresholds",
        "",
        f"- Liveness: {thresholds['livenessThreshold']:.4f}",
        f"- Recognition: {thresholds['recognitionThreshold']:.4f}",
        "",
        "## Detection",
        "",
        f"- Success rate: {format_metric(detection['detection_success_rate'])}",
        f"- Landmark availability: {format_metric(detection['landmark_availability_rate'])}",
        "",
        "## Liveness",
        "",
        f"- APCER: {format_metric(liveness['apcer'])}",
        f"- BPCER: {format_metric(liveness['bpcer'])}",
        f"- ACER: {format_metric(liveness['acer'])}",
        f"- ROC AUC: {format_metric(liveness['roc_auc'])}",
        "",
        "## Recognition",
        "",
        f"- FAR: {format_metric(recognition['far'])}",
        f"- FRR: {format_metric(recognition['frr'])}",
        f"- EER: {format_metric(recognition['eer'])}",
        f"- TAR @ FAR 1%: {format_metric(recognition['tar_at_far_1pct'])}",
        f"- TAR @ FAR 0.1%: {format_metric(recognition['tar_at_far_0_1pct'])}",
        "",
        "## End To End",
        "",
        f"- Real accept rate: {format_metric(end_to_end['real_accept_rate'])}",
        f"- Spoof reject rate: {format_metric(end_to_end['spoof_reject_rate'])}",
        f"- p50 latency: {format_ms(latency['total_p50'])}",
        f"- p95 latency: {format_ms(latency['total_p95'])}",
        "",
    ]

    if warnings:
        lines.extend(["## Warnings", ""])
        lines.extend(f"- {warning}" for warning in warnings)
        lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def format_metric(value: object) -> str:
    if value is None:
        return "n/a"
    if isinstance(value, (int, float)):
        return f"{value:.4f}"
    return str(value)


def format_ms(value: object) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):.1f} ms"


if __name__ == "__main__":
    raise SystemExit(main())
