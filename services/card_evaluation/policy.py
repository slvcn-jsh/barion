from __future__ import annotations

from .models import Claim, GroundingResult, PolicyResult, ValidationResult, VerificationResult

POLICY_VERSION = "3.1.0"
_SUPPORTED = {"supported_by_citation", "supported_by_segment", "supported_elsewhere_in_source"}
_UNRESOLVED_VERIFICATION = {"uncertain", "not_performed_offline", "authority_unavailable"}


def decide_facts(facts: dict[str, object]) -> str:
    core = facts.get("coreSource")
    optional = facts.get("optionalSource")
    citation = facts.get("citation")
    risk = facts.get("risk")
    verification = facts.get("verification")
    if core in {"unsupported", "contradicted"}: return "REJECT"
    if optional == "unsupported" and not facts.get("sanitized"): return "SANITIZE"
    if citation not in {"exact", "sufficient"}: return "REVIEW"
    if verification in {"conflict", "incorrect", "outdated"}: return "REVIEW"
    if risk in {"critical", "high"} and verification not in {"verified", "likely_correct"}: return "REVIEW"
    return "PUBLISH"


def decide_publication(
    claims: list[Claim],
    grounding: list[GroundingResult],
    validations: list[ValidationResult],
    verification: list[VerificationResult] | None = None,
) -> PolicyResult:
    grounded = {result.claimId: result for result in grounding}
    verified = {result.claimId: result for result in (verification or [])}
    core = [claim for claim in claims if claim.location in {"question", "core_answer"}]
    optional = [claim for claim in claims if claim.removable]
    contradictions = [claim for claim in core if grounded.get(claim.claimId) and grounded[claim.claimId].sourceSupport == "contradicted"]
    unsupported_core = [claim for claim in core if grounded.get(claim.claimId) and grounded[claim.claimId].sourceSupport == "unsupported"]
    missing_core = [claim for claim in core if grounded.get(claim.claimId) is None]
    uncertain_core = [claim for claim in core if grounded.get(claim.claimId) and grounded[claim.claimId].sourceSupport == "uncertain"]
    optional_bad = [claim for claim in optional if grounded.get(claim.claimId) and grounded[claim.claimId].sourceSupport in {"unsupported", "uncertain"}]
    hard_codes = sorted({result.code for result in validations if result.policyConsequence == "REJECT"})
    authority_conflicts = [claim for claim in claims if verified.get(claim.claimId) and verified[claim.claimId].verificationStatus in {"conflict", "incorrect", "outdated"}]
    unresolved_verification = [
        claim for claim in claims
        if (
            verified.get(claim.claimId) and (
                verified[claim.claimId].verificationStatus in _UNRESOLVED_VERIFICATION
                or (
                    claim.riskLevel in {"critical", "high"}
                    and verified[claim.claimId].verificationStatus == "verification_not_required"
                )
            )
        ) or (
            claim.riskLevel in {"critical", "high"} and claim.requiresVerification and not verified.get(claim.claimId)
        )
    ]
    citation_failures = [
        claim for claim in core
        if grounded.get(claim.claimId) and grounded[claim.claimId].citationStatus not in {"exact", "sufficient"}
    ]
    retained = tuple(claim.claimId for claim in claims if claim not in optional_bad)

    if hard_codes or contradictions or unsupported_core:
        reasons = hard_codes
        if contradictions: reasons.append("CONTRADICTED_CORE_CLAIM")
        if unsupported_core: reasons.append("UNSUPPORTED_CORE_CLAIM")
        return PolicyResult("REJECT", tuple(dict.fromkeys(reasons)), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, 1.0)
    if optional_bad:
        return PolicyResult(
            "SANITIZE", ("REMOVABLE_OPTIONAL_CLAIMS_UNSUPPORTED",),
            tuple(claim.claimId for claim in optional_bad), retained, POLICY_VERSION, 1.0,
        )
    if authority_conflicts:
        return PolicyResult("REVIEW", ("SOURCE_CONFLICT",), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, None)
    if unresolved_verification:
        return PolicyResult("REVIEW", ("HIGH_RISK_UNVERIFIED",), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, None)
    if uncertain_core or missing_core:
        return PolicyResult("REVIEW", ("CORE_EVIDENCE_UNCERTAIN",), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, None)
    if citation_failures:
        reason = "STALE_OR_AMBIGUOUS_SOURCE_SPAN" if any(
            grounded[claim.claimId].citationStatus in {"stale", "wrong_segment", "uncertain"}
            for claim in citation_failures
        ) else "CORE_CITATION_INSUFFICIENT"
        return PolicyResult("REVIEW", (reason,), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, None)
    if not any(claim.location == "core_answer" for claim in claims):
        return PolicyResult("REJECT", ("NO_FACTUAL_CORE_CLAIM",), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, 1.0)
    if any(result.policyConsequence == "REVIEW" for result in validations):
        reasons = tuple(dict.fromkeys(result.code for result in validations if result.policyConsequence == "REVIEW"))
        return PolicyResult("REVIEW", reasons, (), tuple(claim.claimId for claim in claims), POLICY_VERSION, None)
    return PolicyResult("PUBLISH", (), (), tuple(claim.claimId for claim in claims), POLICY_VERSION, 1.0)
