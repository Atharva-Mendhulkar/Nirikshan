#!/usr/bin/env python3
"""Download upstream model artifacts for Nirikshan.

Raw model files are intentionally stored under models/raw/, which is ignored by
git. The mobile app still needs converted .tflite assets under
mobile/src/assets/models/ after conversion and validation.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RAW_DIR = ROOT / "models" / "raw"


@dataclass(frozen=True)
class Artifact:
    id: str
    url: str
    path: Path
    min_bytes: int
    sha256: str | None = None


ARTIFACTS = [
    Artifact(
        id="yunet_onnx",
        url=(
            "https://huggingface.co/opencv/opencv_zoo/resolve/main/"
            "models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
        ),
        path=RAW_DIR / "face_detection_yunet_2023mar.onnx",
        min_bytes=200_000,
    ),
    Artifact(
        id="minifasnet_v2_onnx",
        url=(
            "https://huggingface.co/garciafido/"
            "minifasnet-v2-anti-spoofing-onnx/resolve/main/minifasnet_v2.onnx"
        ),
        path=RAW_DIR / "minifasnet_v2.onnx",
        min_bytes=1_500_000,
        sha256="d7b3cd9ba8a7ceb13baa8c4720902e27ca3112eff52f926c08804af6b6eecc7b",
    ),
    Artifact(
        id="minifasnet_v2_pth",
        url=(
            "https://github.com/minivision-ai/Silent-Face-Anti-Spoofing/raw/"
            "master/resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth"
        ),
        path=RAW_DIR / "2.7_80x80_MiniFASNetV2.pth",
        min_bytes=1_000_000,
        sha256="a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0",
    ),
    Artifact(
        id="insightface_buffalo_s_zip",
        url="https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_s.zip",
        path=RAW_DIR / "buffalo_s.zip",
        min_bytes=50_000_000,
    ),
]


def main() -> int:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    manifest: list[dict[str, object]] = []

    for artifact in ARTIFACTS:
        download_artifact(artifact)
        manifest.append(describe_file(artifact.id, artifact.path, artifact.url))

    extracted = extract_buffalo_s_recognition_model()
    manifest.append(
        describe_file(
            "insightface_w600k_mbf_onnx",
            extracted,
            "extracted from buffalo_s.zip",
        )
    )

    manifest_path = RAW_DIR / "MANIFEST.json"
    manifest_path.write_text(
        json.dumps(
            {
                "note": "Raw source model artifacts. Do not commit these files.",
                "artifacts": manifest,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {manifest_path.relative_to(ROOT)}")
    print("Next: convert ONNX/PTH artifacts to TFLite and validate tensor shapes.")
    return 0


def download_artifact(artifact: Artifact) -> None:
    if artifact.path.exists():
        print(f"Using existing {artifact.path.relative_to(ROOT)}")
    else:
        print(f"Downloading {artifact.id}...")
        request = urllib.request.Request(
            artifact.url,
            headers={"User-Agent": "NirikshanModelDownloader/1.0"},
        )
        with urllib.request.urlopen(request, timeout=120) as response:
            with artifact.path.open("wb") as handle:
                shutil.copyfileobj(response, handle)

    size = artifact.path.stat().st_size
    if size < artifact.min_bytes:
        raise SystemExit(
            f"{artifact.path} is too small ({size} bytes). "
            "The download is probably an HTML/error page."
        )

    digest = sha256_file(artifact.path)
    if artifact.sha256 and digest != artifact.sha256:
        raise SystemExit(
            f"SHA-256 mismatch for {artifact.path.name}: "
            f"expected {artifact.sha256}, got {digest}"
        )

    print(
        f"OK {artifact.path.relative_to(ROOT)} "
        f"({size:,} bytes, sha256={digest[:12]}...)"
    )


def extract_buffalo_s_recognition_model() -> Path:
    zip_path = RAW_DIR / "buffalo_s.zip"
    output_path = RAW_DIR / "w600k_mbf.onnx"

    if output_path.exists():
        print(f"Using existing {output_path.relative_to(ROOT)}")
        return output_path

    with zipfile.ZipFile(zip_path) as archive:
        candidates = [
            name for name in archive.namelist()
            if name.endswith("w600k_mbf.onnx")
        ]
        if not candidates:
            raise SystemExit("buffalo_s.zip does not contain w600k_mbf.onnx")
        source_name = candidates[0]
        with archive.open(source_name) as source:
            with output_path.open("wb") as target:
                shutil.copyfileobj(source, target)

    size = output_path.stat().st_size
    if size < 10_000_000:
        raise SystemExit(
            f"{output_path} is too small ({size} bytes). Extraction failed."
        )

    digest = sha256_file(output_path)
    print(
        f"OK {output_path.relative_to(ROOT)} "
        f"({size:,} bytes, sha256={digest[:12]}...)"
    )
    return output_path


def describe_file(id_: str, path: Path, source: str) -> dict[str, object]:
    return {
        "id": id_,
        "path": str(path.relative_to(ROOT)),
        "source": source,
        "size_bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Interrupted", file=sys.stderr)
        raise SystemExit(130)
