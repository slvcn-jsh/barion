from __future__ import annotations

import re
from dataclasses import asdict, replace

from .claims import extract_claims
from .grounding import ground_claims
from .models import Card, Claim, GroundingResult, PolicyResult, Segment, SourceVerificationContext
from .normalization import build_answer, normalize_card
from .policy import POLICY_VERSION, decide_publication
from .risk import route_claim
from .validation import VALIDATOR_VERSION, validate_card
from .verification import VerificationCoordinator

EVALUATION_CONTRACT_VERSION = "1.0.0"
EVALUATION_VERSION = "2.0.0"
SANITIZATION_VERSION = "1.0.0"
_SUPPORTED = {"supported_by_citation", "supported_by_segment", "supported_elsewhere_in_source"}
_RISK_ORDER = {"none": 0, "low": 1, "moderate": 2, "high": 3, "critical": 4}


def evaluate_once(
    card: Card,
    segments: list[Segment],
    verifier: VerificationCoordinator | None = None,
    authority_queries: dict[str, str] | None = None,
    *,
    verify_unsupported: bool = False,
    verification_deadline: float | None = None,
) -> dict[str, object]:
    normalized = normalize_card(card)
    claims, field_states = extract_claims(normalized)
    grounding = ground_claims(normalized, claims, segments)
    validations = validate_card(normalized, claims, grounding, segments)
    verification = []
    if verifier:
        by_claim = {item.claimId: item for item in grounding}
        source_evidence = "\n".join(reference.evidenceText for reference in normalized.sourceReferences)
        for claim in claims:
            source = by_claim[claim.claimId]
            if not verify_unsupported and source.sourceSupport not in _SUPPORTED:
                continue
            query = (authority_queries or {}).get(claim.claimId, "") or _authority_query(claim)
            context = SourceVerificationContext(
                sourceClaim=claim.claimText, sourceEvidence=source_evidence,
                sourceSupport=source.sourceSupport, sourceFidelity=source.sourceFidelity,
                authorityQuery=query,
            )
            verification.append(verifier.verify(claim, context, deadline=verification_deadline))
    policy = decide_publication(claims, grounding, validations, verification)
    return {
        "normalizedCard": normalized, "claims": claims, "fieldStates": field_states,
        "grounding": grounding, "validations": validations, "verification": verification,
        "policy": policy,
    }


def evaluate_production_candidate(
    card: Card,
    segments: list[Segment],
    verifier: VerificationCoordinator,
    *,
    verification_deadline: float | None = None,
) -> tuple[Card, dict[str, object]]:
    initial = evaluate_once(card, segments, verifier, verification_deadline=verification_deadline)
    initial_policy: PolicyResult = initial["policy"]
    if initial_policy.decision != "SANITIZE":
        return card, evaluation_contract(card, initial)

    sanitized, removed_content = _sanitize(card, initial)
    reevaluated = evaluate_once(sanitized, segments, verifier, verification_deadline=verification_deadline)
    reevaluated_policy: PolicyResult = reevaluated["policy"]
    sanitization = {
        "version": SANITIZATION_VERSION,
        "initialDisposition": "SANITIZE",
        "finalDisposition": reevaluated_policy.decision,
        "removedContent": removed_content,
        "reason": "Unsupported removable optional content removed.",
        "reevaluated": True,
    }
    if reevaluated_policy.decision == "PUBLISH":
        reevaluated["policy"] = replace(
            reevaluated_policy,
            reasonCodes=("SANITIZED_AND_REEVALUATED",),
        )
        return sanitized, evaluation_contract(card, reevaluated, sanitization=sanitization)

    reevaluated["policy"] = PolicyResult(
        "REVIEW", ("SANITIZED_CARD_FAILED_REEVALUATION", *reevaluated_policy.reasonCodes),
        initial_policy.removedClaimIds, reevaluated_policy.retainedClaimIds,
        POLICY_VERSION, None,
    )
    return sanitized, evaluation_contract(card, reevaluated, sanitization=sanitization)


def evaluation_contract(
    original_card: Card,
    evaluation: dict[str, object],
    *,
    sanitization: dict[str, object] | None = None,
) -> dict[str, object]:
    claims: list[Claim] = evaluation["claims"]
    grounding: list[GroundingResult] = evaluation["grounding"]
    validations = evaluation["validations"]
    verification = evaluation["verification"]
    policy: PolicyResult = evaluation["policy"]
    grounded = {item.claimId: item for item in grounding}
    verified = {item.claimId: item for item in verification}
    claim_results = []
    for claim in claims:
        source = grounded[claim.claimId]
        external = verified.get(claim.claimId)
        claim_results.append({
            "claimId": claim.claimId,
            "field": claim.location,
            "claimText": claim.claimText,
            "claimType": claim.claimType,
            "removable": claim.removable,
            "riskLevel": claim.riskLevel,
            "requiresVerification": route_claim(claim).required,
            "sourceSupport": source.sourceSupport,
            "sourceFidelity": source.sourceFidelity,
            "citationStatus": source.citationStatus,
            "verificationStatus": external.verificationStatus if external else "verification_not_required",
            "supportingEvidence": [
                {"segmentId": span.segmentId, "locator": span.locator, "text": span.text, "tier": span.tier}
                for span in (*source.citationSpans, *source.segmentSpans, *source.documentSpans)
            ],
            "contradictionEvidence": list(source.contradictionEvidence),
            "reasonCodes": [item.code for item in validations if item.claimId == claim.claimId],
        })
    core_support = _aggregate_support([item for item in claim_results if item["field"] in {"question", "core_answer"}])
    citation_status = _aggregate_citation([item["citationStatus"] for item in claim_results if item["field"] in {"question", "core_answer"}])
    verification_status = _aggregate_verification([item["verificationStatus"] for item in claim_results])
    medical_risk = max((claim.riskLevel for claim in claims), key=lambda value: _RISK_ORDER[value], default="none")
    span = original_card.evidenceSpan or {}
    evidence_verified = span.get("status") in {"exact", "normalized", "context-disambiguated"}
    pedagogy_review = any(item.code == "FIELD_OVERSIZED" for item in validations)
    contract: dict[str, object] = {
        "contractVersion": EVALUATION_CONTRACT_VERSION,
        "evaluationVersion": EVALUATION_VERSION,
        "policyVersion": POLICY_VERSION,
        "sourceSpan": span,
        "evidenceSpanVerified": evidence_verified,
        "sourceClaimSupported": core_support,
        "citationStatus": citation_status,
        "medicalRisk": medical_risk,
        "medicalVerificationStatus": verification_status,
        "pedagogyStatus": "review" if pedagogy_review else "acceptable",
        "publicationDisposition": policy.decision,
        "reasonCodes": list(policy.reasonCodes),
        "claimResults": claim_results,
        "originalCandidate": {
            "segmentId": original_card.segmentId,
            "locator": original_card.locator,
            "cardType": original_card.cardType,
            "question": original_card.question,
            "answer": original_card.answer,
            "learningObjective": original_card.learningObjective,
            "evidenceText": original_card.evidenceText,
            "evidenceSpan": span,
        },
        "validatorVersion": VALIDATOR_VERSION,
    }
    if sanitization:
        contract["sanitization"] = sanitization
    return contract


def _sanitize(card: Card, evaluation: dict[str, object]) -> tuple[Card, list[dict[str, str]]]:
    normalized = evaluation["normalizedCard"]
    policy: PolicyResult = evaluation["policy"]
    claims: list[Claim] = evaluation["claims"]
    removed = [claim for claim in claims if claim.claimId in policy.removedClaimIds]
    fields = {claim.location for claim in removed}
    explanation = "" if "explanation" in fields else normalized.explanation
    study_note = "" if "study_note" in fields else normalized.studyNote
    sanitized = replace(card, answer=build_answer(normalized.coreAnswer, explanation, study_note))
    removed_content = []
    if "explanation" in fields and normalized.explanation:
        removed_content.append({"field": "explanation", "text": normalized.explanation})
    if "study_note" in fields and normalized.studyNote:
        removed_content.append({"field": "study_note", "text": normalized.studyNote})
    return sanitized, removed_content


def _aggregate_support(results: list[dict[str, object]]) -> str:
    statuses = {str(item["sourceSupport"]) for item in results}
    if "contradicted" in statuses: return "contradicted"
    if "unsupported" in statuses: return "unsupported"
    if "uncertain" in statuses or not statuses: return "uncertain"
    if statuses <= _SUPPORTED: return "supported"
    return "uncertain"


def _aggregate_citation(statuses: list[object]) -> str:
    ordered = ("stale", "wrong_segment", "missing", "uncertain", "overbroad", "partial", "sufficient", "exact")
    values = {str(value) for value in statuses}
    return next((status for status in ordered if status in values), "uncertain")


def _aggregate_verification(statuses: list[object]) -> str:
    ordered = ("incorrect", "conflict", "outdated", "authority_unavailable", "not_performed_offline", "uncertain", "likely_correct", "verified", "verification_not_required")
    values = {str(value) for value in statuses}
    return next((status for status in ordered if status in values), "verification_not_required")


def _authority_query(claim: Claim) -> str:
    route = route_claim(claim)
    if not route.required or route.category not in {
        "dose", "serum_or_lab_threshold", "medication_timing", "frequency_or_duration",
        "contraindication_or_interaction", "medication_action", "numeric_clinical_criterion",
        "diagnostic_threshold", "emergency_management",
    }:
        return ""
    candidates = re.findall(r"[A-Za-z][A-Za-z-]{2,}", claim.subject or claim.claimText)
    ignored = {
        "the", "a", "an", "recommended", "usual", "initial", "maintenance", "dose", "dosage",
        "drug", "medication", "medicine", "patients", "patient", "taking", "administer",
        "administration", "serum", "level", "levels", "threshold", "treatment", "therapy",
        "daily", "oral", "intravenous", "intramuscular", "subcutaneous", "route", "should", "must",
        "is", "are", "was", "were", "of", "for", "to", "with", "and", "or",
    }
    return next((item for item in candidates if item.lower() not in ignored), "")
