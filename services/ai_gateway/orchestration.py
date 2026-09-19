from __future__ import annotations

from time import monotonic

from .models import CardGenerationRequest, CardGenerationResponse
from .providers.base import GenerationProvider
from .telemetry import TelemetryEvent, record
from .validation import validate_grounded_output


class GenerationOrchestrator:
    def __init__(self, provider: GenerationProvider) -> None:
        self.provider = provider

    async def generate_cards(self, request: CardGenerationRequest) -> CardGenerationResponse:
        started = monotonic()
        try:
            result = await self.provider.generate_cards(request)
            output = validate_grounded_output(request, result.output)
            record(TelemetryEvent(
                requestId=request.requestId,
                operation="card-generation",
                provider=self.provider.id,
                model=self.provider.model,
                latencyMs=round((monotonic() - started) * 1_000),
                success=True,
                inputTokens=result.usage.inputTokens if result.usage else None,
                outputTokens=result.usage.outputTokens if result.usage else None,
                candidateCount=len(output.candidates),
            ))
            return CardGenerationResponse(
                requestId=result.request_id,
                provider=self.provider.id,
                model=self.provider.model,
                output=output,
                usage=result.usage,
            )
        except Exception as error:
            record(TelemetryEvent(
                requestId=request.requestId,
                operation="card-generation",
                provider=self.provider.id,
                model=self.provider.model,
                latencyMs=round((monotonic() - started) * 1_000),
                success=False,
                errorCategory=getattr(error, "code", "internal_error"),
            ))
            raise
