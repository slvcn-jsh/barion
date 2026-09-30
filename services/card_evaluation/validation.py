from __future__ import annotations

import re

from .models import Claim, GroundingResult, NormalizedCard, Segment, ValidationResult
from .text import tokens

VALIDATOR_VERSION = "1.4.0"

_ROLE_QUALIFIERS = frozenset({
    "adult", "adults", "child", "children", "initial", "later", "loading",
    "maintenance", "maximum", "minimum", "morning", "neonatal", "pediatric",
    "starting", "subsequent", "therapeutic", "toxic", "evening",
})
_APPROXIMATE_QUALIFIERS = frozenset({"", "~", "about", "approximately"})
_DOCUMENT_MECHANICS_QUESTION = re.compile(
    r"(?:"
    r"\b(?:first|last|opening|closing)\s+(?:word|character|letter)\s+(?:of|in)\s+"
    r"(?:this|the)\s+(?:sentence|paragraph|section|page)\b|"
    r"\b(?:word|character|letter)\s+(?:begins?|starts?|ends?|closes?)\s+(?:this|the)\s+"
    r"(?:sentence|paragraph|section|page)\b|"
    r"\b(?:on\s+)?(?:what|which)\s+(?:page|paragraph)\b|"
    r"\b(?:what|which)\s+(?:section|line)\s+(?:of|in)\s+(?:this|the)\s+"
    r"(?:document|source|chapter|page|paragraph)\b|"
    r"\b(?:font|typeface|typography|formatting|capitalization|punctuation)\b"
    r")",
    re.I,
)
_DOCUMENT_MECHANICS_OBJECTIVE = re.compile(
    r"\b(?:document|sentence|paragraph|page)\b.{0,32}"
    r"\b(?:layout|formatting|typography|wording|spelling|punctuation|capitalization)\b|"
    r"\b(?:layout|formatting|typography|wording|spelling|punctuation|capitalization)\b.{0,32}"
    r"\b(?:document|sentence|paragraph|page)\b",
    re.I,
)


def validate_card(card: NormalizedCard, claims: list[Claim], grounding: list[GroundingResult], segments: list[Segment]) -> list[ValidationResult]:
    results = _schema(card) + _educational_value(card) + _source_references(card, segments)
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


def _educational_value(card: NormalizedCard) -> list[ValidationResult]:
    if not (
        _DOCUMENT_MECHANICS_QUESTION.search(card.question)
        or _DOCUMENT_MECHANICS_OBJECTIVE.search(card.learningObjective)
    ):
        return []
    return [_result(
        "LOW_EDUCATIONAL_VALUE",
        "moderate",
        "",
        "question",
        ("document-mechanics",),
        "document_presentation_not_learning_target",
        "REJECT",
    )]


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
            if len(overlap) < 2 or not _same_numeric_role(left, right):
                continue
            for left_value in left.numericValues:
                for right_value in right.numericValues:
                    if _numeric_values_conflict(left_value, right_value):
                        severity = "high" if "high" in {left.riskLevel, right.riskLevel} else "moderate"
                        results.append(_result("INTERNAL_NUMERIC_CONTRADICTION", severity, left.claimId, left.location,
                                               (left.claimText, right.claimText), "inconsistent_card_fields", "REJECT"))
            if left.negation != right.negation and len(overlap) >= 3:
                results.append(_result("INTERNAL_NEGATION_CONTRADICTION", "high", left.claimId, left.location,
                                       (left.claimText, right.claimText), "inconsistent_card_fields", "REJECT"))
    return results


def _same_numeric_role(left: Claim, right: Claim) -> bool:
    if left.claimType != right.claimType:
        return False
    left_roles = set(tokens(left.claimText)) & _ROLE_QUALIFIERS
    right_roles = set(tokens(right.claimText)) & _ROLE_QUALIFIERS
    if left_roles or right_roles:
        return left_roles == right_roles
    left_subject = {token for token in tokens(left.subject) if token not in _ROLE_QUALIFIERS}
    right_subject = {token for token in tokens(right.subject) if token not in _ROLE_QUALIFIERS}
    if left_subject and right_subject:
        return left_subject == right_subject or len(left_subject & right_subject) >= 2
    return True


def _numeric_values_conflict(left, right) -> bool:
    if left.unit != right.unit:
        return False
    if (left.value, left.endValue) != (right.value, right.endValue):
        return True
    if left.qualifier == right.qualifier:
        return False
    return not ({left.qualifier, right.qualifier} <= _APPROXIMATE_QUALIFIERS)


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
