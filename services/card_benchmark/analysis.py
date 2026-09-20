from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import asdict
from typing import Iterable

from .models import Card, Concept, Segment

TOKEN = re.compile(r"[a-z0-9]+(?:['-][a-z0-9]+)?", re.I)
STOP = frozenset("a an and are as at be been by can did do does for from had has have how in into is it its of on or that the their this to was were what when where which who why with".split())
LABELS = ("answer:", "why it matters:", "study note:")


def tokens(text: str) -> list[str]:
    return [token.lower() for token in TOKEN.findall(text) if len(token) > 2 and token.lower() not in STOP]


def freeze_concepts(segments: list[Segment]) -> list[Concept]:
    """Create deterministic source-only inventory before viewing either card set."""
    concepts: list[Concept] = []
    for segment in segments:
        sentences = re.split(r"(?<=[.!?])\s+|\n+", segment.text)
        for sentence in sentences:
            clean = " ".join(sentence.split()).strip(" •▪-\t")
            concept_tokens = tuple(dict.fromkeys(tokens(clean)))
            if 4 <= len(concept_tokens) and 25 <= len(clean) <= 320:
                concepts.append(Concept(
                    conceptId=f"concept-{len(concepts) + 1:04d}", locator=segment.locator,
                    segmentId=segment.segmentId, text=clean, tokens=concept_tokens,
                ))
    return concepts


def analyze_system(cards: list[Card], concepts: list[Concept], source_text: str) -> tuple[dict[str, object], list[dict[str, object]]]:
    document_tokens = Counter(tokens(source_text))
    duplicates = duplicate_clusters(cards)
    covered: set[str] = set()
    covered_segments: set[str] = set()
    source_segments = {concept.segmentId for concept in concepts}
    rows: list[dict[str, object]] = []
    structural_scores: list[float] = []
    pedagogical_scores: list[float] = []
    grounded_scores: list[float] = []
    for card in cards:
        match_tokens = coverage_tokens(card)
        matched, match_score, match_recall = best_concept_match(match_tokens, concepts, card.segmentId)
        if matched and match_recall >= 0.50:
            covered.add(matched.conceptId)
        if card.segmentId in source_segments:
            covered_segments.add(card.segmentId)
        card_tokens = tokens(f"{card.question} {card.answer}")
        grounding = lexical_grounding(card_tokens, document_tokens)
        structural = structural_compliance(card)
        pedagogical = pedagogical_proxy(card)
        structural_scores.append(structural)
        pedagogical_scores.append(pedagogical)
        grounded_scores.append(grounding)
        rows.append({
            **asdict(card),
            "structuralComplianceScore": structural,
            "pedagogicalProxyScore": pedagogical,
            "groundingScore": grounding,
            "matchedConceptId": matched.conceptId if matched else "",
            "conceptMatchJaccard": round(match_score, 4),
            "conceptTokenRecall": round(match_recall, 4),
            "sourceSupported": grounding >= 0.72 if card.system == "quizlet" else bool(card.evidenceText),
        })
    duplicate_count = sum(len(cluster) - 1 for cluster in duplicates)
    summary: dict[str, object] = {
        "cardCount": len(cards), "conceptCount": len(concepts), "coveredConceptCount": len(covered),
        "conceptCoverageRate": round(len(covered) / len(concepts), 4) if concepts else 0.0,
        "sourceSegmentCount": len(source_segments), "coveredSegmentCount": len(covered_segments),
        "segmentCoverageRate": round(len(covered_segments) / len(source_segments), 4) if source_segments else 0.0,
        "duplicateClusterCount": len(duplicates), "duplicateCardCount": duplicate_count,
        "duplicateRate": round(duplicate_count / len(cards), 4) if cards else 0.0,
        "meanStructuralComplianceScore": mean(structural_scores) if all(card.system == "production" for card in cards) else None,
        "meanPedagogicalProxyScore": mean(pedagogical_scores),
        "meanGroundingScore": mean(grounded_scores),
        "sourceSupportedRate": round(sum(bool(row["sourceSupported"]) for row in rows) / len(rows), 4) if rows else 0.0,
    }
    return summary, rows


def match_systems(left: list[Card], right: list[Card]) -> list[dict[str, object]]:
    candidates: list[tuple[float, str, str]] = []
    for left_card in left:
        left_tokens = set(tokens(f"{left_card.question} {left_card.answer}"))
        for right_card in right:
            score = jaccard(left_tokens, set(tokens(f"{right_card.question} {right_card.answer}")))
            if score >= 0.18:
                candidates.append((score, left_card.cardId, right_card.cardId))
    used_left: set[str] = set()
    used_right: set[str] = set()
    matches = []
    for score, left_id, right_id in sorted(candidates, key=lambda row: (-row[0], row[1], row[2])):
        if left_id not in used_left and right_id not in used_right:
            used_left.add(left_id); used_right.add(right_id)
            matches.append({"productionCardId": left_id, "quizletCardId": right_id,
                            "lexicalSimilarity": round(score, 4)})
    return matches


def duplicate_clusters(cards: list[Card], threshold: float = 0.82) -> list[list[str]]:
    parent = {card.cardId: card.cardId for card in cards}
    def root(value: str) -> str:
        while parent[value] != value:
            parent[value] = parent[parent[value]]; value = parent[value]
        return value
    token_sets = {card.cardId: set(tokens(f"{card.question} {card.answer}")) for card in cards}
    for index, left in enumerate(cards):
        for right in cards[index + 1:]:
            if jaccard(token_sets[left.cardId], token_sets[right.cardId]) >= threshold:
                left_root, right_root = root(left.cardId), root(right.cardId)
                if left_root != right_root: parent[right_root] = left_root
    groups: dict[str, list[str]] = defaultdict(list)
    for card in cards: groups[root(card.cardId)].append(card.cardId)
    return sorted((sorted(group) for group in groups.values() if len(group) > 1), key=lambda group: group[0])


def core_answer(answer: str) -> str:
    match = re.search(r"(?:^|\n)\s*Answer:\s*(.*?)(?=\n\s*(?:Why it matters|Study note):|$)", answer, re.I | re.S)
    return match.group(1).strip() if match else answer


def coverage_tokens(card: Card) -> list[str]:
    parts = [card.question, core_answer(card.answer)]
    if card.evidenceText:
        parts.append(card.evidenceText)
    return tokens(" ".join(parts))


def best_concept_match(card_tokens: list[str], concepts: list[Concept], segment_id: str = "") -> tuple[Concept | None, float, float]:
    card_set = set(card_tokens)
    eligible = [concept for concept in concepts if segment_id and concept.segmentId == segment_id] or concepts
    best: Concept | None = None
    best_jaccard = 0.0
    best_recall = 0.0
    for concept in eligible:
        concept_set = set(concept.tokens)
        overlap = len(card_set & concept_set)
        recall = overlap / len(concept_set) if concept_set else 0.0
        similarity = jaccard(card_set, concept_set)
        rank = (recall, similarity, concept.conceptId)
        current_rank = (best_recall, best_jaccard, best.conceptId if best else "")
        if rank > current_rank:
            best, best_jaccard, best_recall = concept, similarity, recall
    return best, best_jaccard, best_recall


def best_concept(card_tokens: list[str], concepts: list[Concept]) -> tuple[Concept | None, float]:
    matched, similarity, _recall = best_concept_match(card_tokens, concepts)
    return matched, similarity


def lexical_grounding(card_tokens: list[str], source_tokens: Counter[str]) -> float:
    distinctive = [token for token in card_tokens if len(token) > 3]
    if not distinctive:
        return 0.0
    return round(sum(source_tokens[token] > 0 for token in distinctive) / len(distinctive), 4)


def audit_production_grounding(
    cards: list[Card], segments: list[Segment] | None = None,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    segment_text = {segment.segmentId: segment.text for segment in segments or []}
    rows: list[dict[str, object]] = []
    for card in cards:
        claim_tokens = set(tokens(f"{card.question} {card.answer}"))
        evidence_tokens = set(tokens(card.evidenceText))
        cited_unsupported = sorted(token for token in claim_tokens - evidence_tokens if len(token) > 3)
        full_segment_tokens = set(tokens(segment_text.get(card.segmentId, card.evidenceText)))
        segment_unsupported = sorted(token for token in claim_tokens - full_segment_tokens if len(token) > 3)
        support = round(len(claim_tokens & evidence_tokens) / len(claim_tokens), 4) if claim_tokens else 0.0
        rows.append({
            "cardId": card.cardId,
            "segmentId": card.segmentId,
            "locator": card.locator,
            "evidenceText": card.evidenceText,
            "claimEvidenceTokenSupport": support,
            "unsupportedByCitedEvidenceTokens": cited_unsupported,
            "unsupportedByFullSegmentTokens": segment_unsupported,
            "manualReviewRequired": bool(cited_unsupported),
            "reviewStatus": "pending",
            "notes": "",
        })
    summary: dict[str, object] = {
        "cardCount": len(rows),
        "cardsRequiringManualReview": sum(bool(row["manualReviewRequired"]) for row in rows),
        "meanClaimEvidenceTokenSupport": mean(float(row["claimEvidenceTokenSupport"]) for row in rows),
        "limitation": "Lexical triage only; manually verify every claim against cited evidence.",
    }
    return summary, rows


def structural_compliance(card: Card) -> float:
    checks = [
        15 <= len(card.question) <= 250,
        card.question.rstrip().endswith("?"),
        5 <= len(card.answer) <= 800,
    ]
    if card.system == "production":
        checks.extend([
            sum(label in card.answer.lower() for label in LABELS) == len(LABELS),
            25 <= len(card.evidenceText) <= 600,
            10 <= len(card.learningObjective) <= 200,
            bool(card.cardType),
        ])
    return round(sum(checks) / len(checks), 4)


def pedagogical_proxy(card: Card) -> float:
    score = 0.0
    if 15 <= len(card.question) <= 180:
        score += 0.25
    if card.question.rstrip().endswith("?"):
        score += 0.10
    if 5 <= len(core_answer(card.answer)) <= 300:
        score += 0.25
    if not re.search(r"\bwhat does\s+(?:page\s+\w+|the (?:text|section|author|document|source))\b", card.question, re.I):
        score += 0.20
    if len(set(tokens(card.question))) >= 3:
        score += 0.10
    if len(set(tokens(core_answer(card.answer)))) >= 2:
        score += 0.10
    return round(score, 2)


def card_quality(card: Card) -> float:
    """Compatibility alias for old callers; now measures pedagogical form only."""
    return pedagogical_proxy(card)


def jaccard(left: set[str], right: set[str]) -> float:
    union = left | right
    return len(left & right) / len(union) if union else 0.0


def mean(values: Iterable[float]) -> float:
    values = list(values)
    return round(math.fsum(values) / len(values), 4) if values else 0.0

