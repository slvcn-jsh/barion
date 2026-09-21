from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal


@dataclass(frozen=True, slots=True)
class Page:
    locator: str
    text: str
    pageIndex: int = 0
    sourceArtifactId: str = ""
    extractionWarnings: tuple[str, ...] = ()


StructuralType = Literal[
    "PROSE", "LIST_ITEM", "TABLE_ROW", "TABLE_CELL_RELATION", "HEADING",
    "COMPARISON_MATRIX", "NUMERIC_CRITERION", "UNKNOWN",
]
Importance = Literal["critical", "high", "medium", "low"]
MedicalRisk = Literal["critical", "high", "moderate", "low", "none"]
ConceptType = Literal[
    "definition", "clinical_finding", "comparison", "mechanism", "risk_factor",
    "contraindication", "treatment", "emergency_action", "medication_rule",
    "diagnostic_criterion", "numeric_threshold", "adverse_effect", "procedure", "other",
]


@dataclass(frozen=True, slots=True)
class StructuralUnit:
    structuralUnitId: str
    sourceArtifactId: str
    pageIndex: int
    locator: str
    sectionPath: str
    startOffset: int
    endOffset: int
    rawText: str
    normalizedText: str
    structuralType: StructuralType
    contentHash: str
    extractionConfidence: float
    warnings: tuple[str, ...] = ()
    segmentId: str = ""


@dataclass(frozen=True, slots=True)
class SourceSpan:
    structuralUnitId: str
    sourceArtifactId: str
    pageIndex: int
    locator: str
    sectionPath: str
    startOffset: int
    endOffset: int
    text: str
    contentHash: str
    structuralType: StructuralType
    extractionConfidence: float
    warnings: tuple[str, ...] = ()
    segmentId: str = ""


@dataclass(frozen=True, slots=True)
class Segment:
    segmentId: str
    locator: str
    sectionPath: str
    text: str
    startOffset: int
    endOffset: int


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
class Concept:
    conceptId: str
    canonicalLabel: str
    atomicProposition: str
    sourceSpans: tuple[SourceSpan, ...]
    section: str
    aliases: tuple[str, ...]
    importance: Importance
    medicalRisk: MedicalRisk
    conceptType: ConceptType
    prerequisiteIds: tuple[str, ...]
    extractionConfidence: float
    importanceConfidence: float
    inventoryReviewStatus: Literal["deterministic", "uncertain", "reviewed"]
    inventoryVersion: str
    lineage: tuple[str, ...] = ()
    eligible: bool = True

    @property
    def locator(self) -> str:
        return self.sourceSpans[0].locator if self.sourceSpans else ""

    @property
    def segmentId(self) -> str:
        return self.sourceSpans[0].segmentId if self.sourceSpans else ""

    @property
    def text(self) -> str:
        return self.atomicProposition

    @property
    def tokens(self) -> tuple[str, ...]:
        import re
        stop = {"a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "was", "were", "with"}
        return tuple(dict.fromkeys(token.lower() for token in re.findall(r"[a-z0-9]+(?:['-][a-z0-9]+)?", self.atomicProposition, re.I)
                                   if len(token) > 2 and token.lower() not in stop))


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


def records(items: list[Any]) -> list[dict[str, Any]]:
    return [asdict(item) for item in items]
