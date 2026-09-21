from __future__ import annotations

import re
from dataclasses import asdict

from .analysis import core_answer, tokens
from .claims import extract_numeric_values
from .models import Card, Concept

SOURCE_MATCH_VERSION = "2.0.0"
_INTENTS = {
    "definition": r"\bwhat is|define|meaning", "finding": r"sign|symptom|manifest|finding",
    "treatment": r"treat|management|intervention|action|therapy", "mechanism": r"cause|mechanism|why|how does",
    "adverse_effect": r"adverse|side effect|toxicity", "indication": r"indication|used for",
    "comparison": r"differ|distinguish|compare|versus|\bvs\b", "timing": r"\bwhen\b|duration|how long",
    "dose": r"\bdose\b|dosage|amount", "risk": r"risk|warning|avoid|contraindicat",
    "diagnostic": r"diagnostic criteria|criteria|required to diagnose",
    "communication": r"what should you say|how should a nurse|present reality|respond|therapeutic communication",
}
_ENTITY_STOP = {"what", "which", "when", "where", "does", "differ", "sign", "signs", "symptom", "symptoms",
                "treatment", "management", "common", "primary", "clinical", "associated", "characteristic",
                "defense", "mechanism", "disorder", "disorders", "definition"}


def question_intent(question: str) -> frozenset[str]:
    found = {name for name, pattern in _INTENTS.items() if re.search(pattern, question, re.I)}
    return frozenset(found or {"other"})


def classify_pair(concept: Concept, left: Card, right: Card) -> str:
    proposition = set(tokens(concept.atomicProposition))
    left_terms, right_terms = _card_terms(left), _card_terms(right)
    if not proposition or len(proposition & left_terms) / len(proposition) < .45 or len(proposition & right_terms) / len(proposition) < .45:
        return "DIFFERENT_CONCEPT"
    if not _intent_compatible(question_intent(left.question), question_intent(right.question)):
        return "DIFFERENT_CONCEPT"
    if not _entities_compatible(left, right): return "DIFFERENT_CONCEPT"
    if not _numeric_compatible(concept.atomicProposition, left) or not _numeric_compatible(concept.atomicProposition, right):
        return "DIFFERENT_CONCEPT"
    overlap = len(left_terms & right_terms) / max(1, len(left_terms | right_terms))
    left_intent, right_intent = question_intent(left.question), question_intent(right.question)
    asymmetric_comparison = ("comparison" in left_intent) != ("comparison" in right_intent)
    return "SAME_CONCEPT" if overlap >= .18 and not asymmetric_comparison else "PARTIAL_OVERLAP"


def build_pair(concept: Concept, production: Card, quizlet: Card) -> dict[str, object]:
    adjudication = classify_pair(concept, production, quizlet)
    p_recall = _recall(concept, production); q_recall = _recall(concept, quizlet)
    production_intent, quizlet_intent = question_intent(production.question), question_intent(quizlet.question)
    intent = _intent_compatible(production_intent, quizlet_intent)
    confidence = "NONE"
    if adjudication == "SAME_CONCEPT": confidence = "HIGH" if intent and min(p_recall, q_recall) >= .6 else "MEDIUM"
    elif adjudication == "PARTIAL_OVERLAP": confidence = "MEDIUM" if min(p_recall, q_recall) >= .6 else "LOW"
    return {
        "conceptId": concept.conceptId, "productionCardId": production.cardId, "quizletCardId": quizlet.cardId,
        "adjudication": adjudication, "matchConfidence": confidence,
        "sourceConcept": concept.atomicProposition, "sourceSpans": [asdict(span) for span in concept.sourceSpans],
        "proposition": {"productionRecall": round(p_recall, 4), "quizletRecall": round(q_recall, 4)},
        "questionIntent": {"production": sorted(production_intent),
                           "quizlet": sorted(quizlet_intent), "agrees": intent},
        "matcherVersion": SOURCE_MATCH_VERSION,
    }


def source_constrained_pairs(production: list[Card], quizlet: list[Card], concepts: list[Concept]) -> list[dict[str, object]]:
    candidates = []
    for concept in concepts:
        left = [card for card in production if _recall(concept, card) >= .45]
        right = [card for card in quizlet if _recall(concept, card) >= .45]
        for p_card in left:
            for q_card in right:
                pair = build_pair(concept, p_card, q_card)
                if pair["adjudication"] in {"SAME_CONCEPT", "PARTIAL_OVERLAP"} and pair["matchConfidence"] in {"HIGH", "MEDIUM"}:
                    candidates.append(pair)
    rank = {"HIGH": 0, "MEDIUM": 1}; used_p = set(); used_q = set(); used_concepts = set(); output = []
    for pair in sorted(candidates, key=lambda x: (rank[str(x["matchConfidence"])], x["conceptId"], x["productionCardId"], x["quizletCardId"])):
        if pair["conceptId"] in used_concepts or pair["productionCardId"] in used_p or pair["quizletCardId"] in used_q: continue
        used_concepts.add(pair["conceptId"]); used_p.add(pair["productionCardId"]); used_q.add(pair["quizletCardId"]); output.append(pair)
    return output



def build_comparison_scope(matches: list[dict[str, object]], concepts: list[Concept]) -> dict[str, object]:
    by_id = {concept.conceptId: concept for concept in concepts}
    qualified = [match for match in matches if match.get("matchConfidence") in {"HIGH", "MEDIUM"} and match.get("adjudication") == "SAME_CONCEPT"]
    ids = {str(match["conceptId"]) for match in qualified}
    counts = {level: sum(by_id[item].importance == level for item in ids) for level in ("critical", "high", "medium", "low")}
    capacity = len(ids)
    critical_high = sum(by_id[str(match["conceptId"])].importance in {"critical", "high"} for match in qualified)
    selected_capacity = critical_high + sum(by_id[str(match["conceptId"])].importance == "medium" for match in qualified)
    return {"status": "FULL_COMPARISON_SCOPE" if capacity >= 30 else "COMPARISON_SCOPE_LIMITED",
            "sharedComparableConcepts": capacity, "criticalSharedConcepts": counts["critical"],
            "highImportanceSharedConcepts": counts["high"], "mediumSharedConcepts": counts["medium"],
            "requiredComparisonCount": 30 if capacity >= 30 else selected_capacity,
            "legacyThirtyPairRuleApplied": capacity >= 30,
            "rule": "Compare at least 30 when capacity permits; otherwise all critical/high and representative medium concepts."}


def _card_terms(card: Card) -> set[str]:
    # Evidence constrains provenance; it must not make an untested source detail look retrieved.
    return set(tokens(f"{card.question} {core_answer(card.answer)}"))


def _recall(concept: Concept, card: Card) -> float:
    proposition = set(tokens(concept.atomicProposition))
    return len(proposition & _card_terms(card)) / len(proposition) if proposition else 0.0


def _intent_compatible(left: frozenset[str], right: frozenset[str]) -> bool:
    if left == {"other"} or right == {"other"}: return True
    if "communication" in left or "communication" in right:
        return "communication" in left and "communication" in right
    incompatible = ({"indication", "adverse_effect"}, {"indication", "treatment"},
                    {"dose", "adverse_effect"}, {"finding", "treatment"})
    return bool(left & right) and not any((a in left and b in right) or (b in left and a in right) for a, b in incompatible)


def _entities_compatible(left: Card, right: Card) -> bool:
    entities = lambda card: {token for token in tokens(card.question) if len(token) > 4 and token not in _ENTITY_STOP}
    a, b = entities(left), entities(right)
    return not a or not b or bool(a & b)


def _numeric_compatible(source: str, card: Card) -> bool:
    expected = extract_numeric_values(source)
    if not expected: return True
    actual = extract_numeric_values(f"{card.question} {card.answer}")
    return all(any((x.value, x.endValue, x.unit, x.qualifier) == (y.value, y.endValue, y.unit, y.qualifier) for y in actual) for x in expected)
