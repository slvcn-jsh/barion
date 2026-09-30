import pytest

from services.card_benchmark.dataset_governance import (
    validate_dataset_record,
    validate_feedback_event,
)


def _record(**changes):
    value = {
        "exampleId": "example-001",
        "datasetVersion": "bari-cardgen-gold-v1",
        "task": "CARD_GENERATION",
        "sourceType": "project-authored-fixture",
        "sourceReference": "fixture-anatomy",
        "input": {"segments": [{"segmentId": "s1", "text": "The atrium receives blood."}]},
        "expectedOutput": {"candidates": [{"question": "What receives blood?", "answer": "The atrium."}]},
        "qualityStatus": "gold",
        "reviewStatus": "human-approved",
        "provenance": "human-authored",
        "licenseUsageStatus": "approved",
        "createdAt": "2026-09-29T00:00:00Z",
        "promptVersion": "bari-cardgen-v1",
        "modelOrigin": None,
        "humanEdited": False,
        "rejectionReason": None,
        "trainingEligibility": "eligible",
        "trainingConsent": "not-required",
        "sourceUseAuthorized": True,
        "containsSensitiveData": False,
        "split": "train",
    }
    value.update(changes)
    return value


def test_gold_record_requires_review_provenance_license_and_privacy_clearance():
    validate_dataset_record(_record())
    for changes in (
        {"reviewStatus": "unreviewed"},
        {"licenseUsageStatus": "unknown"},
        {"containsSensitiveData": True},
        {"sourceUseAuthorized": False},
        {"trainingConsent": "unknown"},
    ):
        with pytest.raises(ValueError):
            validate_dataset_record(_record(**changes))


def test_user_upload_never_becomes_training_data_without_explicit_consent():
    with pytest.raises(ValueError, match="explicit consent"):
        validate_dataset_record(_record(sourceType="user-upload", trainingConsent="not-required"))
    validate_dataset_record(_record(sourceType="user-upload", trainingConsent="explicit"))


def test_training_and_validation_splits_cannot_contain_ineligible_records():
    with pytest.raises(ValueError, match="eligible records"):
        validate_dataset_record(_record(trainingEligibility="inference-only"))
    with pytest.raises(ValueError, match="invalid"):
        validate_dataset_record(_record(split="unknown", trainingEligibility="rejected"))


def test_behavioral_feedback_is_not_a_supervised_label():
    event = {
        "eventId": "feedback-001",
        "eventVersion": "1.0.0",
        "eventType": "card_answered_incorrectly",
        "occurredAt": "2026-09-29T00:00:00Z",
        "artifactId": "card-001",
        "signalClass": "behavioral",
        "humanReviewed": False,
        "trainingEligibility": "inference-analytics-only",
    }
    validate_feedback_event(event)
    with pytest.raises(ValueError, match="Behavioral"):
        validate_feedback_event({**event, "trainingEligibility": "eligible"})


def test_supervised_feedback_requires_human_review():
    event = {
        "eventId": "feedback-002",
        "eventVersion": "1.0.0",
        "eventType": "answer_corrected",
        "occurredAt": "2026-09-29T00:00:00Z",
        "artifactId": "card-002",
        "signalClass": "supervised-label",
        "humanReviewed": True,
        "trainingEligibility": "eligible",
    }
    validate_feedback_event(event)
    with pytest.raises(ValueError, match="human review"):
        validate_feedback_event({**event, "humanReviewed": False})
