"""Compatibility exports for reusable production claim extraction."""

from services.card_evaluation.claims import (
    CLAIM_EXTRACTOR_VERSION,
    classify_claim_type,
    classify_risk,
    extract_claims,
    extract_numeric_values,
    extract_text_claims,
)

__all__ = [
    "CLAIM_EXTRACTOR_VERSION",
    "classify_claim_type",
    "classify_risk",
    "extract_claims",
    "extract_numeric_values",
    "extract_text_claims",
]
