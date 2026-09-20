from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from services.ai_gateway.models import CardGenerationRequest, CardGenerationResponse
from services.ai_gateway.orchestration import GenerationOrchestrator
from services.ai_gateway.prompts import CARD_GENERATION_SYSTEM_PROMPT
from services.ai_gateway.providers.gemini import GeminiGenerationProvider
from services.ai_gateway.validation import validate_grounded_output

from .io_utils import canonical_json, read_json, sha256_text, write_json
from .models import Card, Segment

MAX_CANDIDATES = 56
MIN_CANDIDATES = 45
PROMPT_VERSION = "1.2.0"
_GATEWAY_ENV_PATH = Path(__file__).resolve().parents[1] / "ai_gateway" / ".env"


@dataclass(frozen=True, slots=True)
class ProviderSettings:
    api_key: str
    provider: str
    model: str
    timeout_seconds: float


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

    return ProviderSettings(api_key, provider, model, timeout_seconds)


def build_request(segments: list[Segment], source_title: str, model: str) -> CardGenerationRequest:
    payload = {
        "sourceId": "card-benchmark-source",
        "sourceTitle": source_title,
        "targetCandidates": MAX_CANDIDATES,
        "minCandidates": MIN_CANDIDATES,
        "coverageRequirement": "Distribute distinct cards across as many supplied segments and major sections as evidence permits.",
        "segments": [{"segmentId": item.segmentId, "locator": item.locator,
                      "sectionPath": item.sectionPath, "text": item.text} for item in segments],
    }
    return CardGenerationRequest(
        requestId=f"benchmark-{sha256_text(canonical_json(payload))[:16]}",
        promptId="grounded-card-generation", promptVersion=PROMPT_VERSION,
        systemPrompt=CARD_GENERATION_SYSTEM_PROMPT,
        userPrompt=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        minCandidates=MIN_CANDIDATES, maxCandidates=MAX_CANDIDATES, model=model,
    )


def effective_settings(model: str) -> dict[str, Any]:
    return {
        "provider": "gemini", "model": model, "temperature": 0.2,
        "targetCandidates": MAX_CANDIDATES, "minCandidates": MIN_CANDIDATES,
        "maxCandidates": MAX_CANDIDATES,
        "maxOutputTokens": min(16_384, 768 + MAX_CANDIDATES * 320),
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
        provider = GeminiGenerationProvider(settings.api_key, request.model, settings.timeout_seconds)
        try:
            response = await GenerationOrchestrator(provider).generate_cards(request)
            return response.model_dump(mode="json")
        finally:
            await provider.close()

    payload = asyncio.run(run())
    write_json(cache_path, payload)
    candidates = payload["output"]["candidates"]
    return [_to_card(raw, index) for index, raw in enumerate(candidates, 1)], payload


def configured_model() -> str:
    load_dotenv(dotenv_path=_GATEWAY_ENV_PATH, override=False)
    return os.getenv("PRIMARY_GENERATION_MODEL", "gemini-2.5-flash").strip() or "gemini-2.5-flash"


def _to_card(raw: dict[str, Any], index: int) -> Card:
    return Card(cardId=f"production-{index:03d}", system="production",
                question=str(raw["question"]), answer=str(raw["answer"]),
                segmentId=str(raw["segmentId"]), locator=str(raw.get("locator", "")),
                cardType=str(raw["cardType"]), learningObjective=str(raw["learningObjective"]),
                evidenceText=str(raw["evidenceText"]))
