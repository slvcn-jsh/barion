from __future__ import annotations

from dataclasses import asdict

from services.card_evaluation.models import SourceVerificationContext
from services.card_evaluation.verification import VerificationCoordinator

from .claims import extract_claims
from .grounding import ground_claims
from .models import Card, Segment
from .normalization import normalize_card
from .policy import decide_publication
from .validators import validate_card


def evaluate_card(card: Card, segments: list[Segment], verifier: VerificationCoordinator | None = None,
                  authority_queries: dict[str, str] | None = None) -> dict[str, object]:
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
            context = SourceVerificationContext(
                sourceClaim=claim.claimText, sourceEvidence=source_evidence,
                sourceSupport=source.sourceSupport, sourceFidelity=source.sourceFidelity,
                authorityQuery=(authority_queries or {}).get(claim.claimId, ""),
            )
            verification.append(verifier.verify(claim, context))
    policy = decide_publication(claims, grounding, validations, verification)
    if policy.decision == "SANITIZE":
        retained = [claim for claim in claims if claim.claimId in policy.retainedClaimIds]
        retained_grounding = [result for result in grounding if result.claimId in policy.retainedClaimIds]
        retained_validations = [result for result in validations if not result.claimId or result.claimId in policy.retainedClaimIds]
        retained_verification = [result for result in verification if result.claimId in policy.retainedClaimIds]
        reevaluated = decide_publication(retained, retained_grounding, retained_validations, retained_verification)
        if reevaluated.decision != "PUBLISH":
            policy = type(policy)("REVIEW", ("SANITIZED_CARD_FAILED_REEVALUATION",), policy.removedClaimIds,
                                  policy.retainedClaimIds, policy.policyVersion, None)
    return {"normalizedCard": normalized, "claims": claims, "fieldStates": field_states,
            "grounding": grounding, "validations": validations, "verification": verification,
            "policy": policy}


def claim_artifact_rows(run_id: str, evaluation: dict[str, object]) -> list[dict[str, object]]:
    normalized = evaluation["normalizedCard"]
    claims = evaluation["claims"]
    grounding = {item.claimId: item for item in evaluation["grounding"]}
    validations = evaluation["validations"]
    policy = evaluation["policy"]
    verification = {item.claimId: item for item in evaluation.get("verification", [])}
    reference = normalized.sourceReferences[0] if normalized.sourceReferences else None
    rows: list[dict[str, object]] = []
    for claim in claims:
        result = grounding[claim.claimId]
        rows.append({
            "runId": run_id, "cardId": claim.cardId, "claimId": claim.claimId, "field": claim.location,
            "claimText": claim.claimText, "claimType": claim.claimType, "risk": claim.riskLevel,
            "numbers": [asdict(value) for value in claim.numericValues],
            "citation": asdict(reference) if reference else None,
            "segmentIds": sorted({span.segmentId for span in (*result.citationSpans, *result.segmentSpans, *result.documentSpans) if span.segmentId}),
            "citationStatus": result.citationStatus, "segmentSupport": bool(result.segmentSpans),
            "documentSupport": bool(result.documentSpans), "sourceSupport": result.sourceSupport,
            "sourceFidelity": result.sourceFidelity, "supportingSpans": [asdict(span) for span in (*result.citationSpans, *result.segmentSpans, *result.documentSpans)],
            "contradictionEvidence": list(result.contradictionEvidence), "confidence": result.confidence,
            "decisionImpact": [item.code for item in validations if item.claimId == claim.claimId],
            "publicationDecision": policy.decision, "removable": claim.removable,
            "externalVerification": asdict(verification[claim.claimId]) if claim.claimId in verification else None,
            "validatorVersion": __import__("services.card_benchmark.validators", fromlist=["VALIDATOR_VERSION"]).VALIDATOR_VERSION,
            "lexicalDiagnostic": result.diagnostic,
        })
    return rows
