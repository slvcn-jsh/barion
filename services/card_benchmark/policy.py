from __future__ import annotations

from services.card_evaluation.models import VerificationResult

from .models import Claim, GroundingResult, PolicyResult, ValidationResult

POLICY_VERSION = "2.0.0"
_SUPPORTED = {"supported_by_citation", "supported_by_segment", "supported_elsewhere_in_source"}


def decide_publication(claims: list[Claim], grounding: list[GroundingResult], validations: list[ValidationResult],
                       verification: list[VerificationResult] | None = None) -> PolicyResult:
    grounded = {result.claimId: result for result in grounding}
    verified = {result.claimId: result for result in (verification or [])}
    hard_codes = sorted({result.code for result in validations if result.policyConsequence == "REJECT"})
    core = [claim for claim in claims if claim.location == "core_answer"]
    optional = [claim for claim in claims if claim.removable]
    core_failures = [claim for claim in core if grounded.get(claim.claimId) is None or grounded[claim.claimId].sourceSupport not in _SUPPORTED]
    contradictions = [result for result in grounding if result.sourceSupport == "contradicted"]
    citation_failures = [claim for claim in core if grounded.get(claim.claimId) and grounded[claim.claimId].citationStatus not in {"exact", "sufficient"}]
    high_uncertain = [claim for claim in claims if claim.riskLevel in {"critical", "high"} and grounded.get(claim.claimId) and grounded[claim.claimId].sourceSupport == "uncertain"]
    optional_bad = [claim for claim in optional if grounded.get(claim.claimId) and grounded[claim.claimId].sourceSupport in {"unsupported", "uncertain"}]
    retained = tuple(claim.claimId for claim in claims if claim not in optional_bad)
    authority_conflicts = [claim for claim in claims if verified.get(claim.claimId) and verified[claim.claimId].verificationStatus in {"conflict", "incorrect", "outdated"}]
    unresolved_verification = [claim for claim in claims if claim.requiresVerification and claim.riskLevel in {"critical", "high"}
                               and (not verified.get(claim.claimId) or verified[claim.claimId].verificationStatus in
                                    {"uncertain", "not_performed_offline", "authority_unavailable"})]

    if hard_codes or contradictions or any(result.sourceSupport == "unsupported" for claim in core for result in grounding if result.claimId == claim.claimId):
        reasons = tuple(hard_codes + (["CONTRADICTED_CLAIM"] if contradictions else []) + (["UNSUPPORTED_CORE_CLAIM"] if core_failures else []))
        return PolicyResult("REJECT", tuple(dict.fromkeys(reasons)), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, 1.0)
    if authority_conflicts:
        return PolicyResult("REVIEW", ("SOURCE_CONFLICT",), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, None)
    if unresolved_verification:
        return PolicyResult("REVIEW", ("HIGH_RISK_UNVERIFIED",), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, None)
    if high_uncertain or core_failures:
        return PolicyResult("REVIEW", ("HIGH_RISK_OR_CORE_EVIDENCE_UNCERTAIN",), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, None)
    if optional_bad:
        # SANITIZE requires core to remain independently supportable; caller reevaluates retained claims before publication.
        return PolicyResult("SANITIZE", ("REMOVABLE_OPTIONAL_CLAIMS_UNSUPPORTED",), tuple(claim.claimId for claim in optional_bad), retained, POLICY_VERSION, 1.0)
    if citation_failures:
        return PolicyResult("REVIEW", ("CORE_CITATION_INSUFFICIENT",), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, None)
    if not core:
        return PolicyResult("REJECT", ("NO_FACTUAL_CORE_CLAIM",), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, 1.0)
    return PolicyResult("PUBLISH", (), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, 1.0)
