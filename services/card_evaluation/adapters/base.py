from __future__ import annotations

from typing import Protocol

from ..models import RiskRoute, SourceVerificationContext, VerificationResult


class AuthorityAdapter(Protocol):
    id: str
    version: str
    authority_type: str
    authority_name: str

    def supports(self, claim: str, route: RiskRoute, context: SourceVerificationContext) -> bool: ...

    def verify_claim(self, claim_id: str, claim: str, route: RiskRoute,
                     context: SourceVerificationContext, cache_key: str) -> VerificationResult: ...
