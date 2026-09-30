from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path
from typing import Any

from services.card_evaluation.models import Card, Segment
from services.card_evaluation.pipeline import evaluate_production_candidate
from services.card_evaluation.verification import VerificationCoordinator
from services.source_span import resolve_source_span

from .evaluator_fixture import (
    is_model_generated_fixture,
    label_review_authorization,
    validate_evaluator_fixture,
)
from .io_utils import read_json, sha256_text, write_json

CALIBRATION_VERSION = "1.0.0"
LABELS = ("ENTAILED", "UNSUPPORTED", "CONTRADICTED", "AMBIGUOUS", "BAD_LEARNING_ITEM")
DEFAULT_FIXTURES = Path(__file__).resolve().parent / "fixtures" / "evaluator_calibration.json"


def run_evaluator_calibration(
    path: Path = DEFAULT_FIXTURES,
    *,
    include_content: bool = False,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    payload = read_json(path)
    if payload.get("fixtureVersion") != CALIBRATION_VERSION:
        raise ValueError(f"Unsupported evaluator calibration fixture version: {payload.get('fixtureVersion')!r}.")
    cases = validate_evaluator_fixture(payload, require_labels=True)
    if is_model_generated_fixture(payload):
        authorization = label_review_authorization(payload, cases, allowed_labels=LABELS)
        if not authorization["eligible"]:
            raise ValueError("Model-generated evaluator labels must be independently reviewed and locked.")

    rows = [_evaluate_case(case, include_content=include_content) for case in cases]
    return _summary(rows), rows


def _evaluate_case(case: dict[str, Any], *, include_content: bool) -> dict[str, object]:
    segments = [Segment(**raw) for raw in case["segments"]]
    raw_card = dict(case["card"])
    segment = next((item for item in segments if item.segmentId == raw_card["segmentId"]), None)
    if segment is None:
        raise ValueError(f"Calibration case {case['caseId']!r} references a missing segment.")
    raw_card["evidenceSpan"] = resolve_source_span(segment.text, raw_card["evidenceText"]).to_dict()
    original = Card(**raw_card)
    _effective, evaluation = evaluate_production_candidate(
        original,
        segments,
        VerificationCoordinator(),
    )
    actual_label = _classify(evaluation)
    expected_label = str(case["goldLabel"])
    if expected_label not in LABELS:
        raise ValueError(f"Unknown calibration label: {expected_label!r}.")

    trace = _trace(case, segments, evaluation, include_content=include_content)
    expected_disposition = case.get("expectedDisposition")
    return {
        "caseId": case["caseId"],
        "goldLabel": expected_label,
        "actualLabel": actual_label,
        "labelCorrect": actual_label == expected_label,
        "expectedDisposition": expected_disposition,
        "actualDisposition": evaluation["publicationDisposition"],
        "dispositionCorrect": (
            expected_disposition == evaluation["publicationDisposition"]
            if isinstance(expected_disposition, str)
            else None
        ),
        "rationale": case.get("rationale", ""),
        "trace": trace,
    }


def _classify(evaluation: dict[str, object]) -> str:
    claims = [
        item for item in evaluation.get("claimResults", [])
        if item.get("field") in {"question", "core_answer"}
    ]
    reason_codes = set(evaluation.get("reasonCodes", []))
    if not claims or reason_codes & {"NO_FACTUAL_CORE_CLAIM", "LOW_EDUCATIONAL_VALUE"}:
        return "BAD_LEARNING_ITEM"
    statuses = {str(item.get("sourceSupport")) for item in claims}
    if "contradicted" in statuses:
        return "CONTRADICTED"
    if "unsupported" in statuses:
        return "UNSUPPORTED"
    if any(str(item.get("citationStatus")) in {"missing", "stale", "uncertain", "wrong_segment"} for item in claims):
        return "AMBIGUOUS"
    if "uncertain" in statuses:
        return "AMBIGUOUS"
    if statuses <= {"supported_by_citation", "supported_by_segment", "supported_elsewhere_in_source"}:
        return "ENTAILED"
    return "AMBIGUOUS"


def _trace(
    case: dict[str, Any],
    segments: list[Segment],
    evaluation: dict[str, object],
    *,
    include_content: bool,
) -> dict[str, object]:
    card = case["card"]
    claims = evaluation.get("claimResults", [])
    validation_codes = sorted(set(evaluation.get("validationCodes", [])))
    trace: dict[str, object] = {
        "traceVersion": CALIBRATION_VERSION,
        "candidateId": card["cardId"],
        "evidenceIds": [item.segmentId for item in segments],
        "sourceSpan": evaluation.get("sourceSpan"),
        "claims": claims if include_content else [_redact_claim(item) for item in claims],
        "validationCodes": validation_codes,
        "verificationResult": {
            "medicalRisk": evaluation.get("medicalRisk"),
            "status": evaluation.get("medicalVerificationStatus"),
        },
        "repairHistory": evaluation.get("sanitization"),
        "finalDisposition": evaluation.get("publicationDisposition"),
        "reasonCodes": evaluation.get("reasonCodes", []),
    }
    if include_content:
        trace.update({
            "question": card["question"],
            "answer": card["answer"],
            "evidenceText": card["evidenceText"],
            "sourceText": [item.text for item in segments],
        })
    else:
        trace.update({
            "questionSha256": sha256_text(card["question"]),
            "answerSha256": sha256_text(card["answer"]),
            "evidenceTextSha256": sha256_text(card["evidenceText"]),
            "sourceTextSha256": [sha256_text(item.text) for item in segments],
        })
    return trace


def _redact_claim(claim: dict[str, object]) -> dict[str, object]:
    return {
        key: value
        for key, value in claim.items()
        if key not in {"claimText", "supportingEvidence", "contradictionEvidence"}
    } | {"claimTextSha256": sha256_text(str(claim.get("claimText", "")))}


def _summary(rows: list[dict[str, object]]) -> dict[str, object]:
    matrix = {expected: {actual: 0 for actual in LABELS} for expected in LABELS}
    for row in rows:
        matrix[str(row["goldLabel"])][str(row["actualLabel"])] += 1
    false_acceptance = sum(
        row["goldLabel"] != "ENTAILED" and row["actualLabel"] == "ENTAILED"
        for row in rows
    )
    false_rejection = sum(
        row["goldLabel"] == "ENTAILED" and row["actualLabel"] != "ENTAILED"
        for row in rows
    )
    expected_counts = Counter(str(row["goldLabel"]) for row in rows)
    actual_counts = Counter(str(row["actualLabel"]) for row in rows)
    correct = sum(bool(row["labelCorrect"]) for row in rows)
    disposition_rows = [row for row in rows if isinstance(row["expectedDisposition"], str)]
    disposition_correct = sum(bool(row["dispositionCorrect"]) for row in disposition_rows)
    return {
        "calibrationVersion": CALIBRATION_VERSION,
        "caseCount": len(rows),
        "correctLabelCount": correct,
        "labelAccuracy": round(correct / len(rows), 4) if rows else 0.0,
        "correctDispositionCount": disposition_correct,
        "dispositionCaseCount": len(disposition_rows),
        "dispositionAccuracy": (
            round(disposition_correct / len(disposition_rows), 4)
            if disposition_rows else None
        ),
        "falseAcceptanceCount": false_acceptance,
        "falseRejectionCount": false_rejection,
        "expectedLabelCounts": dict(sorted(expected_counts.items())),
        "actualLabelCounts": dict(sorted(actual_counts.items())),
        "confusionMatrix": matrix,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run production evaluator against human-labeled project fixtures.")
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--include-content",
        action="store_true",
        help="Include project-authored fixture text. Default output contains hashes only.",
    )
    args = parser.parse_args()
    summary, rows = run_evaluator_calibration(args.fixtures, include_content=args.include_content)
    write_json(args.output, {"summary": summary, "cases": rows})


if __name__ == "__main__":
    main()
