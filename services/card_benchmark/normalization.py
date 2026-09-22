"""Compatibility exports for reusable production card normalization."""

from services.card_evaluation.normalization import NORMALIZATION_VERSION, normalize_card, normalize_cards

__all__ = ["NORMALIZATION_VERSION", "normalize_card", "normalize_cards"]
