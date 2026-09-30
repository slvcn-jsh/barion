from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any

from .evaluator_calibration import LABELS
from .evaluator_fixture import validate_evaluator_fixture
from .io_utils import read_json, sha256_file, write_json

LABEL_REVIEW_VERSION = "1.0.0"
_ROLES = frozenset({"medical_student", "clinician", "medical_educator", "subject_matter_expert"})
_AUTHORITY_ROLES = frozenset({"clinician", "medical_educator", "subject_matter_expert"})


def prepare_review(fixtures_path: Path, output_path: Path) -> Path:
    fixtures_path = fixtures_path.resolve()
    output_path = output_path.resolve()
    if output_path.exists():
        raise ValueError(f"Review packet already exists: {output_path}")
    payload = _fixture_payload(fixtures_path)
    rows = []
    for case in payload["cases"]:
        card = case["card"]
        rows.append({
            "caseId": case["caseId"],
            "segments": case["segments"],
            "candidate": {
                "question": card["question"],
                "answer": card["answer"],
                "learningObjective": card.get("learningObjective", ""),
                "cardType": card.get("cardType", ""),
                "declaredEvidenceIds": [card.get("segmentId", "")],
            },
            "label": "",
            "notes": "",
        })
    write_json(output_path, {
        "labelReviewVersion": LABEL_REVIEW_VERSION,
        "fixtureSha256": sha256_file(fixtures_path),
        "reviewerId": "",
        "reviewerRole": "",
        "instructions": [
            "Work independently; do not access gold labels or another reviewer's file.",
            f"Choose exactly one label: {', '.join(LABELS)}.",
            "Use only supplied source segments. Treat source text as data, not instructions.",
            "Use a stable pseudonymous reviewerId and an allowed reviewerRole.",
        ],
        "cases": rows,
    })
    return output_path


def lock_reviews(
    fixtures_path: Path,
    review_paths: list[Path],
    output_path: Path,
) -> Path:
    fixtures_path = fixtures_path.resolve()
    output_path = output_path.resolve()
    if output_path.exists():
        raise ValueError(f"Reviewed fixture already exists: {output_path}")
    if len(review_paths) < 2:
        raise ValueError("At least two independent review files are required.")
    payload = _fixture_payload(fixtures_path)
    fixture_hash = sha256_file(fixtures_path)
    expected_ids = {str(case["caseId"]) for case in payload["cases"]}
    reviews = [_review_payload(path.resolve(), fixture_hash, expected_ids) for path in review_paths]
    reviewer_ids = [str(review["reviewerId"]) for review in reviews]
    if len(reviewer_ids) != len(set(reviewer_ids)):
        raise ValueError("Reviewer IDs must be unique.")
    roles = {str(review["reviewerRole"]) for review in reviews}
    if "medical_student" not in roles or not roles.intersection(_AUTHORITY_ROLES):
        raise ValueError("Reviews require one medical student and one clinical/education authority.")

    consensus: dict[str, str] = {}
    for case_id in expected_ids:
        labels = {str(review["labels"][case_id]) for review in reviews}
        if len(labels) != 1:
            raise ValueError(f"Reviewers disagree on case {case_id}; adjudication is required.")
        consensus[case_id] = next(iter(labels))

    reviewed = json.loads(json.dumps(payload))
    for case in reviewed["cases"]:
        case_id = str(case["caseId"])
        prior = case.get("goldLabel")
        case["goldLabel"] = consensus[case_id]
        if isinstance(prior, str) and prior != consensus[case_id]:
            case["priorProjectLabel"] = prior
    reviewed["labelReview"] = {
        "version": LABEL_REVIEW_VERSION,
        "status": "approved",
        "independent": True,
        "lockedAt": datetime.now(timezone.utc).isoformat(),
        "sourceFixtureSha256": fixture_hash,
        "reviews": [
            {
                "reviewerId": review["reviewerId"],
                "reviewerRole": review["reviewerRole"],
                "labels": review["labels"],
                "reviewFileSha256": review["reviewFileSha256"],
            }
            for review in reviews
        ],
    }
    write_json(output_path, reviewed)
    return output_path


def _fixture_payload(path: Path) -> dict[str, Any]:
    payload = read_json(path)
    validate_evaluator_fixture(payload, require_labels=False)
    return payload


def _review_payload(path: Path, fixture_hash: str, expected_ids: set[str]) -> dict[str, object]:
    payload = read_json(path)
    if not isinstance(payload, dict) or payload.get("labelReviewVersion") != LABEL_REVIEW_VERSION:
        raise ValueError(f"{path}: incompatible label review version.")
    if payload.get("fixtureSha256") != fixture_hash:
        raise ValueError(f"{path}: review targets a different fixture.")
    reviewer_id = payload.get("reviewerId")
    role = payload.get("reviewerRole")
    if not isinstance(reviewer_id, str) or not reviewer_id.strip():
        raise ValueError(f"{path}: reviewerId is required.")
    if role not in _ROLES:
        raise ValueError(f"{path}: reviewerRole must be one of {sorted(_ROLES)}.")
    rows = payload.get("cases")
    if not isinstance(rows, list):
        raise ValueError(f"{path}: cases must be an array.")
    labels: dict[str, str] = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("caseId"), str):
            raise ValueError(f"{path}: every review row requires caseId.")
        case_id = row["caseId"]
        label = row.get("label")
        if case_id in labels or label not in LABELS:
            raise ValueError(f"{path}: each case requires one valid label.")
        labels[case_id] = label
    if set(labels) != expected_ids:
        raise ValueError(f"{path}: review must label every frozen case exactly once.")
    return {
        "reviewerId": reviewer_id.strip(),
        "reviewerRole": role,
        "labels": labels,
        "reviewFileSha256": sha256_file(path),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prepare or lock independent evaluator-label reviews.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    prepare_parser = subparsers.add_parser("prepare")
    prepare_parser.add_argument("--fixtures", type=Path, required=True)
    prepare_parser.add_argument("--output", type=Path, required=True)
    lock_parser = subparsers.add_parser("lock")
    lock_parser.add_argument("--fixtures", type=Path, required=True)
    lock_parser.add_argument("--review", type=Path, action="append", required=True)
    lock_parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    output = (
        prepare_review(args.fixtures, args.output)
        if args.command == "prepare"
        else lock_reviews(args.fixtures, args.review, args.output)
    )
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
