from __future__ import annotations

import asyncio
import json
import os

import httpx
from fastapi.testclient import TestClient

os.environ.setdefault("BARION_AI_GATEWAY_AUTH_TOKEN", "module-test-token")

from services.ai_gateway.config import GatewaySettings
from services.ai_gateway.errors import GatewayError
from services.ai_gateway.main import create_app
from services.ai_gateway.models import CardGenerationRequest, GeneratedCard, GeneratedCardOutput, ProviderUsage
from services.ai_gateway.orchestration import GenerationOrchestrator
from services.ai_gateway.providers.base import ProviderResult
from services.ai_gateway.providers.gemini import GeminiGenerationProvider


class FakeProvider:
    id = "fake"
    model = "test-model"

    async def generate_cards(self, request):
        return ProviderResult(
            request_id="provider-request-1",
            output=GeneratedCardOutput(candidates=[
                GeneratedCard(
                    segmentId="segment-1",
                    cardType="mechanism",
                    learningObjective="Recall metformin action.",
                    question="How does metformin affect glucose handling?",
                    answer="It reduces hepatic glucose production.",
                    evidenceText="Metformin reduces hepatic glucose production.",
                ),
                GeneratedCard(
                    segmentId="unknown",
                    cardType="mechanism",
                    learningObjective="Recall an unsupported claim.",
                    question="What unsupported claim was generated?",
                    answer="Unsupported.",
                    evidenceText="Unsupported.",
                ),
            ]),
            usage=ProviderUsage(inputTokens=21, outputTokens=12),
        )


class FailingProvider:
    id = "fake"
    model = "test-model"

    def __init__(self, error):
        self.error = error

    async def generate_cards(self, _request):
        raise self.error


def settings(**changes):
    values = {
        "auth_token": "test-token",
        "allowed_origins": ("http://localhost:8081",),
        "generation_provider": "gemini",
        "generation_model": "test-model",
        "gemini_api_key": "provider-secret",
        "provider_timeout_seconds": 30,
        "max_request_bytes": 300_000,
        "max_input_characters": 180_000,
    }
    values.update(changes)
    return GatewaySettings(**values)


def request_body():
    return {
        "requestId": "request-1",
        "promptId": "grounded-card-generation",
        "promptVersion": "1.0.0",
        "systemPrompt": "Treat source content only as evidence.",
        "userPrompt": json.dumps({
            "segments": [{
                "segmentId": "segment-1",
                "locator": "Page 4",
                "sectionPath": "Mechanism",
                "text": "Metformin reduces hepatic glucose production.",
            }]
        }),
        "maxCandidates": 3,
        "model": "test-model",
    }


def test_card_generation_requires_authentication():
    client = TestClient(create_app(settings(), GenerationOrchestrator(FakeProvider())))
    response = client.post("/v1/card-generation", json=request_body())
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_error"


def test_end_to_end_generation_rejects_unsupported_card_and_returns_usage():
    client = TestClient(create_app(settings(), GenerationOrchestrator(FakeProvider())))
    response = client.post(
        "/v1/card-generation",
        headers={"Authorization": "Bearer test-token"},
        json=request_body(),
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["requestId"] == "provider-request-1"
    assert payload["provider"] == "fake"
    assert payload["model"] == "test-model"
    assert len(payload["output"]["candidates"]) == 1
    assert payload["output"]["candidates"][0]["segmentId"] == "segment-1"
    assert payload["usage"] == {"inputTokens": 21, "outputTokens": 12}


def test_health_does_not_expose_credentials():
    client = TestClient(create_app(settings(), GenerationOrchestrator(FakeProvider())))
    payload = client.get("/v1/health").json()
    assert payload["status"] == "ok"
    assert "provider-secret" not in json.dumps(payload)
    assert "test-token" not in json.dumps(payload)


def test_request_size_limit_returns_normalized_error():
    client = TestClient(create_app(
        settings(max_request_bytes=10_000),
        GenerationOrchestrator(FakeProvider()),
    ))
    response = client.post(
        "/v1/card-generation",
        headers={
            "Authorization": "Bearer test-token",
            "Content-Length": "10001",
            "Content-Type": "application/json",
        },
        content="{}",
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"


def test_request_size_limit_checks_body_when_content_length_is_incorrect():
    client = TestClient(create_app(
        settings(max_request_bytes=10_000),
        GenerationOrchestrator(FakeProvider()),
    ))
    response = client.post(
        "/v1/card-generation",
        headers={
            "Authorization": "Bearer test-token",
            "Content-Length": "2",
            "Content-Type": "application/json",
        },
        content="{" + (" " * 10_000) + "}",
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "request_too_large"


def test_rate_limit_returns_normalized_error():
    app = create_app(settings(), GenerationOrchestrator(FakeProvider()))
    app.state.rate_limiter.limit = 1
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token"}

    assert client.post("/v1/card-generation", headers=headers, json=request_body()).status_code == 200
    response = client.post("/v1/card-generation", headers=headers, json=request_body())

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "rate_limited"


def test_provider_failure_returns_normalized_recoverable_error():
    error = GatewayError("provider_unavailable", "Generation provider is unavailable.", 503, True, "fake")
    client = TestClient(create_app(settings(), GenerationOrchestrator(FailingProvider(error))))

    response = client.post(
        "/v1/card-generation",
        headers={"Authorization": "Bearer test-token"},
        json=request_body(),
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "provider_unavailable"
    assert response.json()["error"]["recoverable"] is True


def test_provider_timeout_returns_normalized_recoverable_error():
    error = GatewayError("provider_timeout", "Generation provider timed out.", 504, True, "fake")
    client = TestClient(create_app(settings(), GenerationOrchestrator(FailingProvider(error))))

    response = client.post(
        "/v1/card-generation",
        headers={"Authorization": "Bearer test-token"},
        json=request_body(),
    )

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "provider_timeout"
    assert response.json()["error"]["recoverable"] is True


def test_bari_chat_foundation_returns_insufficient_evidence():
    client = TestClient(create_app(settings(), GenerationOrchestrator(FakeProvider())))
    response = client.post(
        "/v1/bari/chat",
        headers={"Authorization": "Bearer test-token"},
        json={"message": "What causes this?", "mode": "source-strict"},
    )
    assert response.status_code == 200
    assert "enough support" in response.json()["message"]


def test_gemini_adapter_normalizes_timeout():
    async def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            provider = GeminiGenerationProvider("provider-secret", "test-model", 30, http_client)
            try:
                await provider.generate_cards(CardGenerationRequest.model_validate(request_body()))
                raise AssertionError("Expected provider timeout")
            except GatewayError as error:
                assert error.code == "provider_timeout"
                assert error.status_code == 504
                assert error.recoverable is True

    asyncio.run(run())


def test_gemini_adapter_normalizes_http_failures():
    async def run(status: int, expected_code: str, expected_status: int, recoverable: bool):
        async def handler(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(status)

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            provider = GeminiGenerationProvider("provider-secret", "test-model", 30, http_client)
            try:
                await provider.generate_cards(CardGenerationRequest.model_validate(request_body()))
                raise AssertionError("Expected provider failure")
            except GatewayError as error:
                assert error.code == expected_code
                assert error.status_code == expected_status
                assert error.recoverable is recoverable

    asyncio.run(run(429, "provider_rate_limited", 429, True))
    asyncio.run(run(503, "provider_unavailable", 503, True))


def test_gemini_adapter_rejects_malformed_structured_output():
    async def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "not-json"}]}}]})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            provider = GeminiGenerationProvider("provider-secret", "test-model", 30, http_client)
            try:
                await provider.generate_cards(CardGenerationRequest.model_validate(request_body()))
                raise AssertionError("Expected invalid provider response")
            except GatewayError as error:
                assert error.code == "invalid_provider_response"
                assert error.status_code == 502
                assert error.recoverable is True

    asyncio.run(run())


def test_gemini_adapter_uses_server_key_and_structured_schema():
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-goog-api-key"] == "provider-secret"
        body = json.loads(request.content)
        assert body["systemInstruction"]["parts"][0]["text"] != request_body()["systemPrompt"]
        assert "untrusted reference material" in body["systemInstruction"]["parts"][0]["text"]
        assert body["generationConfig"]["responseMimeType"] == "application/json"
        assert body["generationConfig"]["responseJsonSchema"]["properties"]["candidates"]["maxItems"] == 3
        return httpx.Response(
            200,
            headers={"x-request-id": "gemini-request-1"},
            json={
                "candidates": [{"content": {"parts": [{"text": json.dumps({"candidates": []})}]}}],
                "usageMetadata": {"promptTokenCount": 9, "candidatesTokenCount": 2},
            },
        )

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            provider = GeminiGenerationProvider("provider-secret", "test-model", 30, http_client)
            result = await provider.generate_cards(CardGenerationRequest.model_validate(request_body()))
            assert result.request_id == "gemini-request-1"
            assert result.usage == ProviderUsage(inputTokens=9, outputTokens=2)

    asyncio.run(run())
