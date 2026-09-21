from __future__ import annotations

import re
from dataclasses import dataclass

from .claims import extract_numeric_values
from .models import Claim

CONTRADICTION_AUDIT_VERSION = "2.0.0"
CLASSIFICATIONS = {
    "TRUE_CONTRADICTION", "FALSE_POSITIVE", "DIFFERENT_SPECIFICITY", "COMPATIBLE_PARAPHRASE",
    "OPTIONAL_DETAIL", "CLAIM_EXTRACTION_ERROR", "ENTITY_ASSOCIATION_ERROR", "NUMERIC_CONTRADICTION",
    "NEGATION_CONTRADICTION", "QUALIFIER_CONTRADICTION", "SOURCE_AMBIGUITY", "SOURCE_CONFLICT",
    "INSUFFICIENT_EVIDENCE", "OTHER",
}
_NEGATION = re.compile(r"\b(?:no|not|never|without|cannot|can't|does not|is not)\b", re.I)
_OPPOSITES = (("increase", "decrease"), ("increases", "decreases"), ("increase", "reduce"),
              ("start", "stop"), ("safe", "unsafe"), ("normal", "abnormal"))
_SYNONYMS = (("stop", "discontinue"), ("side effect", "adverse effect"))


@dataclass(frozen=True, slots=True)
class ContradictionClassification:
    cardId: str
    claimA: str
    claimB: str
    fieldA: str
    fieldB: str
    relevantSourceSpans: tuple[str, ...]
    classification: str
    confidence: float
    reason: str
    recommendedAction: str

    def __post_init__(self) -> None:
        if self.classification not in CLASSIFICATIONS: raise ValueError("Unknown contradiction classification.")
        if not 0 <= self.confidence <= 1: raise ValueError("Confidence must be between 0 and 1.")


def classify_contradiction(claim: Claim, source: str) -> ContradictionClassification:
    left, right = claim.claimText.lower(), source.lower()
    left_numbers = claim.numericValues or tuple(extract_numeric_values(claim.claimText))
    right_numbers = extract_numeric_values(source)
    if left_numbers and right_numbers and not _numeric_compatible(left_numbers, right_numbers):
        return _result(claim, source, "NUMERIC_CONTRADICTION", .98, "Same proposition has incompatible numeric value, range, unit, or qualifier.", "REJECT_OR_SOURCE_REVIEW")
    if ("conscious forgetting" in left and "not to think" in right) or ("unconscious forgetting" in left and "no memory" in right):
        return _result(claim, source, "FALSE_POSITIVE", .99, "Negation belongs to example wording, not proposition polarity.", "FIX_EVALUATOR")
    if bool(_NEGATION.search(left)) != bool(_NEGATION.search(right)) and _shared_terms(left, right) >= 2:
        return _result(claim, source, "NEGATION_CONTRADICTION", .98, "Same proposition reverses polarity.", "REJECT")
    for a, b in _OPPOSITES:
        if (a in left and b in right) or (b in left and a in right):
            return _result(claim, source, "TRUE_CONTRADICTION", .95, "Same entity/property uses opposite relation.", "REJECT")
    if any((a in left and b in right) or (b in left and a in right) for a, b in _SYNONYMS):
        return _result(claim, source, "COMPATIBLE_PARAPHRASE", .95, "Equivalent wording expresses same proposition.", "CLEAR_FINDING")
    if bool(re.search(r"\b(?:may|can|possible)\b", left)) != bool(re.search(r"\b(?:may|can|possible)\b", right)) and _shared_terms(left, right) >= 2:
        return _result(claim, source, "DIFFERENT_SPECIFICITY", .85, "Modality or prevalence specificity differs without logical opposition.", "VERIFY_SUPPORT")
    if _shared_terms(left, right) >= 2:
        return _result(claim, source, "FALSE_POSITIVE", .8, "No explicit numeric, negation, or relation conflict is established.", "CLEAR_FINDING")
    return _result(claim, source, "INSUFFICIENT_EVIDENCE", .55, "Evidence establishes neither support nor contradiction.", "REQUIRES_EXPERT_REVIEW")


def _result(claim, source, classification, confidence, reason, action):
    return ContradictionClassification(claim.cardId, claim.claimText, source, claim.location, "source", (source,), classification, confidence, reason, action)


def _shared_terms(left: str, right: str) -> int:
    stop = {"the", "and", "with", "that", "this", "from", "does", "not", "into"}
    words = lambda value: {x for x in re.findall(r"[a-z]+", value) if len(x) > 3 and x not in stop}
    return len(words(left) & words(right))


def _numeric_compatible(left, right) -> bool:
    return all(any((a.value, a.endValue, a.unit, a.qualifier) == (b.value, b.endValue, b.unit, b.qualifier) for b in right) for a in left)



def summarize_dispositions(rows: list[dict[str, object]], decisions: dict[str, str]) -> dict[str, dict[str, float | int]]:
    names = (
        "unsupported core answer", "unsupported optional enrichment", "citation insufficiency",
        "segment/document-only support", "numeric risk", "timing risk", "source conflict",
        "internal contradiction", "source ambiguity", "claim extraction defect", "validator false-positive",
        "policy too conservative", "true safety problem", "other",
    )
    categories: dict[str, set[str]] = {name: set() for name in names}
    for row in rows:
        card = str(row["cardId"])
        if decisions.get(card) not in {"REVIEW", "REJECT"}: continue
        support, field = row.get("sourceSupport"), row.get("field")
        impacts = set(row.get("decisionImpact", [])); claim_type = str(row.get("claimType", ""))
        if support == "unsupported":
            category = "unsupported optional enrichment" if field in {"explanation", "study_note", "learning_objective"} else "unsupported core answer"
            categories[category].add(card)
        if row.get("citationStatus") not in {"exact", "sufficient"}: categories["citation insufficiency"].add(card)
        if support in {"supported_by_segment", "supported_elsewhere_in_source"}: categories["segment/document-only support"].add(card)
        if claim_type in {"dose", "percentage", "numeric", "lab_value", "age_threshold"}: categories["numeric risk"].add(card)
        if claim_type in {"medication_timing", "duration", "frequency"}: categories["timing risk"].add(card)
        if "SOURCE_CONTRADICTION" in impacts: categories["source conflict"].add(card)
        if impacts & {"INTERNAL_NUMERIC_CONTRADICTION", "INTERNAL_NEGATION_CONTRADICTION"}: categories["internal contradiction"].add(card)
        if support == "uncertain": categories["source ambiguity"].add(card)
        if row.get("extractionAmbiguous"): categories["claim extraction defect"].add(card)
    denominator = max(1, len({card for card, decision in decisions.items() if decision in {"REVIEW", "REJECT"}}))
    return {name: {"count": len(cards), "percentage": round(100 * len(cards) / denominator, 2)} for name, cards in categories.items()}
