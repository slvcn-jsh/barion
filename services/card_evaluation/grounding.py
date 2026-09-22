from __future__ import annotations

import re
from collections import Counter

from services.source_span import resolve_source_span

from .models import Claim, EvidenceSpan, GroundingResult, NormalizedCard, NumericValue, Segment
from .text import STOP, tokens

GROUNDING_VERSION = "1.3.0"
_NEGATION = re.compile(r"\b(no|not|never|without|cannot|can't|does not|is not)\b", re.I)
_EXAMPLE_NEGATION = re.compile(r"\b(?:decides?|chose|chooses?)\s+not\s+to\b|\bno\s+memory\b", re.I)
_ANTONYMS = (("increase", "decrease"), ("increases", "decreases"), ("increases", "reduces"), ("high", "low"),
             ("start", "stop"), ("reversible", "irreversible"),
             ("normal", "abnormal"), ("safe", "unsafe"))
_RESOLVED = {"exact", "normalized", "context-disambiguated"}


def ground_claims(card: NormalizedCard, claims: list[Claim], segments: list[Segment]) -> list[GroundingResult]:
    by_id = {segment.segmentId: segment for segment in segments}
    results: list[GroundingResult] = []
    for claim in claims:
        references = card.sourceReferences
        cited_text = "\n".join(reference.evidenceText for reference in references if reference.evidenceText)
        referenced = [by_id[reference.segmentId] for reference in references if reference.segmentId in by_id]
        resolutions = [
            resolve_source_span(
                by_id[reference.segmentId].text, reference.evidenceText,
                expected_source_text_sha256=reference.sourceTextSha256 or None,
            )
            for reference in references
            if reference.evidenceText and reference.segmentId in by_id
        ]
        citation_valid = bool(cited_text and referenced and resolutions and all(item.status in _RESOLVED for item in resolutions))
        citation = _assess(claim, cited_text, referenced[0] if len(referenced) == 1 else None, "citation")
        segment = _assess_many(claim, referenced, "segment")
        referenced_ids = {item.segmentId for item in referenced}
        document = _assess_many(claim, [item for item in segments if item.segmentId not in referenced_ids], "document")
        citation_status = _citation_status(card, claim, cited_text, citation_valid, citation, segment, resolutions)
        support, fidelity, contradictions, confidence = _resolve(
            citation, segment, document, bool(references), bool(referenced), citation_valid,
        )
        results.append(GroundingResult(
            claimId=claim.claimId, sourceSupport=support, sourceFidelity=fidelity,
            citationStatus=citation_status, citationSpans=tuple(citation[1]),
            segmentSpans=tuple(segment[1]), documentSpans=tuple(document[1]),
            contradictionEvidence=tuple(contradictions), confidence=confidence,
            diagnostic={"lexicalUnsupportedTokens": _unsupported_tokens(claim.claimText, cited_text)},
            groundingVersion=GROUNDING_VERSION,
        ))
    return results


def _resolve(citation, segment, document, has_reference: bool, segment_found: bool, citation_valid: bool):
    assessments = (("supported_by_citation", citation), ("supported_by_segment", segment),
                   ("supported_elsewhere_in_source", document))
    contradictions = [text for _name, value in assessments for text in value[2]]
    if contradictions: return "contradicted", "contradicted_by_source", contradictions, 1.0
    for support, assessment in assessments:
        if assessment[0] == "supported":
            fidelity = "fully_grounded" if support == "supported_by_citation" else "partially_grounded"
            return support, fidelity, (), assessment[3]
    if has_reference and not segment_found: return "uncertain", "source_not_found", (), None
    if has_reference and not citation_valid: return "uncertain", "insufficient_evidence", (), None
    if any(value[0] == "uncertain" for _name, value in assessments): return "uncertain", "uncertain", (), None
    return "unsupported", "unsupported", (), 1.0


def _citation_status(card: NormalizedCard, claim: Claim, cited_text: str, valid: bool, citation, segment, resolutions):
    if not card.sourceReferences or not cited_text: return "missing"
    if any(item.status == "stale-source" for item in resolutions): return "stale"
    if not valid: return "wrong_segment"
    if citation[0] == "supported":
        if len(cited_text) > max(800, len(claim.claimText) * 12): return "overbroad"
        return "exact" if _normalized(claim.claimText) in _normalized(cited_text) else "sufficient"
    if segment[0] == "supported": return "partial"
    if citation[0] in {"uncertain", "contradicted"}: return "uncertain"
    return "partial" if _entity_overlap(claim.claimText, cited_text) else "uncertain"


def _assess_many(claim: Claim, segments: list[Segment], tier: str):
    best = ("unsupported", [], [], 0.0)
    supported = None
    contradictions: list[str] = []
    for segment in segments:
        assessment = _assess(claim, segment.text, segment, tier)
        if assessment[0] == "contradicted":
            contradictions.extend(assessment[2])
            continue
        if assessment[0] == "supported" and (supported is None or assessment[3] > supported[3]):
            supported = assessment
        if assessment[3] > best[3]: best = assessment
    if contradictions:
        return "contradicted", [], contradictions, 1.0
    if supported is not None:
        return supported
    return best


def _assess(claim: Claim, evidence: str, segment: Segment | None = None, tier: str = "citation"):
    if not evidence.strip(): return "unsupported", [], [], 0.0
    windows = _candidate_windows(evidence)
    best_score, best_window = max(((_support_score(claim.claimText, window), window) for window in windows), default=(0.0, ""))
    contradiction = _contradiction(claim, best_window or evidence)
    if contradiction: return "contradicted", [], [contradiction], 1.0
    numbers_match = _numbers_supported(claim.numericValues, best_window)
    negation_match = bool(_NEGATION.search(claim.claimText)) == bool(_NEGATION.search(best_window))
    relation_match = _relation_agrees(claim.relation, best_window)
    extractive_match = _normalized(claim.claimText) in _normalized(best_window)
    structured_match = (best_score == 1.0 and relation_match and not claim.extractionAmbiguous
                        and len(tokens(claim.claimText)) <= 14)
    if (extractive_match or structured_match) and numbers_match and negation_match and relation_match:
        start = evidence.find(best_window)
        base = segment.text.find(evidence) if segment and tier == "citation" else 0
        source_start = max(base, 0) + max(start, 0)
        span = EvidenceSpan(segment.segmentId if segment else "", segment.locator if segment else "",
                            source_start, source_start + len(best_window), best_window, tier)
        return "supported", [span], [], 1.0 if extractive_match else round(best_score, 4)
    if best_score >= 0.6 or (claim.numericValues and _entity_overlap(claim.claimText, evidence) and numbers_match):
        return "uncertain", [], [], round(best_score, 4)
    return "unsupported", [], [], round(best_score, 4)


def _candidate_windows(text: str) -> list[str]:
    lines = [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+|;\s*", text) if part.strip()]
    return lines + [f"{lines[index]} {lines[index + 1]}" for index in range(len(lines) - 1)] or [text]


def _support_score(claim: str, evidence: str) -> float:
    claim_tokens = [token for token in tokens(claim) if token not in STOP]
    evidence_tokens = Counter(tokens(evidence))
    return sum(evidence_tokens[token] > 0 for token in claim_tokens) / len(claim_tokens) if claim_tokens else 0.0


def _numbers_supported(numbers: tuple[NumericValue, ...], evidence: str) -> bool:
    normalized = evidence.lower().replace(" ", "")
    for number in numbers:
        value, unit = f"{number.value:g}", number.unit.replace("hour", "hr")
        if value not in normalized or (number.unit and number.unit not in normalized and unit not in normalized): return False
        if number.endValue is not None and f"{number.endValue:g}" not in normalized: return False
        qualifier = number.qualifier
        if qualifier in {"<", "less than"} and "<" not in evidence and "less than" not in evidence.lower(): return False
        if qualifier in {">", "more than"} and ">" not in evidence and "more than" not in evidence.lower(): return False
        if qualifier in {"~", "about", "approximately"} and not any(item in evidence.lower() for item in ("~", "about", "approximately")): return False
    return True


def _relation_agrees(relation: str, evidence: str) -> bool:
    stems = {"causes": "caus", "cause": "caus", "increases": "increas", "increase": "increas",
             "decreases": "decreas", "decrease": "decreas", "reduces": "reduc", "prevents": "prevent",
             "requires": "requir", "includes": "includ", "discontinue": "discontinu", "wait": "wait",
             "avoid": "avoid", "maintain": "maintain", "monitor": "monitor"}
    return not stems.get(relation) or stems[relation] in evidence.lower()


def _contradiction(claim: Claim, evidence: str) -> str:
    lower_claim, lower_evidence = claim.claimText.lower(), evidence.lower()
    if not evidence or not _entity_overlap(lower_claim, lower_evidence): return ""
    claim_negated = bool(_NEGATION.search(lower_claim))
    evidence_negated = bool(_NEGATION.search(lower_evidence)) and not bool(_EXAMPLE_NEGATION.search(lower_evidence))
    if claim_negated != evidence_negated and _support_score(lower_claim, lower_evidence) >= 0.45:
        return f"Negation mismatch: claim={claim.claimText!r}; source={evidence[:240]!r}"
    claim_words, evidence_words = set(tokens(lower_claim)), set(tokens(lower_evidence))
    for left, right in _ANTONYMS:
        claim_side = left if left in claim_words else (right if right in claim_words else "")
        evidence_side = left if left in evidence_words else (right if right in evidence_words else "")
        if claim_side and evidence_side and claim_side != evidence_side and not ({left, right} <= evidence_words):
            return f"Relation conflict: claim={claim.claimText!r}; source={evidence[:240]!r}"
    source_numbers = re.findall(r"\d+(?:\.\d+)?", evidence)
    if claim.numericValues and source_numbers and not _numbers_supported(claim.numericValues, evidence) and _support_score(lower_claim, lower_evidence) >= 0.45:
        return f"Numeric disagreement: claim={claim.claimText!r}; source={evidence[:240]!r}"
    return ""


def _entity_overlap(left: str, right: str) -> bool:
    return bool({token for token in tokens(left) if len(token) > 4} & set(tokens(right)))


def _unsupported_tokens(claim: str, evidence: str) -> list[str]:
    return sorted(set(tokens(claim)) - set(tokens(evidence)))


def _normalized(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9.]+", text.lower()))
