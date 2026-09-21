from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

VerificationStatus = Literal[
    "verified", "likely_correct", "conflict", "incorrect", "outdated", "uncertain",
    "verification_not_required", "not_performed_offline", "authority_unavailable",
]


@dataclass(frozen=True, slots=True)
class RiskRoute:
    required: bool
    category: str
    riskLevel: str
    reason: str
    routerVersion: str


@dataclass(frozen=True, slots=True)
class SourceVerificationContext:
    sourceClaim: str
    sourceEvidence: str
    sourceSupport: str
    sourceFidelity: str
    authorityQuery: str = ""


@dataclass(frozen=True, slots=True)
class AuthorityEvidence:
    authorityType: str
    authorityName: str
    authorityDocumentId: str
    authorityVersion: str
    authorityDate: str
    retrievedAt: str
    evidenceText: str
    evidenceLocation: str
    evidenceUrl: str
    evidenceHash: str


@dataclass(frozen=True, slots=True)
class VerificationResult:
    claimId: str
    claimNormalized: str
    verificationStatus: VerificationStatus
    triggerReason: str
    riskCategory: str
    authorityType: str = ""
    authorityName: str = ""
    authorityDocumentId: str = ""
    authorityVersion: str = ""
    authorityDate: str = ""
    retrievedAt: str = ""
    evidenceText: str = ""
    evidenceLocation: str = ""
    evidenceUrl: str = ""
    evidenceHash: str = ""
    sourceClaim: str = ""
    sourceEvidence: str = ""
    sourceSupport: str = ""
    agreesWithSource: bool | None = None
    confidence: float | None = None
    reason: str = ""
    cacheKey: str = ""
    adapterVersion: str = ""
    schemaVersion: str = ""
    routerVersion: str = ""
    fromCache: bool = False
    cacheExpiresAt: str = ""
    diagnostic: dict[str, object] = field(default_factory=dict)
