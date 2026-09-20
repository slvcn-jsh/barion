from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..models import BariChatRequest, CardGenerationRequest, GeneratedCardOutput, ProviderUsage


@dataclass(frozen=True, slots=True)
class ProviderResult:
    request_id: str
    output: GeneratedCardOutput
    usage: ProviderUsage | None


@dataclass(frozen=True, slots=True)
class BariChatResult:
    request_id: str
    message: str
    usage: ProviderUsage | None


class GenerationProvider(Protocol):
    id: str
    model: str

    async def generate_cards(self, request: CardGenerationRequest) -> ProviderResult: ...
    async def bari_chat(self, request: BariChatRequest, conversation_history: list[dict[str, str]]) -> BariChatResult: ...
