from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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
    promptVersion: Literal["1.0.0"]
    systemPrompt: str = Field(min_length=1, max_length=8_000)
    userPrompt: str = Field(min_length=1, max_length=200_000)
    maxCandidates: int = Field(ge=1, le=100)
    model: str = Field(min_length=1, max_length=200)


class GeneratedCard(StrictModel):
    segmentId: str = Field(min_length=1, max_length=200)
    cardType: str = Field(min_length=1, max_length=80)
    learningObjective: str = Field(min_length=3, max_length=300)
    question: str = Field(min_length=3, max_length=500)
    answer: str = Field(min_length=1, max_length=2_000)
    evidenceText: str = Field(min_length=1, max_length=4_000)


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
