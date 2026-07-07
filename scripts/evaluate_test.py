import csv
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


class EvaluateScriptTest(unittest.TestCase):
    def test_generates_metrics_scores_thresholds_and_summary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            manifest = root / "manifest.csv"
            output = root / "report"
            write_manifest(manifest)

            subprocess.run(
                [
                    "python3",
                    "scripts/evaluate.py",
                    "--manifest",
                    str(manifest),
                    "--output",
                    str(output),
                ],
                cwd=Path(__file__).resolve().parents[1],
                check=True,
                capture_output=True,
                text=True,
            )

            self.assertTrue((output / "metrics.json").exists())
            self.assertTrue((output / "scores.csv").exists())
            self.assertTrue((output / "thresholds.json").exists())
            self.assertTrue((output / "summary.md").exists())

            metrics = json.loads((output / "metrics.json").read_text())
            self.assertEqual(metrics["input"]["sample_count"], 5)
            self.assertEqual(metrics["liveness"]["apcer"], 0.0)
            self.assertEqual(metrics["recognition"]["far"], 0.0)
            self.assertEqual(metrics["end_to_end"]["decision_counts"]["accept"], 1)


def write_manifest(path: Path):
    rows = [
        {
            "sample_id": "s001",
            "user_id": "u001",
            "path": "missing-real-dev.jpg",
            "label": "real",
            "attack_type": "none",
            "condition": "indoor",
            "split": "dev",
            "detection_success": "true",
            "landmark_success": "true",
            "liveness_score": "0.95",
            "embedding_generated": "true",
            "best_match_user": "u001",
            "best_match_score": "0.88",
            "detection_latency_ms": "7",
            "liveness_latency_ms": "18",
            "recognition_latency_ms": "22",
            "total_latency_ms": "67",
        },
        {
            "sample_id": "s002",
            "user_id": "u001",
            "path": "missing-spoof-dev.jpg",
            "label": "spoof",
            "attack_type": "print",
            "condition": "indoor",
            "split": "dev",
            "detection_success": "true",
            "landmark_success": "true",
            "liveness_score": "0.20",
            "embedding_generated": "false",
            "best_match_user": "",
            "best_match_score": "",
            "detection_latency_ms": "7",
            "liveness_latency_ms": "18",
            "recognition_latency_ms": "",
            "total_latency_ms": "34",
        },
        {
            "sample_id": "s101",
            "user_id": "u001",
            "path": "missing-real-test.jpg",
            "label": "real",
            "attack_type": "none",
            "condition": "outdoor",
            "split": "test",
            "detection_success": "true",
            "landmark_success": "true",
            "liveness_score": "0.96",
            "embedding_generated": "true",
            "best_match_user": "u001",
            "best_match_score": "0.89",
            "detection_latency_ms": "6",
            "liveness_latency_ms": "17",
            "recognition_latency_ms": "21",
            "total_latency_ms": "64",
        },
        {
            "sample_id": "s102",
            "user_id": "u002",
            "path": "missing-real-impostor-test.jpg",
            "label": "real",
            "attack_type": "none",
            "condition": "indoor",
            "split": "test",
            "detection_success": "true",
            "landmark_success": "true",
            "liveness_score": "0.93",
            "embedding_generated": "true",
            "best_match_user": "u001",
            "best_match_score": "0.61",
            "detection_latency_ms": "6",
            "liveness_latency_ms": "17",
            "recognition_latency_ms": "21",
            "total_latency_ms": "64",
        },
        {
            "sample_id": "s103",
            "user_id": "u002",
            "path": "missing-spoof-test.jpg",
            "label": "spoof",
            "attack_type": "screen",
            "condition": "indoor",
            "split": "test",
            "detection_success": "true",
            "landmark_success": "true",
            "liveness_score": "0.18",
            "embedding_generated": "false",
            "best_match_user": "",
            "best_match_score": "",
            "detection_latency_ms": "6",
            "liveness_latency_ms": "17",
            "recognition_latency_ms": "",
            "total_latency_ms": "34",
        },
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


if __name__ == "__main__":
    unittest.main()
