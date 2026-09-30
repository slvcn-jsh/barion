from __future__ import annotations

from datetime import datetime
import re
from typing import Any


PROJECT_AUTHORED_PROVENANCE = "project-authored"
MODEL_GENERATED_PROVENANCE = "model-generated-evaluation"
SUPPORTED_PROVENANCE = frozenset({
    PROJECT_AUTHORED_PROVENANCE,
    MODEL_GENERATED_PROVENANCE,
})
AUTHORITY_ROLES = frozenset({"clinician", "medical_educator", "subject_matter_expert"})
REVIEWER_ROLES = frozenset({"medical_student", *AUTHORITY_ROLES})


def validate_evaluator_fixture(
    payload: object,
    *,
    require_labels: bool,
) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError("Evaluator fixture must be an object.")
    provenance = payload.get("provenance")
    if provenance not in SUPPORTED_PROVENANCE:
        raise ValueError("Evaluator fixture provenance is unsupported.")
    if provenance == MODEL_GENERATED_PROVENANCE:
        _validate_model_generated_governance(payload.get("sourceGovernance"))

    cases = payload.get("cases")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Evaluator fixture must contain cases.")
    if not all(isinstance(case, dict) for case in cases):
        raise ValueError("Every evaluator case must be an object.")

    ids = [case.get("caseId") for case in cases]
    if not all(isinstance(value, str) and value.strip() for value in ids):
        raise ValueError("Evaluator case IDs must be unique non-empty strings.")
    if len(ids) != len(set(ids)):
        raise ValueError("Evaluator case IDs must be unique non-empty strings.")
    for case in cases:
        if not isinstance(case.get("segments"), list) or not case["segments"]:
            raise ValueError(f"Evaluator case {case['caseId']!r} requires source segments.")
        if not isinstance(case.get("card"), dict):
            raise ValueError(f"Evaluator case {case['caseId']!r} requires a card.")
        if require_labels and not isinstance(case.get("goldLabel"), str):
            raise ValueError(f"Evaluator case {case['caseId']!r} requires a locked gold label.")
    return cases


def is_model_generated_fixture(payload: dict[str, Any]) -> bool:
    return payload.get("provenance") == MODEL_GENERATED_PROVENANCE


def label_review_authorization(
    payload: dict[str, Any],
    cases: list[dict[str, Any]],
    *,
    allowed_labels: tuple[str, ...],
) -> dict[str, object]:
    review = payload.get("labelReview")
    reasons: list[str] = []
    if not isinstance(review, dict):
        return {
            "eligible": False,
            "reasons": ["independent_label_review_missing"],
            "reviewerCount": 0,
            "reviewerRoles": [],
        }
    if review.get("status") != "approved":
        reasons.append("label_review_not_approved")
    if review.get("independent") is not True:
        reasons.append("label_review_not_independent")
    if not _valid_timestamp(review.get("lockedAt")):
        reasons.append("label_review_not_locked")
    if not _sha256(review.get("sourceFixtureSha256")):
        reasons.append("source_fixture_hash_missing")

    reviews = review.get("reviews")
    reviews = reviews if isinstance(reviews, list) else []
    reviewer_ids = [
        item.get("reviewerId")
        for item in reviews
        if isinstance(item, dict)
        and isinstance(item.get("reviewerId"), str)
        and item["reviewerId"].strip()
    ]
    if len(reviews) < 2 or len(reviewer_ids) != len(reviews):
        reasons.append("insufficient_label_reviewers")
    if len(reviewer_ids) != len(set(reviewer_ids)):
        reasons.append("duplicate_label_reviewer")

    roles = {
        item.get("reviewerRole")
        for item in reviews
        if isinstance(item, dict) and isinstance(item.get("reviewerRole"), str)
    }
    if "medical_student" not in roles:
        reasons.append("target_learner_reviewer_missing")
    if not roles.intersection(AUTHORITY_ROLES):
        reasons.append("clinical_authority_reviewer_missing")

    expected = {str(case["caseId"]): str(case["goldLabel"]) for case in cases}
    complete_consensus = True
    for item in reviews:
        if (
            not isinstance(item, dict)
            or item.get("reviewerRole") not in REVIEWER_ROLES
            or not _sha256(item.get("reviewFileSha256"))
        ):
            complete_consensus = False
            continue
        labels = item.get("labels")
        if not isinstance(labels, dict) or set(labels) != set(expected):
            complete_consensus = False
            continue
        if any(
            labels[case_id] not in allowed_labels or labels[case_id] != gold
            for case_id, gold in expected.items()
        ):
            complete_consensus = False
    if not complete_consensus:
        reasons.append("complete_label_consensus_missing")
    return {
        "eligible": not reasons,
        "reasons": list(dict.fromkeys(reasons)),
        "reviewerCount": len(set(reviewer_ids)),
        "reviewerRoles": sorted(role for role in roles if isinstance(role, str)),
    }


def _validate_model_generated_governance(value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError("Model-generated evaluator fixtures require source governance metadata.")
    required_strings = ("sourceArtifactSha256", "sourceReference", "sourceType")
    if any(not isinstance(value.get(field), str) or not value[field].strip() for field in required_strings):
        raise ValueError("Source governance requires artifact hash, reference, and type.")
    if re.fullmatch(r"[0-9a-f]{64}", value["sourceArtifactSha256"].lower()) is None:
        raise ValueError("Source governance artifact hash must be SHA-256.")
    if value.get("evaluationUseAuthorized") is not True:
        raise ValueError("Source content is not authorized for evaluation use.")
    if value.get("licenseUsageStatus") != "approved":
        raise ValueError("Source usage rights must be approved before evaluation.")
    if value.get("containsSensitiveData") is not False:
        raise ValueError("Sensitive or unclassified source content cannot enter evaluator fixtures.")
    if value.get("trainingEligibility") != "inference-only":
        raise ValueError("Model-generated evaluator fixtures must remain inference-only.")
    training_authorized = value.get("trainingUseAuthorized")
    if training_authorized not in {None, True, False}:
        raise ValueError("Training-use authorization must be boolean when declared.")
    if training_authorized is True and value.get("trainingConsent") not in {"explicit", "not-required"}:
        raise ValueError("Authorized training-candidate sources require resolved training consent.")


def _sha256(value: object) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value.lower()) is not None


def _valid_timestamp(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return False
    return parsed.tzinfo is not None
