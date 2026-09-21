from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

from dotenv import load_dotenv

from services.ai_gateway.errors import GatewayError
from services.ai_gateway.models import CardGenerationRequest, CardGenerationResponse
from services.ai_gateway.orchestration import GenerationOrchestrator
from services.ai_gateway.prompts import CARD_GENERATION_SYSTEM_PROMPT
from services.ai_gateway.providers.gemini import (
    CARD_GENERATION_MAX_OUTPUT_TOKENS,
    CARD_GENERATION_THINKING_LEVEL,
    GeminiGenerationProvider,
)
from services.ai_gateway.validation import validate_grounded_output

from .io_utils import canonical_json, read_json, sha256_text, write_json
from .models import Card, Segment

MAX_CANDIDATES = 56
MIN_CANDIDATES = 45
PROMPT_VERSION = "1.2.0"
BATCH_GENERATION_VERSION = "1.0.0"
DEFAULT_BATCH_COUNT = 4
DEFAULT_MAX_REQUESTS = 6
DEFAULT_MAX_INPUT_TOKENS = 100_000
DEFAULT_MAX_OUTPUT_TOKENS = 20_000
_BATCH_TARGET_CANDIDATES = 14
_BATCH_MIN_CANDIDATES = 8
_GATEWAY_ENV_PATH = Path(__file__).resolve().parents[1] / "ai_gateway" / ".env"


@dataclass(frozen=True, slots=True)
class ProviderSettings:
    api_key: str
    provider: str
    model: str
    timeout_seconds: float
    max_attempts: int
    retry_base_delay_seconds: float
    retry_max_delay_seconds: float


def load_provider_settings(env_path: Path = _GATEWAY_ENV_PATH) -> ProviderSettings:
    """Load direct-provider settings without requiring gateway HTTP authentication."""
    load_dotenv(dotenv_path=env_path, override=False)
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise ValueError(f"GEMINI_API_KEY is not configured in the process environment or {env_path}.")

    provider = os.getenv("PRIMARY_GENERATION_PROVIDER", "gemini").strip().lower()
    if provider != "gemini":
        raise ValueError(f"Unsupported generation provider: {provider}.")

    model = os.getenv("PRIMARY_GENERATION_MODEL", "gemini-2.5-flash").strip()
    if not model:
        raise ValueError("PRIMARY_GENERATION_MODEL is required.")

    timeout_raw = os.getenv("BARION_AI_PROVIDER_TIMEOUT_SECONDS", "30").strip()
    try:
        timeout_seconds = float(timeout_raw)
    except ValueError as error:
        raise ValueError("BARION_AI_PROVIDER_TIMEOUT_SECONDS must be numeric.") from error
    if timeout_seconds < 1 or timeout_seconds > 120:
        raise ValueError("BARION_AI_PROVIDER_TIMEOUT_SECONDS must be between 1 and 120.")

    max_attempts = _env_int("BARION_AI_PROVIDER_MAX_ATTEMPTS", 4, 1, 10)
    retry_base_delay_seconds = _env_float("BARION_AI_PROVIDER_RETRY_BASE_DELAY_SECONDS", 1, 0, 60)
    retry_max_delay_seconds = _env_float("BARION_AI_PROVIDER_RETRY_MAX_DELAY_SECONDS", 16, 0, 300)
    if retry_base_delay_seconds > retry_max_delay_seconds:
        raise ValueError(
            "BARION_AI_PROVIDER_RETRY_BASE_DELAY_SECONDS must not exceed "
            "BARION_AI_PROVIDER_RETRY_MAX_DELAY_SECONDS."
        )
    return ProviderSettings(
        api_key, provider, model, timeout_seconds, max_attempts,
        retry_base_delay_seconds, retry_max_delay_seconds,
    )


def _env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be an integer.") from error
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}.")
    return value


def _env_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError as error:
        raise ValueError(f"{name} must be numeric.") from error
    if value < minimum or value > maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}.")
    return value


def build_request(segments: list[Segment], source_title: str, model: str) -> CardGenerationRequest:
    return _build_request(segments, source_title, model, MAX_CANDIDATES, MIN_CANDIDATES, "whole")


def build_batch_requests(
    segments: list[Segment], source_title: str, model: str, batch_count: int = DEFAULT_BATCH_COUNT,
    request_count: int | None = None,
) -> list[CardGenerationRequest]:
    """Partition source deterministically while spreading sections and source positions."""
    if batch_count < 1:
        raise ValueError("Batch count must be positive.")
    if not segments:
        raise ValueError("Cannot build generation batches without source segments.")
    batch_count = min(batch_count, len(segments))
    request_count = request_count or batch_count
    if request_count < batch_count:
        raise ValueError("Request count must cover every initial batch.")
    groups: list[list[tuple[int, Segment]]] = [[] for _ in range(batch_count)]
    section_counts: list[dict[str, int]] = [{} for _ in range(batch_count)]
    loads = [0] * batch_count
    ordered = sorted(enumerate(segments), key=lambda pair: (pair[1].sectionPath, pair[0]))
    for source_index, segment in ordered:
        section = segment.sectionPath.strip().lower()
        batch_index = min(
            range(batch_count),
            key=lambda index: (section_counts[index].get(section, 0), loads[index], index),
        )
        groups[batch_index].append((source_index, segment))
        section_counts[batch_index][section] = section_counts[batch_index].get(section, 0) + 1
        loads[batch_index] += max(1, len(segment.text))
    initial = [
        _build_request(
            [segment for _, segment in sorted(group)], source_title, model,
            _BATCH_TARGET_CANDIDATES, min(_BATCH_MIN_CANDIDATES, len(group)), f"batch-{index:02d}",
        )
        for index, group in enumerate(groups, 1)
    ]
    requests = list(initial)
    initial_segments = [[segment for _, segment in sorted(group)] for group in groups]
    for index in range(batch_count, request_count):
        source_segments = initial_segments[index % batch_count]
        requests.append(_build_request(
            source_segments, source_title, model, _BATCH_TARGET_CANDIDATES,
            min(_BATCH_MIN_CANDIDATES, len(source_segments)), f"supplement-{index + 1:02d}",
        ))
    return requests


def _build_request(
    segments: list[Segment], source_title: str, model: str,
    target_candidates: int, min_candidates: int, scope: str,
) -> CardGenerationRequest:
    payload = {
        "sourceId": "card-benchmark-source",
        "sourceTitle": source_title,
        "generationScope": scope,
        "targetCandidates": target_candidates,
        "minCandidates": min_candidates,
        "coverageRequirement": "Distribute distinct cards across as many supplied segments and major sections as evidence permits.",
        "segments": [{"segmentId": item.segmentId, "locator": item.locator,
                      "sectionPath": item.sectionPath, "text": item.text} for item in segments],
    }
    return CardGenerationRequest(
        requestId=f"benchmark-{sha256_text(canonical_json(payload))[:16]}",
        promptId="grounded-card-generation", promptVersion=PROMPT_VERSION,
        systemPrompt=CARD_GENERATION_SYSTEM_PROMPT,
        userPrompt=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        minCandidates=min_candidates, maxCandidates=target_candidates, model=model,
    )


def effective_settings(model: str) -> dict[str, Any]:
    return {
        "provider": "gemini", "model": model, "temperature": 0.2,
        "targetCandidates": MAX_CANDIDATES, "minCandidates": MIN_CANDIDATES,
        "maxCandidates": MAX_CANDIDATES,
        "maxOutputTokens": CARD_GENERATION_MAX_OUTPUT_TOKENS,
        "thinkingLevel": CARD_GENERATION_THINKING_LEVEL,
        "promptId": "grounded-card-generation", "promptVersion": PROMPT_VERSION,
        "effectiveGatewayPromptSha256": sha256_text(CARD_GENERATION_SYSTEM_PROMPT),
    }


def read_cached_cards(path: Path, request: CardGenerationRequest) -> tuple[list[Card], dict[str, Any]]:
    payload = read_json(path)
    try:
        response = CardGenerationResponse.model_validate(payload)
    except Exception as error:
        raise ValueError("Production cache does not match gateway response schema.") from error
    if response.model != request.model:
        raise ValueError(f"Cached model {response.model!r} differs from requested model {request.model!r}.")
    if response.requestId != request.requestId:
        raise ValueError("Production cache request identity differs from current source/configuration; refusing stale artifact mixing.")
    validated = validate_grounded_output(request, response.output)
    if len(validated.candidates) != len(response.output.candidates):
        raise ValueError("Production cache contains unsupported or duplicate candidates.")
    candidates = [candidate.model_dump(mode="json") for candidate in validated.candidates]
    return [_to_card(raw, index) for index, raw in enumerate(candidates, 1)], payload


def generate_remote(request: CardGenerationRequest, cache_path: Path) -> tuple[list[Card], dict[str, Any]]:
    """Only call provider after CLI confirms explicit --allow-remote."""
    settings = load_provider_settings()
    if request.model != settings.model:
        raise ValueError("Requested model differs from configured PRIMARY_GENERATION_MODEL.")

    async def run() -> dict[str, Any]:
        provider = GeminiGenerationProvider(
            settings.api_key, request.model, settings.timeout_seconds,
            max_attempts=settings.max_attempts,
            retry_base_delay_seconds=settings.retry_base_delay_seconds,
            retry_max_delay_seconds=settings.retry_max_delay_seconds,
        )
        try:
            response = await GenerationOrchestrator(provider).generate_cards(request)
            return response.model_dump(mode="json")
        finally:
            await provider.close()

    payload = asyncio.run(run())
    write_json(cache_path, payload)
    candidates = payload["output"]["candidates"]
    return [_to_card(raw, index) for index, raw in enumerate(candidates, 1)], payload


def read_batched_cards(
    cache_path: Path, requests: list[CardGenerationRequest],
) -> tuple[list[Card], dict[str, Any]]:
    manifest = read_json(_batch_manifest_path(cache_path))
    _validate_batch_manifest(manifest, requests)
    batch_payloads = []
    for entry, request in zip(manifest["batches"], requests, strict=True):
        if entry.get("status") != "complete":
            continue
        batch_payload = read_json(_batch_dir(cache_path) / str(entry["cacheFilename"]))
        if entry.get("responseSha256") != sha256_text(canonical_json(batch_payload)):
            raise ValueError("Batch cache response hash mismatch.")
        response = _validated_response(batch_payload, request)
        batch_payloads.append(response.model_dump(mode="json"))
    cards, duplicate_count = _merge_batch_payloads(batch_payloads)
    return cards, _merged_response(requests, batch_payloads, len(cards), duplicate_count, manifest)


def generate_remote_batched(
    requests: list[CardGenerationRequest], cache_path: Path,
    max_requests: int = DEFAULT_MAX_REQUESTS,
    max_input_tokens: int = DEFAULT_MAX_INPUT_TOKENS,
    max_output_tokens: int = DEFAULT_MAX_OUTPUT_TOKENS,
) -> tuple[list[Card], dict[str, Any]]:
    """Generate resumable batches; persist every validated success before next request."""
    if len(requests) > max_requests:
        raise ValueError(f"Batch plan requires {len(requests)} requests; --max-generation-requests is {max_requests}.")
    settings = load_provider_settings()
    if any(request.model != settings.model for request in requests):
        raise ValueError("Requested model differs from configured PRIMARY_GENERATION_MODEL.")
    manifest_path = _batch_manifest_path(cache_path)
    batch_dir = _batch_dir(cache_path)
    manifest = _load_or_create_batch_manifest(manifest_path, requests, max_requests, max_input_tokens, max_output_tokens)

    async def run() -> None:
        provider = GeminiGenerationProvider(
            settings.api_key, settings.model, settings.timeout_seconds,
            max_attempts=settings.max_attempts,
            retry_base_delay_seconds=settings.retry_base_delay_seconds,
            retry_max_delay_seconds=settings.retry_max_delay_seconds,
        )
        try:
            for index, request in enumerate(requests):
                unique_count = _completed_unique_candidate_count(batch_dir, manifest)
                if unique_count >= MAX_CANDIDATES:
                    break
                if _budget_exhausted(manifest, max_requests, max_input_tokens, max_output_tokens):
                    if unique_count >= MIN_CANDIDATES:
                        break
                    _assert_budget(manifest, max_requests, max_input_tokens, max_output_tokens)
                entry = manifest["batches"][index]
                if entry["status"] == "complete":
                    continue
                _assert_budget(manifest, max_requests, max_input_tokens, max_output_tokens)
                manifest["attemptCount"] += 1
                write_json(manifest_path, manifest)
                try:
                    result = await provider.generate_cards(request)
                    output = validate_grounded_output(request, result.output)
                    payload = CardGenerationResponse(
                        requestId=result.request_id, provider=provider.id, model=provider.model,
                        output=output, usage=result.usage,
                    ).model_dump(mode="json")
                    usage = payload.get("usage") or {}
                    if usage.get("inputTokens") is None or usage.get("outputTokens") is None:
                        raise ValueError("Provider omitted token usage; cannot enforce generation budget.")
                    projected_input = manifest["usage"]["inputTokens"] + usage["inputTokens"]
                    projected_output = manifest["usage"]["outputTokens"] + usage["outputTokens"]
                    if projected_input > max_input_tokens or projected_output > max_output_tokens:
                        raise ValueError("Successful batch exceeded configured token budget; response was not cached.")
                    filename = f"batch-{index + 1:02d}-{request.requestId}.json"
                    batch_file = batch_dir / filename
                    write_json(batch_file, payload)
                    entry.update({
                        "status": "complete", "cacheFilename": filename,
                        "responseSha256": sha256_text(canonical_json(payload)),
                        "providerRequestId": payload["requestId"],
                        "validatedCandidateCount": len(output.candidates),
                        "batchMinimumMet": len(output.candidates) >= request.minCandidates,
                        "usage": usage,
                    })
                    for key in ("errorType", "errorCode", "errorDiagnostics"):
                        entry.pop(key, None)
                    manifest["usage"] = {"inputTokens": projected_input, "outputTokens": projected_output}
                    write_json(manifest_path, manifest)
                except GatewayError as error:
                    entry.update({
                        "status": "failed",
                        "errorType": type(error).__name__,
                        "errorCode": error.code,
                        "errorDiagnostics": error.diagnostics,
                    })
                    write_json(manifest_path, manifest)
                    if error.recoverable:
                        continue
                    raise
                except Exception as error:
                    entry.update({"status": "failed", "errorType": type(error).__name__})
                    write_json(manifest_path, manifest)
                    raise
        finally:
            await provider.close()

    asyncio.run(run())
    return read_batched_cards(cache_path, requests)


def _batch_dir(cache_path: Path) -> Path:
    return cache_path.with_suffix(cache_path.suffix + ".batches")


def _batch_manifest_path(cache_path: Path) -> Path:
    return _batch_dir(cache_path) / "manifest.json"


def _request_descriptor(request: CardGenerationRequest, index: int) -> dict[str, Any]:
    payload = json.loads(request.userPrompt)
    segment_ids = [str(segment["segmentId"]) for segment in payload["segments"]]
    return {
        "batchIndex": index, "status": "pending", "requestId": request.requestId,
        "requestSha256": sha256_text(request.userPrompt),
        "sourceSha256": sha256_text(canonical_json(payload["segments"])),
        "segmentIds": segment_ids, "segmentCount": len(segment_ids),
        "minCandidates": request.minCandidates, "maxCandidates": request.maxCandidates,
    }


def _load_or_create_batch_manifest(
    path: Path, requests: list[CardGenerationRequest], max_requests: int,
    max_input_tokens: int, max_output_tokens: int,
) -> dict[str, Any]:
    budgets = {"maxRequests": max_requests, "maxInputTokens": max_input_tokens,
               "maxOutputTokens": max_output_tokens}
    if path.is_file():
        manifest = read_json(path)
        existing_batches = manifest.get("batches")
        if not isinstance(existing_batches, list) or len(existing_batches) > len(requests):
            raise ValueError("Batch cache manifest is incomplete or malformed.")
        existing_requests = requests[:len(existing_batches)]
        _validate_batch_manifest(manifest, existing_requests)
        existing_budgets = manifest.get("budgets")
        if not isinstance(existing_budgets, dict) or any(
            budgets[name] < existing_budgets.get(name, 0) for name in budgets
        ):
            raise ValueError("Batch cache budgets may only be increased when resuming.")
        for entry in existing_batches:
            if entry.get("status") == "complete":
                for key in ("errorType", "errorCode", "errorDiagnostics"):
                    entry.pop(key, None)
        if len(requests) > len(existing_batches):
            manifest["batches"].extend(
                _request_descriptor(request, index)
                for index, request in enumerate(requests[len(existing_batches):], len(existing_batches) + 1)
            )
        manifest["planSha256"] = _batch_plan_hash(requests)
        manifest["budgets"] = budgets
        write_json(path, manifest)
        return manifest
    manifest = {
        "batchGenerationVersion": BATCH_GENERATION_VERSION,
        "model": requests[0].model if requests else None,
        "planSha256": _batch_plan_hash(requests), "attemptCount": 0,
        "budgets": budgets, "usage": {"inputTokens": 0, "outputTokens": 0},
        "batches": [_request_descriptor(request, index) for index, request in enumerate(requests, 1)],
    }
    write_json(path, manifest)
    return manifest


def _validate_batch_manifest(manifest: dict[str, Any], requests: list[CardGenerationRequest]) -> None:
    if manifest.get("batchGenerationVersion") != BATCH_GENERATION_VERSION:
        raise ValueError("Batch cache version differs from current generator.")
    if manifest.get("planSha256") != _batch_plan_hash(requests):
        raise ValueError("Batch cache plan differs from current source/configuration; refusing stale artifact mixing.")
    batches = manifest.get("batches")
    if not isinstance(batches, list) or len(batches) != len(requests):
        raise ValueError("Batch cache manifest is incomplete or malformed.")


def _batch_plan_hash(requests: Iterable[CardGenerationRequest]) -> str:
    plan = [{"requestId": request.requestId, "requestSha256": sha256_text(request.userPrompt),
             "model": request.model, "minCandidates": request.minCandidates,
             "maxCandidates": request.maxCandidates} for request in requests]
    return sha256_text(canonical_json(plan))


def _completed_unique_candidate_count(batch_dir: Path, manifest: dict[str, Any]) -> int:
    payloads = [read_json(batch_dir / str(batch["cacheFilename"]))
                for batch in manifest["batches"] if batch.get("status") == "complete"]
    cards, _duplicates = _merge_batch_payloads(payloads)
    return len(cards)


def _budget_exhausted(manifest: dict[str, Any], max_requests: int, max_input: int, max_output: int) -> bool:
    usage = manifest["usage"]
    return (
        manifest["attemptCount"] >= max_requests
        or usage["inputTokens"] >= max_input
        or usage["outputTokens"] >= max_output
    )


def _assert_budget(manifest: dict[str, Any], max_requests: int, max_input: int, max_output: int) -> None:
    if manifest["attemptCount"] >= max_requests:
        raise ValueError("Generation request budget exhausted; refusing another provider call.")
    usage = manifest["usage"]
    if usage["inputTokens"] >= max_input or usage["outputTokens"] >= max_output:
        raise ValueError("Generation token budget exhausted; refusing another provider call.")


def _validated_response(payload: dict[str, Any], request: CardGenerationRequest) -> CardGenerationResponse:
    try:
        response = CardGenerationResponse.model_validate(payload)
    except Exception as error:
        raise ValueError("Batch cache does not match gateway response schema.") from error
    if response.model != request.model:
        raise ValueError("Batch cache model differs from requested model.")
    validated = validate_grounded_output(request, response.output)
    if len(validated.candidates) != len(response.output.candidates):
        raise ValueError("Batch cache contains unsupported or duplicate candidates.")
    return response


def _dedupe_key(raw: dict[str, Any]) -> str:
    value = f"{raw['question']}\n{raw['answer']}".lower()
    return " ".join("".join(character if character.isalnum() else " " for character in value).split())


def _merge_batch_payloads(payloads: list[dict[str, Any]]) -> tuple[list[Card], int]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    duplicate_count = 0
    for payload in payloads:
        for raw in payload["output"]["candidates"]:
            key = _dedupe_key(raw)
            if key in seen:
                duplicate_count += 1
                continue
            seen.add(key)
            if len(merged) < MAX_CANDIDATES:
                merged.append(raw)
    return [_to_card(raw, index) for index, raw in enumerate(merged, 1)], duplicate_count


def _merged_response(
    requests: list[CardGenerationRequest], payloads: list[dict[str, Any]], card_count: int,
    duplicate_count: int, manifest: dict[str, Any],
) -> dict[str, Any]:
    if card_count < MIN_CANDIDATES:
        raise ValueError(
            f"Batched generation produced {card_count} unique validated cards; minimum is {MIN_CANDIDATES}. "
            "Completed batches remain cached for resume."
        )
    return {
        "requestId": f"batch-plan-{_batch_plan_hash(requests)[:16]}", "provider": "gemini",
        "model": requests[0].model, "usage": manifest["usage"],
        "batchGeneration": {
            "version": BATCH_GENERATION_VERSION, "planSha256": manifest["planSha256"],
            "requestCount": manifest["attemptCount"], "completedBatchCount": len(payloads),
            "duplicateCount": duplicate_count,
            "batchRequestIds": [request.requestId for request in requests],
            "providerRequestIds": [payload["requestId"] for payload in payloads],
            "batchManifest": "manifest.json", "batches": manifest["batches"],
        },
    }


def configured_model() -> str:
    load_dotenv(dotenv_path=_GATEWAY_ENV_PATH, override=False)
    return os.getenv("PRIMARY_GENERATION_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"


def _to_card(raw: dict[str, Any], index: int) -> Card:
    return Card(cardId=f"production-{index:03d}", system="production",
                question=str(raw["question"]), answer=str(raw["answer"]),
                segmentId=str(raw["segmentId"]), locator=str(raw.get("locator", "")),
                cardType=str(raw["cardType"]), learningObjective=str(raw["learningObjective"]),
                evidenceText=str(raw["evidenceText"]), evidenceSpan=raw.get("evidenceSpan"))
