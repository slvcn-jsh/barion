from __future__ import annotations

import hashlib
import re
from dataclasses import replace
from typing import Iterable

from .adapters.base import AuthorityAdapter
from .cache import CACHE_VERSION, VerificationCache
from .models import SourceVerificationContext, VerificationResult
from .risk import RISK_ROUTER_VERSION, route_claim

VERIFICATION_SCHEMA_VERSION = "1.0.0"
AUTHORITY_QUERY_VERSION = "1.0.0"


class VerificationCoordinator:
    def __init__(self, adapters: Iterable[AuthorityAdapter] = (), cache: VerificationCache | None = None,
                 *, offline: bool = False) -> None:
        self.adapters = tuple(adapters)
        self.cache = cache or VerificationCache()
        self.offline = offline

    def verify(self, claim, context: SourceVerificationContext) -> VerificationResult:
        route = route_claim(claim)
        normalized = _normalize(claim.claimText)
        if not route.required:
            return VerificationResult(
                claimId=claim.claimId, claimNormalized=normalized,
                verificationStatus="verification_not_required", triggerReason=route.reason,
                riskCategory=route.category, sourceClaim=context.sourceClaim,
                sourceEvidence=context.sourceEvidence, sourceSupport=context.sourceSupport,
                agreesWithSource=None, reason="Selective routing did not require external verification.",
                schemaVersion=VERIFICATION_SCHEMA_VERSION, routerVersion=RISK_ROUTER_VERSION,
            )
        adapter = next((item for item in self.adapters if item.supports(claim.claimText, route, context)), None)
        adapter_id = adapter.id if adapter else "unrouted"
        adapter_version = adapter.version if adapter else "none"
        key = _cache_key(normalized, route.category, adapter_id, adapter_version)
        cached = self.cache.get(key)
        if cached:
            return cached
        if self.offline:
            return _held(claim.claimId, normalized, route, context, key, adapter_version, "not_performed_offline",
                         "Offline and no valid cached authority result exists.")
        if adapter is None:
            return _held(claim.claimId, normalized, route, context, key, adapter_version, "authority_unavailable",
                         "No authoritative adapter supports this minimized claim context.")
        result = adapter.verify_claim(claim.claimId, claim.claimText, route, context, key)
        result = replace(result, schemaVersion=VERIFICATION_SCHEMA_VERSION)
        if result.verificationStatus not in {"authority_unavailable", "not_performed_offline"}:
            self.cache.put(result)
        return result


def _held(claim_id, normalized, route, context, key, adapter_version, status, reason):
    return VerificationResult(
        claimId=claim_id, claimNormalized=normalized, verificationStatus=status,
        triggerReason=route.reason, riskCategory=route.category, sourceClaim=context.sourceClaim,
        sourceEvidence=context.sourceEvidence, sourceSupport=context.sourceSupport,
        agreesWithSource=None, reason=reason, cacheKey=key, adapterVersion=adapter_version,
        schemaVersion=VERIFICATION_SCHEMA_VERSION, routerVersion=RISK_ROUTER_VERSION,
    )


def _cache_key(normalized: str, category: str, adapter_id: str, adapter_version: str) -> str:
    value = "\0".join((normalized, category, adapter_id, adapter_version, AUTHORITY_QUERY_VERSION,
                       VERIFICATION_SCHEMA_VERSION, CACHE_VERSION))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _normalize(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9.%/]+", value.lower()))
