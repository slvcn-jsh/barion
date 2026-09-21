"""Reusable, provider-independent card evaluation core."""

from .models import (
    AuthorityEvidence,
    RiskRoute,
    SourceVerificationContext,
    VerificationResult,
)
from .risk import RISK_ROUTER_VERSION, route_claim
from .verification import VERIFICATION_SCHEMA_VERSION, VerificationCoordinator

__all__ = [
    "AuthorityEvidence",
    "RiskRoute",
    "SourceVerificationContext",
    "VerificationResult",
    "RISK_ROUTER_VERSION",
    "VERIFICATION_SCHEMA_VERSION",
    "VerificationCoordinator",
    "route_claim",
]
