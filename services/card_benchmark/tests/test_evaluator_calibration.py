from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import pytest

from services.card_benchmark.evaluator_calibration import (
    DEFAULT_FIXTURES,
    LABELS,
    run_evaluator_calibration,
)


def test_calibration_covers_required_truth_labels_and_emits_confusion_matrix():
    summary, rows = run_evaluator_calibration()

    assert {row["goldLabel"] for row in rows} == set(LABELS)
    assert summary["caseCount"] == len(rows)
    assert sum(sum(values.values()) for values in summary["confusionMatrix"].values()) == len(rows)
    assert summary["falseAcceptanceCount"] >= 0
    assert summary["falseRejectionCount"] >= 0


def test_calibration_rejects_document_mechanics_without_hiding_semantic_gap():
    summary, rows = run_evaluator_calibration()
    trivial = next(row for row in rows if row["caseId"] == "bad-learning-item")
    paraphrase = next(row for row in rows if row["caseId"] == "entailed-semantic-paraphrase")

    assert trivial["actualLabel"] == "BAD_LEARNING_ITEM"
    assert trivial["actualDisposition"] == "REJECT"
    assert "LOW_EDUCATIONAL_VALUE" in trivial["trace"]["validationCodes"]
    assert paraphrase["actualLabel"] == "UNSUPPORTED"
    assert paraphrase["actualDisposition"] == "REJECT"
    assert summary["falseAcceptanceCount"] == 0
    assert summary["falseRejectionCount"] == 1
    assert summary["labelAccuracy"] == 0.9
    assert summary["dispositionAccuracy"] == 0.9


def test_default_trace_redacts_source_and_candidate_content():
    _summary, rows = run_evaluator_calibration()
    serialized = json.dumps(rows)

    assert "Estrogen promotes proliferative changes" not in serialized
    assert "questionSha256" in rows[0]["trace"]
    assert "answerSha256" in rows[0]["trace"]
    assert "evidenceTextSha256" in rows[0]["trace"]
    assert "sourceTextSha256" in rows[0]["trace"]
    assert all("claimText" not in claim for row in rows for claim in row["trace"]["claims"])


def test_content_trace_is_explicit_and_contains_full_diagnostic_chain():
    _summary, rows = run_evaluator_calibration(include_content=True)
    trace = next(row["trace"] for row in rows if row["caseId"] == "entailed-semantic-paraphrase")

    assert trace["question"]
    assert trace["answer"]
    assert trace["evidenceIds"] == ["E001"]
    assert trace["evidenceText"]
    assert trace["sourceText"]
    assert trace["claims"]
    assert "validationCodes" in trace
    assert "verificationResult" in trace
    assert "repairHistory" in trace
    assert trace["finalDisposition"] in {"PUBLISH", "REVIEW", "REJECT"}


def test_calibration_cli_writes_privacy_safe_report(tmp_path):
    output = tmp_path / "evaluator-calibration.json"
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "services.card_benchmark.evaluator_calibration",
            "--output",
            str(output),
        ],
        check=False,
        capture_output=True,
        text=True,
    )

    assert completed.returncode == 0, completed.stderr
    report = json.loads(output.read_text(encoding="utf-8"))
    assert report["summary"]["caseCount"] == len(report["cases"])
    assert "sourceText" not in report["cases"][0]["trace"]


def _reviewed_model_fixture() -> dict:
    source = json.loads(Path(DEFAULT_FIXTURES).read_text(encoding="utf-8"))
    case = source["cases"][0]
    case.pop("expectedDisposition")
    case.pop("rationale")
    labels = {case["caseId"]: case["goldLabel"]}
    return {
        "fixtureVersion": "1.0.0",
        "provenance": "model-generated-evaluation",
        "sourceGovernance": {
            "sourceArtifactSha256": "a" * 64,
            "sourceReference": "authorized-private-fixture",
            "sourceType": "user-upload",
            "evaluationUseAuthorized": True,
            "licenseUsageStatus": "approved",
            "containsSensitiveData": False,
            "trainingEligibility": "inference-only",
        },
        "labelReview": {
            "status": "approved",
            "independent": True,
            "lockedAt": "2026-09-30T00:00:00Z",
            "sourceFixtureSha256": "a" * 64,
            "reviews": [
                {
                    "reviewerId": "student",
                    "reviewerRole": "medical_student",
                    "labels": labels,
                    "reviewFileSha256": "b" * 64,
                },
                {
                    "reviewerId": "clinician",
                    "reviewerRole": "clinician",
                    "labels": labels,
                    "reviewFileSha256": "c" * 64,
                },
            ],
        },
        "cases": [case],
    }


def test_governed_reviewed_model_fixture_can_run_without_disposition_label(tmp_path):
    fixture = tmp_path / "reviewed-model-output.json"
    fixture.write_text(json.dumps(_reviewed_model_fixture()), encoding="utf-8")

    summary, rows = run_evaluator_calibration(fixture)

    assert summary["caseCount"] == 1
    assert summary["dispositionCaseCount"] == 0
    assert summary["dispositionAccuracy"] is None
    assert rows[0]["dispositionCorrect"] is None


def test_model_fixture_cannot_run_before_independent_labels_are_locked(tmp_path):
    payload = _reviewed_model_fixture()
    payload.pop("labelReview")
    fixture = tmp_path / "unreviewed-model-output.json"
    fixture.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="independently reviewed and locked"):
        run_evaluator_calibration(fixture)


def test_shallow_approved_review_metadata_cannot_unlock_model_labels(tmp_path):
    payload = _reviewed_model_fixture()
    payload["labelReview"] = {"status": "approved"}
    fixture = tmp_path / "shallow-approval.json"
    fixture.write_text(json.dumps(payload), encoding="utf-8")

    with pytest.raises(ValueError, match="independently reviewed and locked"):
        run_evaluator_calibration(fixture)
