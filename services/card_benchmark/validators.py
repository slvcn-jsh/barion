from __future__ import annotations

from .analysis import duplicate_clusters, tokens
from .models import Claim, GroundingResult, NormalizedCard, Segment, ValidationResult

VALIDATOR_VERSION = "1.0.0"


def validate_card(card: NormalizedCard, claims: list[Claim], grounding: list[GroundingResult], segments: list[Segment]) -> list[ValidationResult]:
    results = _schema(card) + _source_references(card, segments)
    results += [_result("NUMERIC_CLAIM_CLASSIFIED", claim.riskLevel, claim.claimId, claim.location,
                        tuple(value.raw for value in claim.numericValues), "numeric_or_threshold_statement", "NONE")
                for claim in claims if claim.numericValues]
    results += _internal_contradictions(claims)
    results += _grounding_findings(claims, grounding)
    results += _question_answer_mismatch(card, claims)
    unique: dict[tuple[str, str, str], ValidationResult] = {}
    for result in results: unique[(result.code, result.claimId, result.field)] = result
    return list(unique.values())


def validate_deck(cards: list[NormalizedCard], segments: list[Segment] | None = None) -> list[ValidationResult]:
    from .models import Card
    results: list[ValidationResult] = []
    legacy = [Card(card.cardId, card.question, card.rawAnswer, card.system) for card in cards]
    for cluster in duplicate_clusters(legacy):
        results.append(_result("EXACT_OR_NEAR_DUPLICATE", "moderate", "", "deck", tuple(cluster), "repeated_card_content", "REVIEW"))
    if len(cards) >= 10 and segments:
        source_cutoff = max(1, len(segments) // 5)
        early_ids = {segment.segmentId for segment in segments[:source_cutoff]}
        cited = [reference.segmentId for card in cards for reference in card.sourceReferences if reference.segmentId]
        if cited and sum(segment_id in early_ids for segment_id in cited) / len(cited) >= 0.8:
            results.append(_result("START_CONCENTRATED_DECK", "moderate", "", "deck",
                                   tuple(sorted(set(cited))), "generation_coverage_bias", "REVIEW"))
    return results


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
        segment = by_id.get(reference.segmentId)
        if segment is None:
            results.append(_result("SOURCE_SEGMENT_NOT_FOUND", "high", "", "sourceReferences", (reference.segmentId,), "stale_or_mixed_artifact", "REVIEW"))
            continue
        if reference.evidenceText and reference.evidenceText not in segment.text:
            results.append(_result("CITATION_SUBSTRING_INVALID", "high", "", "sourceReferences", (reference.evidenceText,), "wrong_or_mutated_citation", "REJECT"))
        if reference.startOffset is not None and (reference.startOffset < 0 or reference.endOffset is None or reference.endOffset > len(segment.text)):
            results.append(_result("SOURCE_OFFSET_INVALID", "high", "", "sourceReferences", (str(reference.startOffset), str(reference.endOffset)), "stale_offsets", "REJECT"))
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


def _question_answer_mismatch(card: NormalizedCard, claims: list[Claim]) -> list[ValidationResult]:
    question_entities = {token for token in tokens(card.question) if len(token) > 5}
    answer_entities = set(tokens(card.coreAnswer))
    if question_entities and answer_entities and not question_entities & answer_entities:
        core = next((claim for claim in claims if claim.location == "core_answer"), None)
        return [_result("QUESTION_ANSWER_ENTITY_MISMATCH", "moderate", core.claimId if core else "", "core_answer",
                        (card.question, card.coreAnswer), "answer_may_address_different_entity", "REVIEW")]
    return []


def _result(code, severity, claim, field, evidence, root, consequence):
    return ValidationResult(code, severity, claim, field, tuple(evidence), root, consequence)
