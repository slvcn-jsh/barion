from __future__ import annotations

from .models import Claim, GroundingResult, NormalizedCard, Segment, ValidationResult
from .text import tokens

VALIDATOR_VERSION = "1.2.0"


def validate_card(card: NormalizedCard, claims: list[Claim], grounding: list[GroundingResult], segments: list[Segment]) -> list[ValidationResult]:
    results = _schema(card) + _source_references(card, segments)
    results += [_result("NUMERIC_CLAIM_CLASSIFIED", claim.riskLevel, claim.claimId, claim.location,
                        tuple(value.raw for value in claim.numericValues), "numeric_or_threshold_statement", "NONE")
                for claim in claims if claim.numericValues]
    results += _internal_contradictions(claims)
    results += _grounding_findings(claims, grounding)
    unique: dict[tuple[str, str, str], ValidationResult] = {}
    for result in results: unique[(result.code, result.claimId, result.field)] = result
    return list(unique.values())


def _schema(card: NormalizedCard) -> list[ValidationResult]:
    results: list[ValidationResult] = []
    for field, value in (("question", card.question), ("core_answer", card.coreAnswer)):
        if not value: results.append(_result("REQUIRED_FIELD_EMPTY", "high", "", field, (), "normalization_or_input", "REJECT"))
    for field, value, limit in (("question", card.question, 500), ("core_answer", card.coreAnswer, 2000),
                                ("explanation", card.explanation, 2000), ("study_note", card.studyNote, 2000)):
        if len(value) > limit:
            results.append(_result("FIELD_OVERSIZED", "moderate", "", field, (str(len(value)),), "input_contract", "REVIEW"))
    return results


def _source_references(card: NormalizedCard, segments: list[Segment]) -> list[ValidationResult]:
    by_id = {segment.segmentId: segment for segment in segments}
    results: list[ValidationResult] = []
    for reference in card.sourceReferences:
        if reference.segmentId not in by_id:
            results.append(_result("SOURCE_SEGMENT_NOT_FOUND", "high", "", "sourceReferences", (reference.segmentId,), "stale_or_mixed_artifact", "REVIEW"))
            continue
        if reference.resolutionStatus == "stale-source":
            results.append(_result("SOURCE_SPAN_STALE", "high", "", "sourceReferences", (reference.evidenceText,), "stale_source_hash", "REVIEW"))
        elif reference.resolutionStatus in {"ambiguous", "not-found", "invalid"}:
            results.append(_result("SOURCE_SPAN_UNRESOLVED", "high", "", "sourceReferences", (reference.resolutionStatus,), "ambiguous_or_missing_evidence", "REVIEW"))
    return results


def _internal_contradictions(claims: list[Claim]) -> list[ValidationResult]:
    results: list[ValidationResult] = []
    numeric = [claim for claim in claims if claim.numericValues]
    for index, left in enumerate(numeric):
        for right in numeric[index + 1:]:
            overlap = set(tokens(left.claimText)) & set(tokens(right.claimText))
            if len(overlap) < 2: continue
            for left_value in left.numericValues:
                for right_value in right.numericValues:
                    if left_value.unit == right_value.unit and (left_value.value != right_value.value or left_value.qualifier != right_value.qualifier):
                        severity = "high" if "high" in {left.riskLevel, right.riskLevel} else "moderate"
                        results.append(_result("INTERNAL_NUMERIC_CONTRADICTION", severity, left.claimId, left.location,
                                               (left.claimText, right.claimText), "inconsistent_card_fields", "REJECT"))
            if left.negation != right.negation and len(overlap) >= 3:
                results.append(_result("INTERNAL_NEGATION_CONTRADICTION", "high", left.claimId, left.location,
                                       (left.claimText, right.claimText), "inconsistent_card_fields", "REJECT"))
    return results


def _grounding_findings(claims: list[Claim], grounding: list[GroundingResult]) -> list[ValidationResult]:
    by_claim = {claim.claimId: claim for claim in claims}
    results: list[ValidationResult] = []
    for item in grounding:
        claim = by_claim[item.claimId]
        if item.sourceSupport == "contradicted":
            results.append(_result("SOURCE_CONTRADICTION", claim.riskLevel, claim.claimId, claim.location,
                                   item.contradictionEvidence, "claim_source_conflict", "REJECT"))
        elif item.sourceSupport == "unsupported":
            consequence = "SANITIZE" if claim.removable else "REJECT"
            code = "UNSUPPORTED_QUESTION_PRESUPPOSITION" if claim.location == "question" else "UNSUPPORTED_CLAIM"
            results.append(_result(code, claim.riskLevel, claim.claimId, claim.location,
                                   (claim.claimText,), "source_absent", consequence))
        elif item.sourceSupport == "uncertain" and claim.riskLevel in {"critical", "high"}:
            results.append(_result("HIGH_RISK_INSUFFICIENT_EVIDENCE", claim.riskLevel, claim.claimId, claim.location,
                                   (claim.claimText,), "deterministic_evidence_ambiguous", "REVIEW"))
    return results


def _result(code, severity, claim, field, evidence, root, consequence):
    return ValidationResult(code, severity, claim, field, tuple(evidence), root, consequence)
