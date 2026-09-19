from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import ValidationError

from ..errors import GatewayError
from ..models import CardGenerationRequest, GeneratedCardOutput, ProviderUsage
from ..prompts import CARD_GENERATION_SYSTEM_PROMPT
from .base import ProviderResult

_CARD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["candidates"],
    "properties": {
        "candidates": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "segmentId",
                    "cardType",
                    "learningObjective",
                    "question",
                    "answer",
                    "evidenceText",
                ],
                "properties": {
                    "segmentId": {"type": "string"},
                    "cardType": {"type": "string"},
                    "learningObjective": {"type": "string"},
                    "question": {"type": "string"},
                    "answer": {"type": "string"},
                    "evidenceText": {"type": "string"},
                },
            },
        }
    },
}


class GeminiGenerationProvider:
    id = "gemini"

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        self.model = model
        self._api_key = api_key
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def generate_cards(self, request: CardGenerationRequest) -> ProviderResult:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{quote(self.model, safe='')}:generateContent"
        )
        try:
            response = await self._client.post(
                url,
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": self._api_key,
                },
                json={
                    "systemInstruction": {"parts": [{"text": CARD_GENERATION_SYSTEM_PROMPT}]},
                    "contents": [{"role": "user", "parts": [{"text": request.userPrompt}]}],
                    "generationConfig": {
                        "temperature": 0.2,
                        "maxOutputTokens": min(16_384, 768 + request.maxCandidates * 320),
                        "responseMimeType": "application/json",
                        "responseJsonSchema": _schema_for_limit(request.maxCandidates),
                    },
                },
            )
        except httpx.TimeoutException as error:
            raise GatewayError("provider_timeout", "Generation provider timed out.", 504, True, self.id) from error
        except httpx.HTTPError as error:
            raise GatewayError("provider_unavailable", "Generation provider is unavailable.", 503, True, self.id) from error

        if not response.is_success:
            raise _provider_http_error(response.status_code)

        try:
            payload = response.json()
            text = _response_text(payload)
            output = GeneratedCardOutput.model_validate(json.loads(text))
        except (ValueError, KeyError, TypeError, ValidationError) as error:
            raise GatewayError(
                "invalid_provider_response",
                "Generation provider returned invalid structured output.",
                502,
                True,
                self.id,
            ) from error

        usage = payload.get("usageMetadata") or {}
        return ProviderResult(
            request_id=response.headers.get("x-request-id") or request.requestId,
            output=output,
            usage=ProviderUsage(
                inputTokens=_non_negative_int(usage.get("promptTokenCount")),
                outputTokens=_non_negative_int(usage.get("candidatesTokenCount")),
            ),
        )


def _schema_for_limit(max_candidates: int) -> dict[str, Any]:
    schema = json.loads(json.dumps(_CARD_SCHEMA))
    schema["properties"]["candidates"]["maxItems"] = max_candidates
    return schema


def _response_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise KeyError("candidates")
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise KeyError("text")
    return text


def _provider_http_error(status: int) -> GatewayError:
    if status in (401, 403):
        return GatewayError("provider_authentication_error", "Generation provider authentication failed.", 502, False, "gemini")
    if status == 429:
        return GatewayError("provider_rate_limited", "Generation provider rate limit reached.", 429, True, "gemini")
    if status >= 500:
        return GatewayError("provider_unavailable", "Generation provider is unavailable.", 503, True, "gemini")
    return GatewayError("provider_rejected_request", "Generation provider rejected the request.", 502, False, "gemini")


def _non_negative_int(value: object) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None
