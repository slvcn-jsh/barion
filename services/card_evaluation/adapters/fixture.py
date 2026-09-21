from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

from ..models import RiskRoute, SourceVerificationContext, VerificationResult


class FixtureAuthorityAdapter:
    id = "frozen-authority-fixtures"
    version = "1.0.0"
    authority_type = "frozen_official_source"
    authority_name = "Frozen authoritative fixture"

    def __init__(self, path: Path) -> None:
        payload = json.loads(path.read_text(encoding="utf-8"))
        self.fixture_version = str(payload["fixtureVersion"])
        self.cases = list(payload["cases"])

    def supports(self, claim: str, route: RiskRoute, context: SourceVerificationContext) -> bool:
        normalized = _normalize(claim)
        return any(_normalize(str(case["claim"])) == normalized for case in self.cases)

    def verify_claim(self, claim_id: str, claim: str, route: RiskRoute,
                     context: SourceVerificationContext, cache_key: str) -> VerificationResult:
        case = next(case for case in self.cases if _normalize(str(case["claim"])) == _normalize(claim))
        data = dict(case["result"])
        return VerificationResult(
            claimId=claim_id, claimNormalized=_normalize(claim), triggerReason=route.reason,
            riskCategory=route.category, sourceClaim=context.sourceClaim,
            sourceEvidence=context.sourceEvidence, sourceSupport=context.sourceSupport,
            cacheKey=cache_key, adapterVersion=self.version, schemaVersion="1.0.0",
            routerVersion=route.routerVersion, **data,
        )


def _normalize(value: str) -> str:
    return " ".join(value.lower().strip(" \t\r\n.,;:!?" ).split())
