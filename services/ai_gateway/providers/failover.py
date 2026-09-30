from __future__ import annotations

import logging
from dataclasses import replace
from typing import Sequence

from ..errors import GatewayError
from ..models import BariChatRequest, CardGenerationRequest
from .base import BariChatResult, GenerationProvider, ProviderResult

logger = logging.getLogger(__name__)

RECOVERABLE_ERROR_CODES = {
    "provider_unavailable",
    "provider_timeout",
    "provider_rate_limited",
    "internal_error",
}


class FailoverGenerationProvider:
    """
    Composes multiple providers in priority order.
    If the primary provider hits a recoverable error (e.g. 429 quota exhaustion,
    503 model demand spike, or network timeout), execution seamlessly cascades
    to the next provider.
    """

    def __init__(self, providers: Sequence[GenerationProvider]) -> None:
        if not providers:
            raise ValueError("FailoverGenerationProvider requires at least one provider.")
        self.providers = list(providers)
        self.primary = self.providers[0]
        self.id = self.primary.id
        self.model = self.primary.model

    async def generate_cards(self, request: CardGenerationRequest) -> ProviderResult:
        last_error: Exception | None = None
        attempted_models: list[str] = []
        for index, provider in enumerate(self.providers):
            attempted_models.append(provider.model)
            try:
                result = await provider.generate_cards(request)
                return replace(
                    result,
                    provider_id=result.provider_id or provider.id,
                    model_id=result.model_id or provider.model,
                    diagnostics=_success_failover_diagnostics(
                        result.diagnostics,
                        attempted_models,
                        index,
                        last_error,
                    ),
                )
            except Exception as error:
                last_error = error
                _attach_failover_diagnostics(error, provider.model, attempted_models)
                is_recoverable = (
                    isinstance(error, GatewayError) and error.code in RECOVERABLE_ERROR_CODES
                ) or not isinstance(error, GatewayError)
                if not is_recoverable or index == len(self.providers) - 1:
                    raise
                logger.warning(
                    "Provider %s (%s) failed with %s. Failing over to %s.",
                    provider.id,
                    provider.model,
                    getattr(error, "code", type(error).__name__),
                    self.providers[index + 1].id,
                )
        if last_error:
            raise last_error
        raise RuntimeError("No provider succeeded.")

    async def bari_chat(
        self,
        request: BariChatRequest,
        conversation_history: list[dict[str, str]],
    ) -> BariChatResult:
        last_error: Exception | None = None
        attempted_models: list[str] = []
        for index, provider in enumerate(self.providers):
            attempted_models.append(provider.model)
            try:
                result = await provider.bari_chat(request, conversation_history)
                return replace(
                    result,
                    provider_id=result.provider_id or provider.id,
                    model_id=result.model_id or provider.model,
                    diagnostics=_success_failover_diagnostics(
                        result.diagnostics,
                        attempted_models,
                        index,
                        last_error,
                    ),
                )
            except Exception as error:
                last_error = error
                _attach_failover_diagnostics(error, provider.model, attempted_models)
                is_recoverable = (
                    isinstance(error, GatewayError) and error.code in RECOVERABLE_ERROR_CODES
                ) or not isinstance(error, GatewayError)
                if not is_recoverable or index == len(self.providers) - 1:
                    raise
                logger.warning(
                    "Provider %s (%s) failed with %s. Failing over to %s.",
                    provider.id,
                    provider.model,
                    getattr(error, "code", type(error).__name__),
                    self.providers[index + 1].id,
                )
        if last_error:
            raise last_error
        raise RuntimeError("No provider succeeded.")

    async def close(self) -> None:
        for provider in self.providers:
            if hasattr(provider, "close"):
                await provider.close()


def _attach_failover_diagnostics(
    error: Exception,
    failed_model: str,
    attempted_models: list[str],
) -> None:
    if not isinstance(error, GatewayError):
        return
    error.diagnostics = {
        **(error.diagnostics or {}),
        "failedModel": failed_model,
        "attemptedModels": list(attempted_models),
    }


def _success_failover_diagnostics(
    diagnostics: dict[str, object] | None,
    attempted_models: list[str],
    provider_index: int,
    previous_error: Exception | None,
) -> dict[str, object]:
    return {
        **(diagnostics or {}),
        "attemptedModels": list(attempted_models),
        "fallbackUsed": provider_index > 0,
        **(
            {"fallbackReason": getattr(previous_error, "code", type(previous_error).__name__)}
            if provider_index > 0 and previous_error is not None
            else {}
        ),
    }
