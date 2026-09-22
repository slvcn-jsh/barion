from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

VerificationStatus = Literal[
    "verified", "likely_correct", "conflict", "incorrect", "outdated", "uncertain",
    "verification_not_required", "not_performed_offline", "authority_unavailable",
]

SourceLocation = Literal["question", "core_answer", "explanation", "study_note", "learning_objective"]
RiskLevel = Literal["critical", "high", "moderate", "low"]
SourceSupportStatus = Literal[
    "supported_by_citation", "supported_by_segment", "supported_elsewhere_in_source",
    "externally_supported_only", "unsupported", "contradicted", "uncertain",
]
SourceFidelityStatus = Literal[
    "fully_grounded", "partially_grounded", "unsupported", "contradicted_by_source",
    "source_not_found", "insufficient_evidence", "source_conflict", "uncertain",
]
CitationStatus = Literal["exact", "sufficient", "partial", "wrong_segment", "missing", "overbroad", "uncertain", "stale"]
PublicationDecision = Literal["PUBLISH", "SANITIZE", "REVIEW", "REJECT"]


@dataclass(frozen=True, slots=True)
class Card:
    cardId: str
    question: str
    answer: str
    system: str
    segmentId: str = ""
    locator: str = ""
    cardType: str = ""
    learningObjective: str = ""
    evidenceText: str = ""
    evidenceSpan: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class Segment:
    segmentId: str
    locator: str
    sectionPath: str
    text: str
    startOffset: int = 0
    endOffset: int = 0


@dataclass(frozen=True, slots=True)
class SourceReference:
    segmentId: str
    locator: str
    evidenceText: str
    startOffset: int | None = None
    endOffset: int | None = None
    spanVersion: str = ""
    offsetEncoding: str = ""
    boundaryConvention: str = ""
    evidenceTextSha256: str = ""
    sourceTextSha256: str = ""
    resolutionStatus: str = "legacy-unresolved"
    matchCount: int = 0


@dataclass(frozen=True, slots=True)
class NormalizedCard:
    cardId: str
    system: str
    question: str
    coreAnswer: str
    explanation: str
    studyNote: str
    learningObjective: str
    cardType: str
    sourceReferences: tuple[SourceReference, ...]
    rawInputHash: str
    normalizationWarnings: tuple[str, ...]
    rawQuestion: str
    rawAnswer: str


@dataclass(frozen=True, slots=True)
class NumericValue:
    value: float
    raw: str
    unit: str
    qualifier: str = ""
    endValue: float | None = None


@dataclass(frozen=True, slots=True)
class Claim:
    claimId: str
    cardId: str
    location: SourceLocation
    claimText: str
    startOffset: int
    endOffset: int
    claimType: str
    subject: str
    relation: str
    numericValues: tuple[NumericValue, ...]
    negation: bool
    riskLevel: RiskLevel
    requiresVerification: bool
    extractionAmbiguous: bool = False
    extractorVersion: str = ""
    removable: bool = False


@dataclass(frozen=True, slots=True)
class EvidenceSpan:
    segmentId: str
    locator: str
    startOffset: int
    endOffset: int
    text: str
    tier: str


@dataclass(frozen=True, slots=True)
class GroundingResult:
    claimId: str
    sourceSupport: SourceSupportStatus
    sourceFidelity: SourceFidelityStatus
    citationStatus: CitationStatus
    citationSpans: tuple[EvidenceSpan, ...] = ()
    segmentSpans: tuple[EvidenceSpan, ...] = ()
    documentSpans: tuple[EvidenceSpan, ...] = ()
    contradictionEvidence: tuple[str, ...] = ()
    confidence: float | None = None
    diagnostic: dict[str, Any] = field(default_factory=dict)
    groundingVersion: str = ""


@dataclass(frozen=True, slots=True)
class ValidationResult:
    code: str
    severity: RiskLevel
    claimId: str
    field: str
    evidence: tuple[str, ...]
    rootCauseCandidate: str
    policyConsequence: str


@dataclass(frozen=True, slots=True)
class PolicyResult:
    decision: PublicationDecision
    reasonCodes: tuple[str, ...]
    removedClaimIds: tuple[str, ...]
    retainedClaimIds: tuple[str, ...]
    policyVersion: str
    confidence: float | None = None


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
