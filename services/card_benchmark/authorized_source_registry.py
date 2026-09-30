from __future__ import annotations

import argparse
import csv
from datetime import datetime
import json
from pathlib import Path
import re
from typing import Any

import pymupdf

from .io_utils import canonical_json, read_json, sha256_file, sha256_text, write_json

REGISTRY_VERSION = "1.0.0"
AUTHORIZATION_VERSION = "1.0.0"
_INPUT_EXTENSIONS = frozenset({".pdf", ".md", ".txt"})
_SECRET_PATTERN = re.compile(
    r"(?i)(api[_ -]?key|secret[_ -]?key|password|bearer\s+[A-Za-z0-9._-]{12,}|"
    r"BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY|supabase_service|gemini_api_key|groq_api_key)"
)
_PII_PATTERN = re.compile(
    r"(?i)(patient\s+(?:name|id|mrn)|medical record number|date of birth|\bDOB\b|"
    r"@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\b\+?\d{1,3}[-. (]*\d{3}[-. )]*\d{3}[-. ]*\d{4}\b|"
    r"\b\d{3}-\d{2}-\d{4}\b)"
)


def build_registry(pack_path: Path, authorization_path: Path, output_path: Path) -> Path:
    pack_path = pack_path.resolve()
    authorization_path = authorization_path.resolve()
    output_path = output_path.resolve()
    if output_path.exists():
        raise ValueError(f"Authorized source registry already exists: {output_path}")
    authorization = _authorization(read_json(authorization_path))
    manifest_path = pack_path / "benchmark_manifest.csv"
    rows = _manifest_rows(manifest_path)
    source_ids = [row["id"] for row in rows]
    if len(source_ids) != len(set(source_ids)):
        raise ValueError("Benchmark manifest source IDs must be unique.")

    artifacts = []
    for row in rows:
        relative = Path(row["file"])
        path = (pack_path / relative).resolve()
        _require_within(path, pack_path / "inputs")
        if not path.is_file() or path.suffix.lower() not in _INPUT_EXTENSIONS:
            raise ValueError(f"Benchmark input is missing or unsupported: {relative.as_posix()}")
        text, page_count = extract_registered_text(path)
        secret_count = len(_SECRET_PATTERN.findall(text))
        pii_count = len(_PII_PATTERN.findall(text))
        if secret_count or pii_count:
            raise ValueError(f"Benchmark input failed sensitive-content screening: {row['id']}")
        artifacts.append({
            "sourceId": row["id"],
            "relativePath": relative.as_posix(),
            "format": row["format"],
            "bytes": path.stat().st_size,
            "artifactSha256": sha256_file(path),
            "extractedTextSha256": sha256_text(text),
            "extractedCharacterCount": len(text),
            "pageCount": page_count,
            "lengthClass": row["length_class"],
            "sourceStyle": row["source_style"],
            "primaryTest": row["primary_test"],
            "sensitiveScan": {"secretMatchCount": 0, "piiMatchCount": 0},
        })

    gold_standard_path = pack_path / "evaluation" / "gold_standard.json"
    gold_standard = read_json(gold_standard_path)
    if not isinstance(gold_standard, dict) or set(gold_standard) != set(source_ids):
        raise ValueError("Gold standard source IDs must exactly match benchmark manifest IDs.")
    concept_ids = _gold_concept_source_ids(pack_path / "evaluation" / "gold_concepts.csv")
    if concept_ids != set(source_ids):
        raise ValueError("Gold concept source IDs must exactly match benchmark manifest IDs.")

    evaluation_artifacts = []
    for path in sorted((pack_path / "evaluation").rglob("*")):
        if path.is_file():
            evaluation_artifacts.append({
                "relativePath": path.relative_to(pack_path).as_posix(),
                "bytes": path.stat().st_size,
                "sha256": sha256_file(path),
            })
    artifact_identity = [
        {key: artifact[key] for key in ("sourceId", "relativePath", "artifactSha256")}
        for artifact in artifacts
    ]
    payload = {
        "registryVersion": REGISTRY_VERSION,
        "packReference": authorization["packReference"],
        "authorizationSha256": sha256_file(authorization_path),
        "manifestSha256": sha256_file(manifest_path),
        "packIdentitySha256": sha256_text(canonical_json(artifact_identity)),
        "sourceCount": len(artifacts),
        "hiddenEvaluationArtifactCount": len(evaluation_artifacts),
        "dataUse": {
            "authorizationBasis": authorization["authorizationBasis"],
            "authorizedAt": authorization["authorizedAt"],
            "evaluationUseAuthorized": True,
            "trainingUseAuthorized": authorization["trainingUseAuthorized"],
            "trainingConsent": authorization["trainingConsent"],
            "licenseUsageStatus": "approved",
            "containsSensitiveData": False,
            "trainingEligibility": "candidate",
            "publicDistributionAuthorized": authorization["publicDistributionAuthorized"],
        },
        "invariants": {
            "rawContentIncluded": False,
            "goldSeparatedFromInputs": True,
            "modelOutputIsTrainingTruth": False,
            "recordLevelReviewRequiredBeforeTraining": True,
        },
        "sources": artifacts,
        "hiddenEvaluationArtifacts": evaluation_artifacts,
    }
    write_json(output_path, payload)
    return output_path


def _authorization(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("authorizationVersion") != AUTHORIZATION_VERSION:
        raise ValueError("Source authorization declaration is missing or incompatible.")
    required_strings = (
        "authorizationBasis", "authorizedAt", "packReference", "sourceType",
        "trainingConsent", "licenseUsageStatus", "sensitivityStatus", "trainingEligibility",
    )
    if any(not isinstance(value.get(field), str) or not value[field].strip() for field in required_strings):
        raise ValueError("Source authorization declaration is incomplete.")
    if value.get("evaluationUseAuthorized") is not True:
        raise ValueError("Benchmark pack is not authorized for evaluation use.")
    if value.get("trainingUseAuthorized") is not True or value.get("trainingConsent") != "explicit":
        raise ValueError("Benchmark pack lacks explicit training-candidate authorization.")
    if value.get("licenseUsageStatus") != "approved":
        raise ValueError("Benchmark pack usage rights are not approved.")
    if value.get("containsSensitiveData") is not False:
        raise ValueError("Sensitive or unclassified benchmark content cannot be registered.")
    if value.get("trainingEligibility") != "candidate":
        raise ValueError("Raw benchmark sources must enter as training candidates, not training truth.")
    if not isinstance(value.get("publicDistributionAuthorized"), bool):
        raise ValueError("Public-distribution authorization must be explicit.")
    if not _valid_timestamp(value["authorizedAt"]):
        raise ValueError("Authorization timestamp must be timezone-aware ISO 8601.")
    return value


def _manifest_rows(path: Path) -> list[dict[str, str]]:
    required = {
        "id", "format", "file", "approx_words", "length_class", "source_style", "primary_test",
    }
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or set(reader.fieldnames) != required:
            raise ValueError("Benchmark manifest columns are incompatible.")
        rows = list(reader)
    if not rows or any(not all(str(row.get(field, "")).strip() for field in required) for row in rows):
        raise ValueError("Benchmark manifest rows must be complete.")
    return rows


def _gold_concept_source_ids(path: Path) -> set[str]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != ["source_id", "concept_id", "gold_concept"]:
            raise ValueError("Gold concept columns are incompatible.")
        rows = list(reader)
    if not rows or any(not row["source_id"] or not row["concept_id"] or not row["gold_concept"] for row in rows):
        raise ValueError("Gold concept rows must be complete.")
    concept_ids = [row["concept_id"] for row in rows]
    if len(concept_ids) != len(set(concept_ids)):
        raise ValueError("Gold concept IDs must be unique.")
    return {row["source_id"] for row in rows}


def extract_registered_text(path: Path) -> tuple[str, int | None]:
    if path.suffix.lower() != ".pdf":
        return path.read_text(encoding="utf-8"), None
    document = pymupdf.open(path)
    try:
        if document.needs_pass:
            raise ValueError(f"Benchmark PDF is password protected: {path.name}")
        text = "\n".join(page.get_text("text", sort=True) for page in document)
        return text, document.page_count
    finally:
        document.close()


def _require_within(path: Path, root: Path) -> None:
    try:
        path.relative_to(root.resolve())
    except ValueError as error:
        raise ValueError("Benchmark manifest path escapes the inputs directory.") from error


def _valid_timestamp(value: str) -> bool:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is not None
    except ValueError:
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Create a content-free registry for an authorized benchmark pack.")
    parser.add_argument("--pack", type=Path, required=True)
    parser.add_argument("--authorization", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    print(build_registry(args.pack, args.authorization, args.output))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
