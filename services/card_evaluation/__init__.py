"""Reusable, provider-independent card evaluation core."""

from .models import (
    AuthorityEvidence,
    Card,
    Claim,
    GroundingResult,
    PolicyResult,
    RiskRoute,
    Segment,
    SourceVerificationContext,
    VerificationResult,
)
from .pipeline import EVALUATION_VERSION, evaluate_once, evaluate_production_candidate
from .risk import RISK_ROUTER_VERSION, route_claim
from .verification import VERIFICATION_SCHEMA_VERSION, VerificationCoordinator

__all__ = [
    "AuthorityEvidence",
    "Card",
    "Claim",
    "GroundingResult",
    "PolicyResult",
    "RiskRoute",
    "Segment",
    "SourceVerificationContext",
    "VerificationResult",
    "EVALUATION_VERSION",
    "RISK_ROUTER_VERSION",
    "VERIFICATION_SCHEMA_VERSION",
    "VerificationCoordinator",
    "evaluate_once",
    "evaluate_production_candidate",
    "route_claim",
]
