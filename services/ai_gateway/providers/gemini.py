from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import random
import re
from time import monotonic
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import ValidationError

from ..errors import GatewayError
from ..models import BariChatRequest, CardGenerationRequest, GeneratedCardOutput, ProviderUsage
from ..prompts import BARI_CHAT_SYSTEM_PROMPT, CARD_GENERATION_SYSTEM_PROMPT
from .base import BariChatResult, ProviderResult

CARD_GENERATION_MAX_OUTPUT_TOKENS = 32_768
CARD_GENERATION_THINKING_LEVEL = "low"
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_RETRY_BASE_DELAY_SECONDS = 1.0
DEFAULT_RETRY_MAX_DELAY_SECONDS = 16.0
_RETRYABLE_STATUS_CODES = frozenset({429, 500, 502, 503, 504})


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


def _card_schema(_request: CardGenerationRequest) -> dict[str, Any]:
    # Gemini rejects large minItems/maxItems constraints for this nested response.
    # Quantity remains explicit in the prompt and is enforced after generation.
    return _CARD_SCHEMA


class GeminiGenerationProvider:
    id = "gemini"

    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: float,
        client: httpx.AsyncClient | None = None,
        *,
        max_attempts: int = DEFAULT_MAX_ATTEMPTS,
        retry_base_delay_seconds: float = DEFAULT_RETRY_BASE_DELAY_SECONDS,
        retry_max_delay_seconds: float = DEFAULT_RETRY_MAX_DELAY_SECONDS,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        random_value: Callable[[], float] = random.random,
    ) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be positive.")
        if retry_base_delay_seconds < 0 or retry_max_delay_seconds < 0:
            raise ValueError("Retry delays must be non-negative.")
        if retry_base_delay_seconds > retry_max_delay_seconds:
            raise ValueError("retry_base_delay_seconds must not exceed retry_max_delay_seconds.")
        self.model = model
        self._api_key = api_key
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=timeout_seconds)
        self._max_attempts = max_attempts
        self._retry_base_delay_seconds = retry_base_delay_seconds
        self._retry_max_delay_seconds = retry_max_delay_seconds
        self._sleep = sleep
        self._random_value = random_value

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _post_with_retry(
        self,
        url: str,
        body: dict[str, Any],
        started: float,
        timeout_message: str,
        unavailable_message: str,
    ) -> tuple[httpx.Response, int, list[dict[str, Any]]]:
        retry_history: list[dict[str, Any]] = []
        for attempt in range(1, self._max_attempts + 1):
            try:
                response = await self._client.post(
                    url,
                    headers={
                        "Content-Type": "application/json",
                        "x-goog-api-key": self._api_key,
                    },
                    json=body,
                )
            except httpx.TimeoutException as error:
                if attempt < self._max_attempts:
                    delay = self._retry_delay(attempt)
                    retry_history.append(_transport_retry_record(error, attempt, delay))
                    await self._sleep(delay)
                    continue
                diagnostics = _transport_diagnostics(error, started, attempt)
                _add_retry_diagnostics(diagnostics, self._max_attempts, retry_history, True)
                raise GatewayError(
                    "provider_timeout", timeout_message, 504, True, self.id, diagnostics,
                ) from error
            except httpx.TransportError as error:
                if attempt < self._max_attempts:
                    delay = self._retry_delay(attempt)
                    retry_history.append(_transport_retry_record(error, attempt, delay))
                    await self._sleep(delay)
                    continue
                diagnostics = _transport_diagnostics(error, started, attempt)
                _add_retry_diagnostics(diagnostics, self._max_attempts, retry_history, True)
                raise GatewayError(
                    "provider_unavailable", unavailable_message, 503, True, self.id, diagnostics,
                ) from error

            if response.status_code in _RETRYABLE_STATUS_CODES and attempt < self._max_attempts:
                delay = self._retry_delay(attempt, response)
                retry_history.append(_response_retry_record(response, attempt, delay))
                await self._sleep(delay)
                continue
            return response, attempt, retry_history

        raise AssertionError("Retry loop exited without response or error.")

    def _retry_delay(self, attempt: int, response: httpx.Response | None = None) -> float:
        server_delay = _server_retry_delay(response) if response is not None else None
        if server_delay is not None:
            return min(server_delay, self._retry_max_delay_seconds)
        ceiling = min(
            self._retry_max_delay_seconds,
            self._retry_base_delay_seconds * (2 ** (attempt - 1)),
        )
        return ceiling * self._random_value()

    async def generate_cards(self, request: CardGenerationRequest) -> ProviderResult:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{quote(self.model, safe='')}:generateContent"
        )
        started = monotonic()
        response, attempt, retry_history = await self._post_with_retry(
            url,
            {
                "systemInstruction": {"parts": [{"text": CARD_GENERATION_SYSTEM_PROMPT}]},
                "contents": [{"role": "user", "parts": [{"text": request.userPrompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": CARD_GENERATION_MAX_OUTPUT_TOKENS,
                    "thinkingConfig": {"thinkingLevel": CARD_GENERATION_THINKING_LEVEL},
                    "responseMimeType": "application/json",
                    "responseJsonSchema": _card_schema(request),
                },
            },
            started,
            "Generation provider timed out.",
            "Generation provider is unavailable.",
        )

        if not response.is_success:
            error = _provider_http_error(response, started, attempt)
            _add_retry_diagnostics(
                error.diagnostics,
                self._max_attempts,
                retry_history,
                response.status_code in _RETRYABLE_STATUS_CODES,
            )
            raise error

        payload: dict[str, Any] = {}
        raw_output: object = None
        try:
            decoded_payload = response.json()
            if not isinstance(decoded_payload, dict):
                raise TypeError("Provider payload must be an object.")
            payload = decoded_payload
            text = _response_text(payload)
            raw_output = json.loads(text)
            output = GeneratedCardOutput.model_validate(raw_output)
        except (ValueError, KeyError, TypeError, ValidationError) as error:
            raise GatewayError(
                "invalid_provider_response",
                "Generation provider returned invalid structured output.",
                502,
                True,
                self.id,
                _generation_response_diagnostics(response, request, payload, raw_output, self.model),
            ) from error

        usage = _provider_usage(payload)
        return ProviderResult(
            request_id=response.headers.get("x-request-id") or request.requestId,
            output=output,
            usage=usage,
        )

    async def bari_chat(self, request: BariChatRequest, conversation_history: list[dict[str, str]]) -> BariChatResult:
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{quote(self.model, safe='')}:generateContent"
        )

        # Build evidence context from source segments
        evidence_context = ""
        if request.evidence:
            evidence_parts = []
            for idx, segment in enumerate(request.evidence, 1):
                evidence_parts.append(
                    f"[Source {idx}: {segment.locator}]\n"
                    f"Section: {segment.sectionPath}\n"
                    f"Text: {segment.text}\n"
                )
            evidence_context = "\n\n".join(evidence_parts)

        # Build user prompt with evidence
        user_prompt = f"Question: {request.message}"
        if evidence_context:
            user_prompt = f"{evidence_context}\n\n{user_prompt}"

        # Build conversation contents with history
        contents = []
        for msg in conversation_history:
            contents.append({"role": msg["role"], "parts": [{"text": msg["content"]}]})
        contents.append({"role": "user", "parts": [{"text": user_prompt}]})

        started = monotonic()
        response, attempt, retry_history = await self._post_with_retry(
            url,
            {
                "systemInstruction": {"parts": [{"text": BARI_CHAT_SYSTEM_PROMPT}]},
                "contents": contents,
                "generationConfig": {
                    "temperature": 0.7,
                    "maxOutputTokens": 2048,
                },
            },
            started,
            "Chat provider timed out.",
            "Chat provider is unavailable.",
        )

        if not response.is_success:
            error = _provider_http_error(response, started, attempt)
            _add_retry_diagnostics(
                error.diagnostics,
                self._max_attempts,
                retry_history,
                response.status_code in _RETRYABLE_STATUS_CODES,
            )
            raise error

        try:
            payload = response.json()
            message_text = _response_text(payload)
        except (ValueError, KeyError, TypeError) as error:
            raise GatewayError(
                "invalid_provider_response",
                "Chat provider returned invalid response.",
                502,
                True,
                self.id,
            ) from error

        usage = payload.get("usageMetadata") or {}
        return BariChatResult(
            request_id=response.headers.get("x-request-id") or "",
            message=message_text,
            usage=ProviderUsage(
                inputTokens=_non_negative_int(usage.get("promptTokenCount")),
                outputTokens=_non_negative_int(usage.get("candidatesTokenCount")),
            ),
        )


def _response_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates")
    if not isinstance(candidates, list) or not candidates:
        raise KeyError("candidates")
    parts = candidates[0].get("content", {}).get("parts", [])
    text = "".join(part.get("text", "") for part in parts if isinstance(part, dict)).strip()
    if not text:
        raise KeyError("text")
    return text


def _provider_usage(payload: dict[str, Any]) -> ProviderUsage:
    usage = payload.get("usageMetadata")
    usage_record = usage if isinstance(usage, dict) else {}
    return ProviderUsage(
        inputTokens=_non_negative_int(usage_record.get("promptTokenCount")),
        outputTokens=_non_negative_int(usage_record.get("candidatesTokenCount")),
    )


def _generation_response_diagnostics(
    response: httpx.Response,
    request: CardGenerationRequest,
    payload: dict[str, Any],
    raw_output: object,
    model: str,
) -> dict[str, Any]:
    usage = _provider_usage(payload)
    raw_candidates = raw_output.get("candidates") if isinstance(raw_output, dict) else None
    return {
        "providerRequestId": _first_header(
            response.headers, "x-request-id", "x-goog-request-id", "x-guploader-uploadid"
        ) or request.requestId,
        "model": model,
        "inputTokens": usage.inputTokens,
        "outputTokens": usage.outputTokens,
        "remoteCandidateCount": len(raw_candidates) if isinstance(raw_candidates, list) else 0,
    }


def _provider_http_error(response: httpx.Response, started: float, attempt: int) -> GatewayError:
    status = response.status_code
    diagnostics = _response_diagnostics(response, started, attempt)
    if status in (401, 403):
        return GatewayError(
            "provider_authentication_error",
            "Generation provider authentication failed.",
            502,
            False,
            "gemini",
            diagnostics,
        )
    if status == 429:
        return GatewayError(
            "provider_rate_limited",
            "Generation provider rate limit reached.",
            429,
            True,
            "gemini",
            diagnostics,
        )
    if status >= 500:
        return GatewayError(
            "provider_unavailable",
            "Generation provider is unavailable.",
            503,
            True,
            "gemini",
            diagnostics,
        )
    return GatewayError(
        "provider_rejected_request",
        "Generation provider rejected the request.",
        502,
        False,
        "gemini",
        diagnostics,
    )


def _add_retry_diagnostics(
    diagnostics: dict[str, Any],
    max_attempts: int,
    retry_history: list[dict[str, Any]],
    exhausted: bool,
) -> None:
    diagnostics["maxAttempts"] = max_attempts
    diagnostics["retryCount"] = len(retry_history)
    diagnostics["retriesExhausted"] = exhausted
    if retry_history:
        diagnostics["retryHistory"] = retry_history


def _response_retry_record(response: httpx.Response, attempt: int, delay: float) -> dict[str, Any]:
    record: dict[str, Any] = {
        "attempt": attempt,
        "providerStatus": response.status_code,
        "delayMs": round(delay * 1_000),
    }
    request_id = _first_header(response.headers, "x-request-id", "x-goog-request-id", "x-guploader-uploadid")
    if request_id:
        record["providerRequestId"] = request_id[:256]
    return record


def _transport_retry_record(error: httpx.HTTPError, attempt: int, delay: float) -> dict[str, Any]:
    record: dict[str, Any] = {
        "attempt": attempt,
        "transportError": type(error).__name__,
        "delayMs": round(delay * 1_000),
    }
    phase = _timeout_phase(error)
    if phase:
        record["timeoutPhase"] = phase
    return record


def _server_retry_delay(response: httpx.Response) -> float | None:
    retry_after = response.headers.get("retry-after")
    parsed = _parse_retry_after(retry_after)
    if parsed is not None:
        return parsed
    error = _safe_error_payload(response)
    details = error.get("details") if error else None
    if isinstance(details, list):
        for detail in details:
            if not isinstance(detail, dict):
                continue
            parsed = _parse_duration_seconds(detail.get("retryDelay"))
            if parsed is not None:
                return parsed
    return None


def _parse_retry_after(value: object) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        return max(0.0, float(value.strip()))
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())


def _parse_duration_seconds(value: object) -> float | None:
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)s\s*", value)
    return float(match.group(1)) if match else None


def _response_diagnostics(response: httpx.Response, started: float, attempt: int) -> dict[str, Any]:
    error = _safe_error_payload(response)
    headers = response.headers
    diagnostics: dict[str, Any] = {
        "attempt": attempt,
        "elapsedMs": round((monotonic() - started) * 1_000),
        "providerStatus": response.status_code,
    }
    request_id = _first_header(headers, "x-request-id", "x-goog-request-id", "x-guploader-uploadid")
    if request_id:
        diagnostics["providerRequestId"] = request_id[:256]
    retry_after = headers.get("retry-after")
    if retry_after:
        diagnostics["retryAfter"] = retry_after[:128]
    if error:
        diagnostics["providerError"] = error
    return diagnostics


def _safe_error_payload(response: httpx.Response) -> dict[str, Any] | None:
    try:
        payload = response.json()
    except ValueError:
        text = _sanitize_text(response.text)
        return {"message": text} if text else None

    raw_error = payload.get("error") if isinstance(payload, dict) else None
    if not isinstance(raw_error, dict):
        text = _sanitize_text(response.text)
        return {"message": text} if text else None

    safe: dict[str, Any] = {}
    for key in ("code", "status"):
        value = raw_error.get(key)
        if isinstance(value, (str, int)) and not isinstance(value, bool):
            safe[key] = value
    message = _sanitize_text(raw_error.get("message"))
    if message:
        safe["message"] = message

    details = raw_error.get("details")
    if isinstance(details, list):
        safe_details = [_safe_error_detail(detail) for detail in details[:20]]
        safe_details = [detail for detail in safe_details if detail]
        if safe_details:
            safe["details"] = safe_details
    return safe or None


def _safe_error_detail(detail: object) -> dict[str, Any] | None:
    if not isinstance(detail, dict):
        return None
    safe: dict[str, Any] = {}
    type_name = detail.get("@type")
    if isinstance(type_name, str):
        safe["type"] = type_name[:256]
    for key in ("reason", "domain", "retryDelay"):
        value = _sanitize_text(detail.get(key))
        if value:
            safe[key] = value
    metadata = detail.get("metadata")
    if isinstance(metadata, dict):
        safe_metadata = {
            str(key)[:128]: sanitized
            for key, value in list(metadata.items())[:30]
            if (sanitized := _sanitize_text(value))
        }
        if safe_metadata:
            safe["metadata"] = safe_metadata
    violations = detail.get("violations")
    if isinstance(violations, list):
        safe_violations = []
        for violation in violations[:20]:
            if not isinstance(violation, dict):
                continue
            item = {}
            for key in ("subject", "description", "quotaMetric", "quotaId"):
                value = _sanitize_text(violation.get(key))
                if value:
                    item[key] = value
            if item:
                safe_violations.append(item)
        if safe_violations:
            safe["violations"] = safe_violations
    return safe or None


def _transport_diagnostics(error: httpx.HTTPError, started: float, attempt: int) -> dict[str, Any]:
    diagnostics: dict[str, Any] = {
        "attempt": attempt,
        "elapsedMs": round((monotonic() - started) * 1_000),
        "transportError": type(error).__name__,
    }
    phase = _timeout_phase(error)
    if phase:
        diagnostics["timeoutPhase"] = phase
    return diagnostics


def _timeout_phase(error: httpx.HTTPError) -> str | None:
    for error_type, phase in (
        (httpx.ConnectTimeout, "connect"),
        (httpx.ReadTimeout, "read"),
        (httpx.WriteTimeout, "write"),
        (httpx.PoolTimeout, "pool"),
    ):
        if isinstance(error, error_type):
            return phase
    return "unknown" if isinstance(error, httpx.TimeoutException) else None


def _first_header(headers: httpx.Headers, *names: str) -> str | None:
    return next((value for name in names if (value := headers.get(name))), None)


def _sanitize_text(value: object) -> str | None:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    text = str(value).replace("\r", " ").replace("\n", " ").strip()
    if not text:
        return None
    text = re.sub(r"(?i)(key=)[^&\s]+", r"\1<redacted>", text)
    text = re.sub(r"(?i)(api[_ -]?key|authorization|access[_ -]?token)\s*[:=]\s*\S+", r"\1=<redacted>", text)
    text = re.sub(r"\bAIza[0-9A-Za-z_-]{20,}\b", "<redacted>", text)
    return text[:2_000]


def _non_negative_int(value: object) -> int | None:
    return value if isinstance(value, int) and value >= 0 else None
