from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.card_benchmark.evaluator_calibration import DEFAULT_FIXTURES
from services.card_benchmark.evaluator_label_review import lock_reviews, prepare_review


def _completed_review(packet_path: Path, output: Path, reviewer_id: str, role: str, *, changed_label=None):
    payload = json.loads(packet_path.read_text(encoding="utf-8"))
    source = json.loads(Path(DEFAULT_FIXTURES).read_text(encoding="utf-8"))
    labels = {case["caseId"]: case["goldLabel"] for case in source["cases"]}
    if changed_label:
        labels[changed_label[0]] = changed_label[1]
    payload["reviewerId"] = reviewer_id
    payload["reviewerRole"] = role
    for row in payload["cases"]:
        row["label"] = labels[row["caseId"]]
    output.write_text(json.dumps(payload), encoding="utf-8")
    return output


def test_prepare_review_blinds_existing_gold_labels(tmp_path):
    output = prepare_review(DEFAULT_FIXTURES, tmp_path / "review.json")
    packet = json.loads(output.read_text(encoding="utf-8"))
    serialized = json.dumps(packet)

    assert packet["fixtureSha256"]
    assert packet["reviewerId"] == ""
    assert all(row["label"] == "" for row in packet["cases"])
    assert "goldLabel" not in serialized
    assert "expectedDisposition" not in serialized
    assert "rationale" not in serialized


def test_lock_reviews_requires_complete_cross_role_consensus(tmp_path):
    packet = prepare_review(DEFAULT_FIXTURES, tmp_path / "packet.json")
    student = _completed_review(packet, tmp_path / "student.json", "student-1", "medical_student")
    clinician = _completed_review(packet, tmp_path / "clinician.json", "clinician-1", "clinician")

    output = lock_reviews(DEFAULT_FIXTURES, [student, clinician], tmp_path / "reviewed.json")
    reviewed = json.loads(output.read_text(encoding="utf-8"))

    assert reviewed["labelReview"]["status"] == "approved"
    assert reviewed["labelReview"]["sourceFixtureSha256"]
    assert len(reviewed["labelReview"]["reviews"]) == 2
    assert all(review["reviewFileSha256"] for review in reviewed["labelReview"]["reviews"])


def test_lock_reviews_rejects_disagreement_and_preserves_original(tmp_path):
    packet = prepare_review(DEFAULT_FIXTURES, tmp_path / "packet.json")
    student = _completed_review(packet, tmp_path / "student.json", "student-1", "medical_student")
    clinician = _completed_review(
        packet,
        tmp_path / "clinician.json",
        "clinician-1",
        "clinician",
        changed_label=("entailed-semantic-paraphrase", "UNSUPPORTED"),
    )
    original = Path(DEFAULT_FIXTURES).read_bytes()

    with pytest.raises(ValueError, match="adjudication"):
        lock_reviews(DEFAULT_FIXTURES, [student, clinician], tmp_path / "reviewed.json")

    assert Path(DEFAULT_FIXTURES).read_bytes() == original
    assert not (tmp_path / "reviewed.json").exists()


def test_review_packets_and_locked_outputs_are_immutable(tmp_path):
    packet = prepare_review(DEFAULT_FIXTURES, tmp_path / "packet.json")
    with pytest.raises(ValueError, match="already exists"):
        prepare_review(DEFAULT_FIXTURES, packet)


def _unlabeled_model_fixture() -> dict:
    source = json.loads(Path(DEFAULT_FIXTURES).read_text(encoding="utf-8"))
    case = source["cases"][0]
    case.pop("goldLabel")
    case.pop("expectedDisposition")
    case.pop("rationale")
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
            "trainingUseAuthorized": True,
            "trainingConsent": "explicit",
        },
        "cases": [case],
    }


def test_unlabeled_governed_model_output_can_be_independently_locked(tmp_path):
    fixture_path = tmp_path / "model-output.json"
    fixture_path.write_text(json.dumps(_unlabeled_model_fixture()), encoding="utf-8")
    packet = prepare_review(fixture_path, tmp_path / "packet.json")
    student_payload = json.loads(packet.read_text(encoding="utf-8"))
    clinician_payload = json.loads(packet.read_text(encoding="utf-8"))
    for payload, reviewer_id, role in (
        (student_payload, "student-1", "medical_student"),
        (clinician_payload, "clinician-1", "clinician"),
    ):
        payload["reviewerId"] = reviewer_id
        payload["reviewerRole"] = role
        payload["cases"][0]["label"] = "ENTAILED"
    student = tmp_path / "student.json"
    clinician = tmp_path / "clinician.json"
    student.write_text(json.dumps(student_payload), encoding="utf-8")
    clinician.write_text(json.dumps(clinician_payload), encoding="utf-8")

    output = lock_reviews(fixture_path, [student, clinician], tmp_path / "reviewed.json")
    reviewed = json.loads(output.read_text(encoding="utf-8"))

    assert reviewed["cases"][0]["goldLabel"] == "ENTAILED"
    assert reviewed["provenance"] == "model-generated-evaluation"
    assert reviewed["sourceGovernance"]["trainingEligibility"] == "inference-only"
    assert reviewed["sourceGovernance"]["trainingUseAuthorized"] is True


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("evaluationUseAuthorized", False, "not authorized"),
        ("licenseUsageStatus", "unknown", "rights must be approved"),
        ("containsSensitiveData", True, "Sensitive or unclassified"),
        ("trainingEligibility", "eligible", "inference-only"),
    ],
)
def test_model_output_review_fails_closed_on_governance(field, value, message, tmp_path):
    fixture = _unlabeled_model_fixture()
    fixture["sourceGovernance"][field] = value
    fixture_path = tmp_path / "unauthorized.json"
    fixture_path.write_text(json.dumps(fixture), encoding="utf-8")

    with pytest.raises(ValueError, match=message):
        prepare_review(fixture_path, tmp_path / "packet.json")
