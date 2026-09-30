from __future__ import annotations

import asyncio
from time import monotonic

from services.card_evaluation.verification import VerificationCoordinator

from .errors import GatewayError
from .models import BariChatRequest, BariChatResponse, BariGeneration, CardGenerationRequest, CardGenerationResponse
from .policies import (
    BARI_CHAT_POLICY,
    CARD_GENERATION_POLICY,
    EffectiveTaskPolicy,
    logical_model_id,
    resolve_task_policy,
)
from .providers.base import GenerationProvider, ProviderResult
from .retrieval import HybridRetriever, NoOpRetriever, SourceRetriever
from .telemetry import TelemetryEvent, record
from .validation import validate_grounded_output

DEFAULT_REQUEST_BUDGET_SECONDS = 25.0


class GenerationOrchestrator:
    def __init__(
        self,
        provider: GenerationProvider,
        chat_provider: GenerationProvider | None = None,
        retriever: SourceRetriever | None = None,
        verifier: VerificationCoordinator | None = None,
        request_budget_seconds: float = DEFAULT_REQUEST_BUDGET_SECONDS,
        card_policy: EffectiveTaskPolicy | None = None,
        chat_policy: EffectiveTaskPolicy | None = None,
    ) -> None:
        self.provider = provider
        self.chat_provider = chat_provider or provider
        self.card_policy = card_policy or _provider_policy(CARD_GENERATION_POLICY, provider)
        self.chat_policy = chat_policy or _provider_policy(BARI_CHAT_POLICY, self.chat_provider)
        self.retriever = retriever or NoOpRetriever()
        self.verifier = verifier or VerificationCoordinator()
        self.request_budget_seconds = request_budget_seconds
        self._conversations: dict[tuple[str, str], list[dict[str, str]]] = {}

    async def generate_cards(self, request: CardGenerationRequest) -> CardGenerationResponse:
        started = monotonic()
        try:
            result = await self.provider.generate_cards(request)
            provider_id = result.provider_id or self.provider.id
            model_id = result.model_id or self.provider.model
            try:
                output = await asyncio.to_thread(
                    validate_grounded_output,
                    request,
                    result.output,
                    self.verifier,
                    verification_deadline=started + self.request_budget_seconds,
                )
            except GatewayError as error:
                _attach_result_diagnostics(error, result, model_id)
                raise
            record(TelemetryEvent(
                requestId=request.requestId,
                operation="card-generation",
                provider=provider_id,
                model=model_id,
                latencyMs=round((monotonic() - started) * 1_000),
                success=True,
                inputTokens=result.usage.inputTokens if result.usage else None,
                outputTokens=result.usage.outputTokens if result.usage else None,
                candidateCount=len(output.candidates),
                policyId=self.card_policy.policy_id,
                logicalModelId=logical_model_id(provider_id, model_id),
                promptVersion=request.promptVersion,
                schemaVersion=self.card_policy.schema_version,
                policyConfiguration=_policy_configuration(self.card_policy),
                diagnostics=result.diagnostics,
            ))
            return CardGenerationResponse(
                requestId=result.request_id,
                provider=provider_id,
                model=model_id,
                output=output,
                usage=result.usage,
            )
        except Exception as error:
            diagnostics = error.diagnostics if isinstance(error, GatewayError) and error.diagnostics else None
            record(TelemetryEvent(
                requestId=request.requestId,
                operation="card-generation",
                provider=self.provider.id,
                model=_error_model(error, self.provider.model),
                latencyMs=round((monotonic() - started) * 1_000),
                success=False,
                policyId=self.card_policy.policy_id,
                logicalModelId=logical_model_id(self.provider.id, _error_model(error, self.provider.model)),
                promptVersion=request.promptVersion,
                schemaVersion=self.card_policy.schema_version,
                policyConfiguration=_policy_configuration(self.card_policy),
                errorCategory=getattr(error, "code", "internal_error"),
                diagnostics=diagnostics,
            ))
            raise
    async def bari_chat(self, request: BariChatRequest, identity_subject: str) -> BariChatResponse:
        started = monotonic()

        # Get or initialize conversation history
        conversation_id = request.conversationId or ""
        conversation_key = (identity_subject, conversation_id)

        # Prefer client-supplied history (canonical from local SQLite)
        if request.history:
            history = [{"role": "user" if m.role == "user" else "model", "content": m.text} for m in request.history]
        else:
            history = list(self._conversations.get(conversation_key, []))

        # Limit history to last 10 exchanges (20 messages) to manage context window
        if len(history) > 20:
            history = history[-20:]

        # Auto-retrieve evidence if not provided and retrieval is enabled
        evidence = request.evidence
        if not evidence:
            evidence = await self.retriever.retrieve_evidence(request, max_segments=5)
        elif len(evidence) > 5:
            embedding_provider = getattr(self.retriever, "embedding_provider", None)
            hybrid = HybridRetriever(embedding_provider=embedding_provider)
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
            history=request.history,
        )

        try:
            result = await self.chat_provider.bari_chat(enriched_request, history)
            provider_id = result.provider_id or self.chat_provider.id
            model_id = result.model_id or self.chat_provider.model

            # Update conversation history
            if conversation_id:
                cached_history = list(history)
                cached_history.append({"role": "user", "content": request.message})
                cached_history.append({"role": "model", "content": result.message})
                if len(cached_history) > 20:
                    cached_history = cached_history[-20:]
                self._conversations[conversation_key] = cached_history

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
                provider=provider_id,
                model=model_id,
                latencyMs=round((monotonic() - started) * 1_000),
                success=True,
                inputTokens=result.usage.inputTokens if result.usage else None,
                outputTokens=result.usage.outputTokens if result.usage else None,
                policyId=self.chat_policy.policy_id,
                logicalModelId=logical_model_id(provider_id, model_id),
                promptVersion=self.chat_policy.prompt_version,
                schemaVersion=self.chat_policy.schema_version,
                policyConfiguration=_policy_configuration(self.chat_policy),
                diagnostics=result.diagnostics,
            ))

            return BariChatResponse(
                message=result.message,
                citations=citations,
                evidence=evidence,
                generation=BariGeneration(
                    provider=provider_id,
                    model=model_id,
                    requestId=result.request_id,
                ),
            )
        except Exception as error:
            diagnostics = error.diagnostics if isinstance(error, GatewayError) and error.diagnostics else None
            record(TelemetryEvent(
                requestId=conversation_id or "unknown",
                operation="bari-chat",
                provider=self.chat_provider.id,
                model=_error_model(error, self.chat_provider.model),
                latencyMs=round((monotonic() - started) * 1_000),
                success=False,
                policyId=self.chat_policy.policy_id,
                logicalModelId=logical_model_id(
                    self.chat_provider.id,
                    _error_model(error, self.chat_provider.model),
                ),
                promptVersion=self.chat_policy.prompt_version,
                schemaVersion=self.chat_policy.schema_version,
                policyConfiguration=_policy_configuration(self.chat_policy),
                errorCategory=getattr(error, "code", "internal_error"),
                diagnostics=diagnostics,
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


def _error_model(error: Exception, default: str) -> str:
    if isinstance(error, GatewayError) and isinstance(error.diagnostics, dict):
        failed_model = error.diagnostics.get("failedModel")
        if isinstance(failed_model, str) and failed_model:
            return failed_model
    return default


def _provider_policy(policy, provider: GenerationProvider) -> EffectiveTaskPolicy:
    return resolve_task_policy(
        policy,
        provider=provider.id,
        model_id=provider.model,
        fallback_model_id=None,
    )


def _policy_configuration(policy: EffectiveTaskPolicy) -> dict[str, object]:
    return {
        "temperature": policy.temperature,
        "thinking": policy.thinking,
        "timeoutSeconds": policy.timeout_seconds,
        "maxAttempts": policy.max_attempts,
        "retryBaseDelaySeconds": policy.retry_base_delay_seconds,
        "retryMaxDelaySeconds": policy.retry_max_delay_seconds,
        "fallbackLogicalModelId": policy.fallback_logical_model_id,
    }
