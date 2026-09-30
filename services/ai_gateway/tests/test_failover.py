from __future__ import annotations

import pytest

from services.ai_gateway.errors import GatewayError
from services.ai_gateway.models import BariChatRequest, CardGenerationRequest, GeneratedCardOutput
from services.ai_gateway.orchestration import GenerationOrchestrator
from services.ai_gateway.providers.base import BariChatResult, ProviderResult
from services.ai_gateway.providers.failover import FailoverGenerationProvider


class MockProvider:
    def __init__(self, provider_id: str, model: str, should_fail: bool = False, error: Exception | None = None) -> None:
        self.id = provider_id
        self.model = model
        self.should_fail = should_fail
        self.error = error or GatewayError("provider_unavailable", "Unavailable", 503)
        self.call_count = 0
        self.closed = False

    async def generate_cards(self, request: CardGenerationRequest) -> ProviderResult:
        self.call_count += 1
        if self.should_fail:
            raise self.error
        return ProviderResult(
            request_id="res-1",
            output=GeneratedCardOutput(candidates=[]),
            usage=None,
        )

    async def bari_chat(self, request: BariChatRequest, history: list[dict[str, str]]) -> BariChatResult:
        self.call_count += 1
        if self.should_fail:
            raise self.error
        return BariChatResult(
            request_id="chat-1",
            message=f"Answer from {self.id}",
            usage=None,
        )

    async def close(self) -> None:
        self.closed = True


def _make_card_request(request_id: str) -> CardGenerationRequest:
    return CardGenerationRequest(
        requestId=request_id,
        promptId="grounded-card-generation",
        promptVersion="1.2.0",
        systemPrompt="System prompt",
        userPrompt="User prompt",
        minCandidates=1,
        maxCandidates=5,
        model="gemini-2.0-flash",
    )


@pytest.mark.asyncio
async def test_failover_returns_primary_when_healthy() -> None:
    p1 = MockProvider("gemini-primary", "gemini-2.0-flash")
    p2 = MockProvider("groq-backup", "llama-3.3-70b-versatile")
    failover = FailoverGenerationProvider([p1, p2])

    req = _make_card_request("test-1")
    res = await failover.generate_cards(req)
    assert res.request_id == "res-1"
    assert p1.call_count == 1
    assert p2.call_count == 0
    assert failover.id == "gemini-primary"


@pytest.mark.asyncio
async def test_failover_switches_to_secondary_on_recoverable_error() -> None:
    p1 = MockProvider(
        "gemini-primary",
        "gemini-2.0-flash",
        should_fail=True,
        error=GatewayError("provider_rate_limited", "Quota exceeded", 429),
    )
    p2 = MockProvider("groq-backup", "llama-3.3-70b-versatile")
    failover = FailoverGenerationProvider([p1, p2])

    req = _make_card_request("test-2")
    res = await failover.generate_cards(req)
    assert res.request_id == "res-1"
    assert p1.call_count == 1
    assert p2.call_count == 1
    assert res.provider_id == "groq-backup"
    assert res.model_id == "llama-3.3-70b-versatile"
    assert res.diagnostics == {
        "attemptedModels": ["gemini-2.0-flash", "llama-3.3-70b-versatile"],
        "fallbackUsed": True,
        "fallbackReason": "provider_rate_limited",
    }
    assert failover.id == "gemini-primary"
    assert failover.model == "gemini-2.0-flash"


@pytest.mark.asyncio
async def test_failover_chat_switches_to_secondary_on_503() -> None:
    p1 = MockProvider(
        "gemini-primary",
        "gemini-2.0-flash",
        should_fail=True,
        error=GatewayError("provider_unavailable", "High demand", 503),
    )
    p2 = MockProvider("groq-backup", "llama-3.3-70b-versatile")
    failover = FailoverGenerationProvider([p1, p2])

    chat_req = BariChatRequest(message="What is amiodarone?")
    res = await failover.bari_chat(chat_req, [])
    assert "Answer from groq-backup" in res.message
    assert p1.call_count == 1
    assert p2.call_count == 1
    assert res.provider_id == "groq-backup"
    assert res.model_id == "llama-3.3-70b-versatile"
    assert res.diagnostics == {
        "attemptedModels": ["gemini-2.0-flash", "llama-3.3-70b-versatile"],
        "fallbackUsed": True,
        "fallbackReason": "provider_unavailable",
    }


@pytest.mark.asyncio
async def test_orchestrator_reports_fallback_chat_provenance() -> None:
    primary = MockProvider("gemini", "gemini-primary", should_fail=True)
    fallback = MockProvider("gemini", "gemini-fallback")
    orchestrator = GenerationOrchestrator(FailoverGenerationProvider([primary, fallback]))

    response = await orchestrator.bari_chat(BariChatRequest(message="Explain this."), "user-1")

    assert response.generation.provider == "gemini"
    assert response.generation.model == "gemini-fallback"


@pytest.mark.asyncio
async def test_failover_propagates_unrecoverable_error() -> None:
    p1 = MockProvider(
        "gemini-primary",
        "gemini-2.0-flash",
        should_fail=True,
        error=GatewayError("invalid_request", "Bad payload", 400),
    )
    p2 = MockProvider("groq-backup", "llama-3.3-70b-versatile")
    failover = FailoverGenerationProvider([p1, p2])

    req = _make_card_request("test-3")
    with pytest.raises(GatewayError) as exc_info:
        await failover.generate_cards(req)
    assert exc_info.value.code == "invalid_request"
    assert p1.call_count == 1
    assert p2.call_count == 0


@pytest.mark.asyncio
async def test_failover_reports_all_attempted_models_when_all_recoverable_options_fail() -> None:
    primary = MockProvider("gemini", "gemini-primary", should_fail=True)
    fallback = MockProvider("gemini", "gemini-fallback", should_fail=True)
    failover = FailoverGenerationProvider([primary, fallback])

    with pytest.raises(GatewayError) as exc_info:
        await failover.generate_cards(_make_card_request("test-all-fail"))

    assert exc_info.value.diagnostics["failedModel"] == "gemini-fallback"
    assert exc_info.value.diagnostics["attemptedModels"] == ["gemini-primary", "gemini-fallback"]


@pytest.mark.asyncio
async def test_failover_closes_all_providers() -> None:
    p1 = MockProvider("gemini-primary", "gemini-2.0-flash")
    p2 = MockProvider("groq-backup", "llama-3.3-70b-versatile")
    failover = FailoverGenerationProvider([p1, p2])
    await failover.close()
    assert p1.closed is True
    assert p2.closed is True
