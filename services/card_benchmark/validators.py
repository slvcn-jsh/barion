from __future__ import annotations

from services.card_evaluation.validation import VALIDATOR_VERSION, validate_card

from .analysis import duplicate_clusters
from .models import Card, NormalizedCard, Segment, ValidationResult


def validate_deck(cards: list[NormalizedCard], segments: list[Segment] | None = None) -> list[ValidationResult]:
    results: list[ValidationResult] = []
    legacy = [Card(card.cardId, card.question, card.rawAnswer, card.system) for card in cards]
    for cluster in duplicate_clusters(legacy):
        results.append(_result(
            "EXACT_OR_NEAR_DUPLICATE", "moderate", "", "deck", tuple(cluster),
            "repeated_card_content", "REVIEW",
        ))
    if len(cards) >= 10 and segments:
        source_cutoff = max(1, len(segments) // 5)
        early_ids = {segment.segmentId for segment in segments[:source_cutoff]}
        cited = [reference.segmentId for card in cards for reference in card.sourceReferences if reference.segmentId]
        if cited and sum(segment_id in early_ids for segment_id in cited) / len(cited) >= 0.8:
            results.append(_result(
                "START_CONCENTRATED_DECK", "moderate", "", "deck", tuple(sorted(set(cited))),
                "generation_coverage_bias", "REVIEW",
            ))
    return results


def _result(code, severity, claim, field, evidence, root, consequence):
    return ValidationResult(code, severity, claim, field, tuple(evidence), root, consequence)


__all__ = ["VALIDATOR_VERSION", "validate_card", "validate_deck"]
