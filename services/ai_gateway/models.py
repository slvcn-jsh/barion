from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from services.source_span import BOUNDARY_CONVENTION, OFFSET_ENCODING, SOURCE_SPAN_VERSION
from services.card_evaluation.policy import POLICY_VERSION


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SourceSegment(StrictModel):
    segmentId: str = Field(min_length=1, max_length=200)
    locator: str = Field(min_length=1, max_length=300)
    sectionPath: str = Field(max_length=500)
    text: str = Field(min_length=1, max_length=16_000)


class CardGenerationRequest(StrictModel):
    requestId: str = Field(min_length=1, max_length=200)
    promptId: Literal["grounded-card-generation"]
    promptVersion: Literal["1.0.0", "1.1.0", "1.2.0"]
    systemPrompt: str = Field(min_length=1, max_length=8_000)
    userPrompt: str = Field(min_length=1, max_length=200_000)
    minCandidates: int = Field(default=1, ge=1, le=100)
    maxCandidates: int = Field(ge=1, le=100)
    model: str = Field(min_length=1, max_length=200)

    def model_post_init(self, __context: object) -> None:
        if self.minCandidates > self.maxCandidates:
            raise ValueError("minCandidates must not exceed maxCandidates.")


class EvidenceSpan(StrictModel):
    version: Literal[SOURCE_SPAN_VERSION] = SOURCE_SPAN_VERSION
    offsetEncoding: Literal[OFFSET_ENCODING] = OFFSET_ENCODING
    boundaryConvention: Literal[BOUNDARY_CONVENTION] = BOUNDARY_CONVENTION
    status: Literal["exact", "normalized", "context-disambiguated", "ambiguous", "not-found", "invalid", "stale-source"]
    startOffset: int | None = Field(default=None, ge=0)
    endOffset: int | None = Field(default=None, ge=0)
    evidenceTextSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    sourceTextSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    matchCount: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_boundaries(self) -> "EvidenceSpan":
        resolved = self.status in {"exact", "normalized", "context-disambiguated"}
        if resolved != (self.startOffset is not None and self.endOffset is not None):
            raise ValueError("Resolved evidence spans require both offsets; unresolved spans require neither.")
        if self.startOffset is not None and self.endOffset is not None and self.endOffset < self.startOffset:
            raise ValueError("endOffset must not precede startOffset.")
        return self


class CandidateEvaluation(StrictModel):
    contractVersion: Literal["1.0.0"] = "1.0.0"
    evaluationVersion: Literal["1.0.0"] = "1.0.0"
    policyVersion: Literal[POLICY_VERSION] = POLICY_VERSION
    evidenceSpanVerified: bool
    sourceClaimSupported: Literal["not_evaluated", "supported", "unsupported", "contradicted", "uncertain"]
    citationStatus: Literal["exact", "sufficient", "partial", "wrong_segment", "missing", "overbroad", "uncertain", "stale"]
    medicalRisk: Literal["critical", "high", "moderate", "low", "none"]
    medicalVerificationStatus: Literal["verified", "likely_correct", "conflict", "incorrect", "outdated", "uncertain", "verification_not_required", "not_performed_offline", "authority_unavailable"]
    publicationDisposition: Literal["PUBLISH", "SANITIZE", "REVIEW", "REJECT"]
    reasonCodes: list[str]


class GeneratedCard(StrictModel):
    segmentId: str = Field(min_length=1, max_length=200)
    cardType: str = Field(min_length=1, max_length=80)
    learningObjective: str = Field(min_length=3, max_length=300)
    question: str = Field(min_length=3, max_length=500)
    answer: str = Field(min_length=1, max_length=2_000)
    evidenceText: str = Field(min_length=1, max_length=4_000)
    evidenceSpan: EvidenceSpan | None = None
    evaluation: CandidateEvaluation | None = None


class GeneratedCardOutput(StrictModel):
    candidates: list[GeneratedCard]


class ProviderUsage(StrictModel):
    inputTokens: int | None = Field(default=None, ge=0)
    outputTokens: int | None = Field(default=None, ge=0)


class CardGenerationResponse(StrictModel):
    requestId: str
    provider: str
    model: str
    output: GeneratedCardOutput
    usage: ProviderUsage | None = None


class BariChatRequest(StrictModel):
    conversationId: str | None = Field(default=None, max_length=200)
    message: str = Field(min_length=1, max_length=8_000)
    mode: Literal["source-strict", "explain"] = "source-strict"
    sourceScope: dict[str, object] = Field(default_factory=dict)
    courseId: str | None = Field(default=None, max_length=200)
    deckId: str | None = Field(default=None, max_length=200)
    documentIds: list[str] = Field(default_factory=list, max_length=100)
    evidence: list[SourceSegment] = Field(default_factory=list, max_length=20)


class BariGeneration(StrictModel):
    provider: str | None = None
    model: str | None = None
    requestId: str


class BariChatResponse(StrictModel):
    message: str
    citations: list[dict[str, object]] = Field(default_factory=list)
    evidence: list[SourceSegment] = Field(default_factory=list)
    actions: list[dict[str, object]] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    generation: BariGeneration
