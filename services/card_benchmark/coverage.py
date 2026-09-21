from __future__ import annotations

import math
import re
from collections import Counter, defaultdict

from .analysis import coverage_tokens, duplicate_clusters
from .models import Card, Concept

COVERAGE_VERSION = "2.0.0"
DEFAULT_WEIGHT_CONFIG = {"version": "1.0.0", "critical": 8.0, "high": 4.0, "medium": 2.0, "low": 1.0}
MATCH_RECALL_THRESHOLD = 0.6


def evaluate_coverage(cards: list[Card], concepts: list[Concept], page_count: int | None = None,
                      weights: dict[str, object] | None = None) -> dict[str, object]:
    """Evaluate many-card/many-concept coverage without duplicate-card inflation."""
    config = dict(weights or DEFAULT_WEIGHT_CONFIG)
    eligible = [concept for concept in concepts if concept.eligible]
    matches: dict[str, list[str]] = defaultdict(list)
    card_matches: list[dict[str, object]] = []
    for card in cards:
        card_token_set = set(coverage_tokens(card))
        matched = []
        for concept in eligible:
            concept_tokens = set(concept.tokens)
            overlap = len(card_token_set & concept_tokens)
            recall = overlap / len(concept_tokens) if concept_tokens else 0.0
            precision = overlap / len(card_token_set) if card_token_set else 0.0
            numeric_ok = _numeric_tokens(concept.atomicProposition) <= _numeric_tokens(
                f"{card.question} {card.answer} {card.evidenceText}")
            segment_bonus = bool(card.segmentId and card.segmentId == concept.segmentId)
            threshold = 0.5 if segment_bonus else MATCH_RECALL_THRESHOLD
            if recall >= threshold and precision >= 0.12 and numeric_ok:
                matches[concept.conceptId].append(card.cardId)
                matched.append({"conceptId": concept.conceptId, "recall": round(recall, 4),
                                "precision": round(precision, 4), "segmentAligned": segment_bonus})
        card_matches.append({"cardId": card.cardId, "matches": sorted(matched, key=lambda row: str(row["conceptId"]))})
    covered = set(matches)
    weighted_total = math.fsum(float(config[concept.importance]) for concept in eligible)
    weighted_covered = math.fsum(float(config[concept.importance]) for concept in eligible if concept.conceptId in covered)
    duplicates = duplicate_clusters(cards)
    duplicate_count = sum(len(cluster) - 1 for cluster in duplicates)
    page_total = page_count or (max((span.pageIndex for concept in eligible for span in concept.sourceSpans), default=-1) + 1)
    dimensions = {
        "sections": _dimension(eligible, covered, lambda c: c.section or "Unsectioned", config),
        "pages": _dimension(eligible, covered, lambda c: c.locator or "Unknown page", config),
        "documentRegions": _dimension(eligible, covered, lambda c: _third(c, page_total), config),
        "importanceLevels": _dimension(eligible, covered, lambda c: c.importance, config),
        "conceptTypes": _dimension(eligible, covered, lambda c: c.conceptType, config),
    }
    source_distribution, card_distribution = _position_distributions(eligible, matches, page_total)
    question_types = Counter(card.cardType or "unspecified" for card in cards)
    return {
        "coverageVersion": COVERAGE_VERSION, "weightConfig": config,
        "eligibleConceptCount": len(eligible), "coveredConceptCount": len(covered),
        "sourceCoverage": _ratio(weighted_covered, weighted_total),
        "importantConceptCoverage": _subset_coverage(eligible, covered, {"critical", "high"}, config),
        "criticalConceptCoverage": _subset_coverage(eligible, covered, {"critical"}, config),
        "highYieldCoverage": _subset_coverage(eligible, covered, {"critical", "high"}, config),
        "sectionCoverage": {key: row["weightedCoverage"] for key, row in dimensions["sections"].items()},
        "pageCoverage": {key: row["weightedCoverage"] for key, row in dimensions["pages"].items()},
        "sourcePositionDistribution": {"eligibleConcepts": source_distribution, "coveredByCards": card_distribution,
                                       "jensenShannonDivergence": _js_divergence(source_distribution, card_distribution)},
        "duplicateRate": _ratio(duplicate_count, len(cards)), "duplicateClusters": duplicates,
        "conceptDiversity": _ratio(len(covered), sum(len(ids) for ids in matches.values())),
        "coverageBalance": round(1.0 - _js_divergence(source_distribution, card_distribution), 4),
        "questionTypeDiversity": {"distinctCount": len(question_types), "distribution": dict(sorted(question_types.items()))},
        "difficultyDistribution": {"available": False, "distribution": {}},
        "coveredConceptIds": sorted(covered), "conceptToCardIds": {key: sorted(value) for key, value in sorted(matches.items())},
        "cardMatches": card_matches, "coverageMap": dimensions, "zeroCoverageRegions": _zero_regions(dimensions),
    }



def _dimension(concepts: list[Concept], covered: set[str], key_fn, config: dict[str, object]) -> dict[str, dict[str, object]]:
    groups: dict[str, list[Concept]] = defaultdict(list)
    for concept in concepts:
        groups[str(key_fn(concept))].append(concept)
    output = {}
    total_covered = max(1, len(covered))
    for key, values in sorted(groups.items()):
        total = math.fsum(float(config[value.importance]) for value in values)
        hit = math.fsum(float(config[value.importance]) for value in values if value.conceptId in covered)
        coverage = _ratio(hit, total)
        allocation = _ratio(sum(value.conceptId in covered for value in values), total_covered)
        status = "zero coverage" if not hit else ("weak coverage" if coverage < 0.5 else (
            "over-concentration" if allocation > 0.5 and len(groups) > 1 else "strong coverage"))
        output[key] = {"eligibleConceptCount": len(values),
                       "coveredConceptCount": sum(value.conceptId in covered for value in values),
                       "weightedCoverage": coverage, "allocationShare": allocation, "status": status}
    return output


def _subset_coverage(concepts: list[Concept], covered: set[str], levels: set[str], config: dict[str, object]) -> float:
    subset = [concept for concept in concepts if concept.importance in levels]
    total = math.fsum(float(config[concept.importance]) for concept in subset)
    hit = math.fsum(float(config[concept.importance]) for concept in subset if concept.conceptId in covered)
    return _ratio(hit, total)


def _position_distributions(concepts: list[Concept], matches: dict[str, list[str]], page_count: int) -> tuple[list[float], list[float]]:
    source = [0.0] * 10
    covered = [0.0] * 10
    for concept in concepts:
        index = _decile(concept, page_count)
        source[index] += 1.0
        if concept.conceptId in matches:
            covered[index] += 1.0
    return _normalize_distribution(source), _normalize_distribution(covered)


def _decile(concept: Concept, page_count: int) -> int:
    if not concept.sourceSpans or page_count <= 0:
        return 0
    page_fraction = concept.sourceSpans[0].pageIndex / max(1, page_count)
    return min(9, max(0, int(page_fraction * 10)))


def _third(concept: Concept, page_count: int) -> str:
    fraction = concept.sourceSpans[0].pageIndex / max(1, page_count)
    return "first third" if fraction < 1 / 3 else ("middle third" if fraction < 2 / 3 else "final third")


def _normalize_distribution(values: list[float]) -> list[float]:
    total = math.fsum(values)
    return [round(value / total, 6) for value in values] if total else [0.0 for _ in values]


def _js_divergence(left: list[float], right: list[float]) -> float:
    if not any(left) or not any(right):
        return 1.0 if any(left) != any(right) else 0.0
    middle = [(a + b) / 2 for a, b in zip(left, right)]
    def kl(values: list[float]) -> float:
        return math.fsum(value * math.log2(value / mean) for value, mean in zip(values, middle) if value and mean)
    return round((kl(left) + kl(right)) / 2, 4)


def _zero_regions(dimensions: dict[str, dict[str, dict[str, object]]]) -> list[dict[str, str]]:
    return [{"dimension": dimension, "region": key} for dimension, rows in dimensions.items()
            for key, row in rows.items() if row["status"] == "zero coverage"]


def _numeric_tokens(text: str) -> set[str]:
    pattern = r"\b\d+(?:\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?\s*(?:%|mg|mcg|g|kg|m[lL]|mEq/L|mmHg|hours?|days?|weeks?|months?|years?)?"
    return {" ".join(value.lower().split()) for value in re.findall(pattern, text, re.I)}


def _ratio(numerator: float | int, denominator: float | int) -> float:
    return round(float(numerator) / float(denominator), 4) if denominator else 0.0
