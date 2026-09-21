from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from functools import lru_cache
from typing import Iterable

from .analysis import core_answer, tokens
from .claims import extract_numeric_values
from .models import Card, Concept

SEMANTIC_MATCH_VERSION = "1.0.0"
SEMANTIC_MATCH_THRESHOLD = 0.58

# Small, reviewable equivalence table: paraphrase aid, not medical truth oracle.
_EQUIVALENCES = {
    "heart attack": "myocardial infarction", "high blood pressure": "hypertension",
    "low blood pressure": "hypotension", "adverse effect": "side effect",
    "adverse effects": "side effects", "contraindicated": "avoid",
    "contraindication": "avoid", "discontinue": "stop", "cessation": "stop",
    "hyperthermia": "high temperature", "pyrexia": "fever",
    "loss of consciousness": "unconsciousness",
}
_OPPOSITES = (
    ("increase", "decrease"), ("increases", "decreases"),
    ("stimulate", "inhibit"), ("stimulates", "inhibits"),
    ("safe", "unsafe"), ("indicated", "avoid"), ("continue", "stop"),
    ("temporary", "permanent"), ("normal", "abnormal"),
)
_NEGATION = re.compile(r"\b(?:no|not|never|without|doesn't|does not|isn't|is not|aren't|are not)\b", re.I)


@dataclass(frozen=True, slots=True)
class ConceptCardMatch:
    conceptId: str
    cardId: str
    system: str
    score: float
    propositionRecall: float
    cardPrecision: float
    labelRecall: float
    segmentAligned: bool
    numericAgreement: bool
    contradictionVeto: bool
    matcherVersion: str = SEMANTIC_MATCH_VERSION


def match_cards_to_concepts(cards: list[Card], concepts: list[Concept],
                              threshold: float = SEMANTIC_MATCH_THRESHOLD) -> list[ConceptCardMatch]:
    matches: list[ConceptCardMatch] = []
    for card in cards:
        for concept in concepts:
            result = score_concept_card(concept, card)
            if result.score >= threshold and result.numericAgreement and not result.contradictionVeto:
                matches.append(result)
    return sorted(matches, key=lambda item: (item.system, item.cardId, -item.score, item.conceptId))


def score_concept_card(concept: Concept, card: Card) -> ConceptCardMatch:
    proposition = _semantic_tokens(" ".join((concept.atomicProposition, *concept.aliases)))
    label = _semantic_tokens(" ".join((concept.canonicalLabel, *concept.aliases)))
    card_text = " ".join(filter(None, (card.question, core_answer(card.answer), card.evidenceText,
                                               card.learningObjective)))
    card_terms = _semantic_tokens(card_text)
    overlap = proposition & card_terms
    recall = _ratio(len(overlap), len(proposition))
    precision = _ratio(len(overlap), len(card_terms))
    label_recall = _ratio(len(label & card_terms), len(label))
    f1 = _ratio(2 * recall * precision, recall + precision)
    segment_aligned = bool(card.segmentId and card.segmentId == concept.segmentId)
    numeric_agreement = _numeric_agreement(concept.atomicProposition, card_text)
    contradiction = _contradiction(concept.atomicProposition, card_text)
    score = 0.58 * recall + 0.22 * f1 + 0.15 * label_recall + (0.05 if segment_aligned else 0.0)
    if recall < 0.34 or precision < 0.08:
        score = min(score, SEMANTIC_MATCH_THRESHOLD - 0.01)
    if not numeric_agreement or contradiction:
        score = 0.0
    return ConceptCardMatch(
        conceptId=concept.conceptId, cardId=card.cardId, system=card.system,
        score=round(min(score, 1.0), 4), propositionRecall=round(recall, 4),
        cardPrecision=round(precision, 4), labelRecall=round(label_recall, 4),
        segmentAligned=segment_aligned, numericAgreement=numeric_agreement,
        contradictionVeto=contradiction,
    )


def pair_systems(production: list[Card], quizlet: list[Card], concepts: list[Concept]) -> list[dict[str, object]]:
    """Greedily pair cards only when both map to same frozen source concept."""
    matches = match_cards_to_concepts(production + quizlet, concepts)
    by_concept: dict[str, dict[str, list[ConceptCardMatch]]] = {}
    for match in matches:
        by_concept.setdefault(match.conceptId, {}).setdefault(match.system, []).append(match)
    candidates: list[tuple[float, str, str, str, ConceptCardMatch, ConceptCardMatch]] = []
    for concept_id, systems in by_concept.items():
        for left in systems.get("production", []):
            for right in systems.get("quizlet", []):
                score = 2 * left.score * right.score / (left.score + right.score)
                candidates.append((score, concept_id, left.cardId, right.cardId, left, right))
    used_production: set[str] = set(); used_quizlet: set[str] = set(); output = []
    for score, concept_id, production_id, quizlet_id, left, right in sorted(
        candidates, key=lambda row: (-row[0], row[1], row[2], row[3])
    ):
        if production_id in used_production or quizlet_id in used_quizlet:
            continue
        used_production.add(production_id); used_quizlet.add(quizlet_id)
        output.append({
            "conceptId": concept_id, "productionCardId": production_id, "quizletCardId": quizlet_id,
            "semanticSimilarity": round(score, 4), "productionMatch": asdict(left),
            "quizletMatch": asdict(right), "matcherVersion": SEMANTIC_MATCH_VERSION,
        })
    return output



def calibration_summary(rows: Iterable[dict[str, object]]) -> dict[str, object]:
    values = list(rows)
    tp = sum(bool(row["expectedMatch"]) and bool(row["actualMatch"]) for row in values)
    fp = sum(not bool(row["expectedMatch"]) and bool(row["actualMatch"]) for row in values)
    fn = sum(bool(row["expectedMatch"]) and not bool(row["actualMatch"]) for row in values)
    tn = len(values) - tp - fp - fn
    precision = _ratio(tp, tp + fp); recall = _ratio(tp, tp + fn)
    passed = precision >= 0.9 and recall >= 0.9 and not fp and not fn
    return {"fixtureCount": len(values), "truePositive": tp, "falsePositive": fp,
            "falseNegative": fn, "trueNegative": tn, "precision": round(precision, 4),
            "recall": round(recall, 4), "passed": passed,
            "matcherVersion": SEMANTIC_MATCH_VERSION}


@lru_cache(maxsize=4096)
def _semantic_tokens(text: str) -> frozenset[str]:
    normalized = " ".join(text.lower().split())
    for source, target in sorted(_EQUIVALENCES.items(), key=lambda item: -len(item[0])):
        normalized = re.sub(rf"\b{re.escape(source)}\b", target, normalized)
    return frozenset(tokens(normalized))


def _numeric_agreement(concept_text: str, card_text: str) -> bool:
    expected = extract_numeric_values(concept_text)
    if not expected:
        return True
    actual = extract_numeric_values(card_text)
    return all(any((item.value, item.endValue, item.unit, item.qualifier) ==
                   (candidate.value, candidate.endValue, candidate.unit, candidate.qualifier)
                   for candidate in actual) for item in expected)


def _contradiction(concept_text: str, card_text: str) -> bool:
    concept_lower, card_lower = concept_text.lower(), card_text.lower()
    concept_negated = bool(_NEGATION.search(concept_lower)); card_negated = bool(_NEGATION.search(card_lower))
    shared = _semantic_tokens(concept_text) & _semantic_tokens(card_text)
    if concept_negated != card_negated and len(shared) >= 2:
        return True
    for left, right in _OPPOSITES:
        if ((re.search(rf"\b{left}\b", concept_lower) and re.search(rf"\b{right}\b", card_lower)) or
                (re.search(rf"\b{right}\b", concept_lower) and re.search(rf"\b{left}\b", card_lower))):
            return True
    return False


def _ratio(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator else 0.0
