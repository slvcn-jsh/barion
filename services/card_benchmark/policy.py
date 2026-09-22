"""Compatibility exports for production publication policy."""

from services.card_evaluation.policy import POLICY_VERSION, decide_publication

__all__ = ["POLICY_VERSION", "decide_publication"]
