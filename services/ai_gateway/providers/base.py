from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..models import CardGenerationRequest, GeneratedCardOutput, ProviderUsage


@dataclass(frozen=True, slots=True)
class ProviderResult:
    request_id: str
    output: GeneratedCardOutput
    usage: ProviderUsage | None


class GenerationProvider(Protocol):
    id: str
    model: str

    async def generate_cards(self, request: CardGenerationRequest) -> ProviderResult: ...
