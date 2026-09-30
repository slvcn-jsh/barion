from __future__ import annotations

from datetime import datetime
from typing import Any


REQUIRED_DATASET_FIELDS = frozenset({
    "exampleId",
    "datasetVersion",
    "task",
    "sourceType",
    "sourceReference",
    "input",
    "expectedOutput",
    "qualityStatus",
    "reviewStatus",
    "provenance",
    "licenseUsageStatus",
    "createdAt",
    "promptVersion",
    "modelOrigin",
    "humanEdited",
    "rejectionReason",
    "trainingEligibility",
    "trainingConsent",
    "sourceUseAuthorized",
    "containsSensitiveData",
    "split",
})

TRAINING_QUALITY = frozenset({"gold", "accepted"})
TRAINING_REVIEW = frozenset({"human-approved", "expert-approved"})
TRAINING_PROVENANCE = frozenset({
    "human-authored",
    "human-corrected-ai",
    "expert-reviewed-ai",
    "independently-validated-synthetic",
})
DATASET_SPLITS = frozenset({"train", "validation", "test", "adversarial", "rejected"})
TRAINING_ELIGIBILITY = frozenset({"eligible", "inference-only", "rejected"})


def validate_dataset_record(record: dict[str, Any]) -> None:
    missing = REQUIRED_DATASET_FIELDS - set(record)
    if missing:
        raise ValueError(f"Dataset record is missing required fields: {sorted(missing)}.")
    _require_nonempty(record, "exampleId", "datasetVersion", "task", "sourceType", "sourceReference", "createdAt")
    _parse_timestamp(str(record["createdAt"]))
    if record["split"] not in DATASET_SPLITS:
        raise ValueError("Dataset split is invalid.")
    if record["trainingEligibility"] not in TRAINING_ELIGIBILITY:
        raise ValueError("Training eligibility is invalid.")
    if record["split"] in {"train", "validation"} and record["trainingEligibility"] != "eligible":
        raise ValueError("Training and validation splits require eligible records.")
    if record["trainingEligibility"] != "eligible":
        return
    if record["split"] in {"test", "adversarial", "rejected"}:
        raise ValueError("Frozen test, adversarial, and rejected records cannot be training eligible.")
    if record["qualityStatus"] not in TRAINING_QUALITY:
        raise ValueError("Training data requires gold or accepted quality status.")
    if record["reviewStatus"] not in TRAINING_REVIEW:
        raise ValueError("Training data requires human or expert approval.")
    if record["provenance"] not in TRAINING_PROVENANCE:
        raise ValueError("Training data provenance is not high-confidence.")
    if record["licenseUsageStatus"] != "approved" or not record["sourceUseAuthorized"]:
        raise ValueError("Training data requires approved usage rights.")
    if record["containsSensitiveData"]:
        raise ValueError("Sensitive data cannot enter training datasets.")
    if record["trainingConsent"] not in {"explicit", "not-required"}:
        raise ValueError("Training data requires resolved consent status.")
    if record["sourceType"] == "user-upload" and record["trainingConsent"] != "explicit":
        raise ValueError("User uploads require explicit consent before training use.")


def validate_feedback_event(event: dict[str, Any]) -> None:
    required = {
        "eventId",
        "eventVersion",
        "eventType",
        "occurredAt",
        "artifactId",
        "signalClass",
        "humanReviewed",
        "trainingEligibility",
    }
    missing = required - set(event)
    if missing:
        raise ValueError(f"Feedback event is missing required fields: {sorted(missing)}.")
    _require_nonempty(event, "eventId", "eventVersion", "eventType", "occurredAt", "artifactId")
    _parse_timestamp(str(event["occurredAt"]))
    if event["signalClass"] == "behavioral" and event["trainingEligibility"] == "eligible":
        raise ValueError("Behavioral signals are analytics, not supervised labels.")
    if event["signalClass"] == "supervised-label" and (
        not event["humanReviewed"] or event["trainingEligibility"] != "eligible"
    ):
        raise ValueError("Supervised labels require human review and explicit eligibility.")
    if event["signalClass"] not in {"behavioral", "supervised-label"}:
        raise ValueError("Feedback signal class is invalid.")


def _require_nonempty(value: dict[str, Any], *fields: str) -> None:
    if any(not str(value.get(field, "")).strip() for field in fields):
        raise ValueError("Required dataset and feedback identifiers must be non-empty.")


def _parse_timestamp(value: str) -> None:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("Timestamp must use ISO 8601 format.") from error
