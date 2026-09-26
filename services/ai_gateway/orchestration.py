from __future__ import annotations

import asyncio
from time import monotonic

from services.card_evaluation.verification import VerificationCoordinator

from .errors import GatewayError
from .models import BariChatRequest, BariChatResponse, BariGeneration, CardGenerationRequest, CardGenerationResponse
from .providers.base import GenerationProvider, ProviderResult
from .retrieval import HybridRetriever, NoOpRetriever, SourceRetriever
from .telemetry import TelemetryEvent, record
from .validation import validate_grounded_output

DEFAULT_REQUEST_BUDGET_SECONDS = 25.0


class GenerationOrchestrator:
    def __init__(
        self,
        provider: GenerationProvider,
        retriever: SourceRetriever | None = None,
        verifier: VerificationCoordinator | None = None,
        request_budget_seconds: float = DEFAULT_REQUEST_BUDGET_SECONDS,
    ) -> None:
        self.provider = provider
        self.retriever = retriever or NoOpRetriever()
        self.verifier = verifier or VerificationCoordinator()
        self.request_budget_seconds = request_budget_seconds
        self._conversations: dict[tuple[str, str], list[dict[str, str]]] = {}

    async def generate_cards(self, request: CardGenerationRequest) -> CardGenerationResponse:
        started = monotonic()
        try:
            result = await self.provider.generate_cards(request)
            try:
                output = await asyncio.to_thread(
                    validate_grounded_output,
                    request,
                    result.output,
                    self.verifier,
                    verification_deadline=started + self.request_budget_seconds,
                )
            except GatewayError as error:
                _attach_result_diagnostics(error, result, self.provider.model)
                raise
            if len(output.candidates) < request.minCandidates:
                raise GatewayError(
                    "insufficient_candidates",
                    "Generation provider returned fewer supported cards than required.",
                    502,
                    True,
                    self.provider.id,
                    {
                        **_result_diagnostics(result, self.provider.model),
                        "validatedCandidateCount": len(output.candidates),
                        "minCandidates": request.minCandidates,
                    },
                )
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
            diagnostics = error.diagnostics if isinstance(error, GatewayError) and error.diagnostics else None
            record(TelemetryEvent(
                requestId=request.requestId,
                operation="card-generation",
                provider=self.provider.id,
                model=self.provider.model,
                latencyMs=round((monotonic() - started) * 1_000),
                success=False,
                errorCategory=getattr(error, "code", "internal_error"),
                diagnostics=diagnostics,
            ))
            raise
    async def bari_chat(self, request: BariChatRequest, identity_subject: str) -> BariChatResponse:
        started = monotonic()

        # Get or initialize conversation history
        conversation_id = request.conversationId or ""
        conversation_key = (identity_subject, conversation_id)
        history = self._conversations.get(conversation_key, [])

        # Limit history to last 10 exchanges (20 messages) to manage context window
        if len(history) > 20:
            history = history[-20:]

        # Auto-retrieve evidence if not provided and retrieval is enabled
        evidence = request.evidence
        if not evidence:
            evidence = await self.retriever.retrieve_evidence(request, max_segments=5)
        elif len(evidence) > 5:
            hybrid = HybridRetriever()
            await hybrid.index_segments(evidence)
            top_evidence = await hybrid.retrieve_evidence(request, max_segments=5)
            if top_evidence:
                evidence = top_evidence

        # Create enriched request with retrieved evidence
        enriched_request = BariChatRequest(
            conversationId=request.conversationId,
            message=request.message,
            mode=request.mode,
            sourceScope=request.sourceScope,
            courseId=request.courseId,
            deckId=request.deckId,
            documentIds=request.documentIds,
            evidence=evidence,
        )

        try:
            result = await self.provider.bari_chat(enriched_request, history)

            # Update conversation history
            if conversation_id:
                history.append({"role": "user", "content": request.message})
                history.append({"role": "model", "content": result.message})
                self._conversations[conversation_key] = history

            # Extract citations from response if evidence was provided
            citations = []
            if evidence:
                for idx, segment in enumerate(evidence, 1):
                    msg_lower = result.message.lower()
                    if (
                        segment.locator.lower() in msg_lower
                        or f"[source {idx}]" in msg_lower
                        or f"(source {idx})" in msg_lower
                        or f"source {idx}" in msg_lower
                        or len(evidence) == 1
                    ):
                        citations.append({
                            "segmentId": segment.segmentId,
                            "locator": segment.locator,
                            "sectionPath": segment.sectionPath,
                        })

            record(TelemetryEvent(
                requestId=result.request_id,
                operation="bari-chat",
                provider=self.provider.id,
                model=self.provider.model,
                latencyMs=round((monotonic() - started) * 1_000),
                success=True,
                inputTokens=result.usage.inputTokens if result.usage else None,
                outputTokens=result.usage.outputTokens if result.usage else None,
            ))

            return BariChatResponse(
                message=result.message,
                citations=citations,
                evidence=evidence,
                generation=BariGeneration(
                    provider=self.provider.id,
                    model=self.provider.model,
                    requestId=result.request_id,
                ),
            )
        except Exception as error:
            record(TelemetryEvent(
                requestId=conversation_id or "unknown",
                operation="bari-chat",
                provider=self.provider.id,
                model=self.provider.model,
                latencyMs=round((monotonic() - started) * 1_000),
                success=False,
                errorCategory=getattr(error, "code", "internal_error"),
            ))
            raise


def _result_diagnostics(result: ProviderResult, model: str) -> dict[str, object]:
    return {
        "providerRequestId": result.request_id,
        "model": model,
        "inputTokens": result.usage.inputTokens if result.usage else None,
        "outputTokens": result.usage.outputTokens if result.usage else None,
        "remoteCandidateCount": len(result.output.candidates),
    }


def _attach_result_diagnostics(error: GatewayError, result: ProviderResult, model: str) -> None:
    error.diagnostics = {**_result_diagnostics(result, model), **error.diagnostics}
