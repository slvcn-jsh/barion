from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from ..models import BariChatRequest, CardGenerationRequest, GeneratedCardOutput, ProviderUsage


@dataclass(frozen=True, slots=True)
class ProviderResult:
    request_id: str
    output: GeneratedCardOutput
    usage: ProviderUsage | None
    provider_id: str | None = None
    model_id: str | None = None
    diagnostics: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class BariChatResult:
    request_id: str
    message: str
    usage: ProviderUsage | None
    provider_id: str | None = None
    model_id: str | None = None
    diagnostics: dict[str, Any] | None = None


class GenerationProvider(Protocol):
    id: str
    model: str

    async def generate_cards(self, request: CardGenerationRequest) -> ProviderResult: ...
    async def bari_chat(self, request: BariChatRequest, conversation_history: list[dict[str, str]]) -> BariChatResult: ...
