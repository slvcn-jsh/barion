import pytest

from services.ai_gateway.config import GatewaySettings
from services.ai_gateway.errors import GatewayError
from services.ai_gateway.main import create_app
from services.ai_gateway import main as gateway_main


class RecordingProvider:
    id = "gemini"
    instances = []

    def __init__(self, _api_key, model, timeout_seconds, **configuration):
        self.model = model
        self.timeout_seconds = timeout_seconds
        self.configuration = configuration
        self.closed = False
        self.close_calls = 0
        self.instances.append(self)

    async def close(self):
        self.closed = True
        self.close_calls += 1


def _settings(**changes):
    values = {
        "auth_mode": "static",
        "auth_token": "test-token",
        "supabase_issuer": None,
        "supabase_jwks_url": None,
        "jwt_audience": "authenticated",
        "max_access_token_lifetime_seconds": 3600,
        "allowed_origins": ("http://localhost:8081",),
        "generation_provider": "gemini",
        "generation_model": "card-model",
        "gemini_api_key": "provider-secret",
        "provider_timeout_seconds": 20,
        "provider_max_attempts": 3,
        "provider_retry_base_delay_seconds": 1,
        "provider_retry_max_delay_seconds": 16,
        "max_request_bytes": 300_000,
        "max_input_characters": 180_000,
        "fallback_generation_model": "card-fallback",
        "chat_model": "chat-model",
        "fallback_chat_model": "chat-fallback",
        "chat_provider_timeout_seconds": 9,
        "chat_provider_max_attempts": 2,
        "chat_provider_retry_base_delay_seconds": .25,
        "chat_provider_retry_max_delay_seconds": 2,
    }
    values.update(changes)
    return GatewaySettings(**values)


def test_gateway_builds_independent_provider_chains_from_task_policies(monkeypatch):
    RecordingProvider.instances = []
    monkeypatch.setattr(gateway_main, "GeminiGenerationProvider", RecordingProvider)

    app = create_app(_settings())

    assert app.state.orchestrator.provider.model == "card-model"
    assert app.state.orchestrator.chat_provider.model == "chat-model"
    assert [provider.model for provider in app.state.orchestrator.provider.providers] == [
        "card-model",
        "card-fallback",
    ]
    assert [provider.model for provider in app.state.orchestrator.chat_provider.providers] == [
        "chat-model",
        "chat-fallback",
    ]
    card_primary, _, chat_primary, _ = RecordingProvider.instances
    assert card_primary.configuration["temperature"] == .2
    assert card_primary.configuration["thinking_level"] == "low"
    assert chat_primary.configuration["temperature"] == .7
    assert chat_primary.timeout_seconds == 9
    assert chat_primary.configuration["max_attempts"] == 2


def test_health_reports_effective_logical_and_physical_task_policy(monkeypatch):
    RecordingProvider.instances = []
    monkeypatch.setattr(gateway_main, "GeminiGenerationProvider", RecordingProvider)
    app = create_app(_settings(generation_model="gemini-3.8-flash", chat_model="custom-chat-model"))

    from fastapi.testclient import TestClient

    payload = TestClient(app).get("/v1/health").json()["aiPolicy"]

    assert payload["cardGeneration"]["logicalModelId"] == "gemini-3.8-flash/base"
    assert payload["cardGeneration"]["model"] == "gemini-3.8-flash"
    assert payload["bariChat"]["logicalModelId"] == "gemini:custom-chat-model"
    assert payload["bariChat"]["model"] == "custom-chat-model"
    assert payload["bariChat"]["maxAttempts"] == 2


def test_environment_parses_card_and_chat_policies_independently(monkeypatch):
    monkeypatch.setenv("PRIMARY_GENERATION_MODEL", "card-model")
    monkeypatch.setenv("FALLBACK_GENERATION_MODEL", "card-fallback")
    monkeypatch.setenv("BARION_AI_PROVIDER_TIMEOUT_SECONDS", "18")
    monkeypatch.setenv("BARION_AI_PROVIDER_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("BARION_AI_PROVIDER_RETRY_BASE_DELAY_SECONDS", "1")
    monkeypatch.setenv("BARION_AI_PROVIDER_RETRY_MAX_DELAY_SECONDS", "4")
    monkeypatch.setenv("BARI_CHAT_MODEL", "chat-model")
    monkeypatch.setenv("BARI_CHAT_FALLBACK_MODEL", "chat-fallback")
    monkeypatch.setenv("BARI_CHAT_PROVIDER_TIMEOUT_SECONDS", "9")
    monkeypatch.setenv("BARI_CHAT_PROVIDER_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("BARI_CHAT_PROVIDER_RETRY_BASE_DELAY_SECONDS", ".25")
    monkeypatch.setenv("BARI_CHAT_PROVIDER_RETRY_MAX_DELAY_SECONDS", "2")

    configured = GatewaySettings.from_env()

    card_policy = configured.card_generation_policy
    chat_policy = configured.bari_chat_policy
    assert (card_policy.model_id, card_policy.fallback_model_id) == (
        "card-model",
        "card-fallback",
    )
    assert (card_policy.timeout_seconds, card_policy.max_attempts) == (18, 2)
    assert (chat_policy.model_id, chat_policy.fallback_model_id) == (
        "chat-model",
        "chat-fallback",
    )
    assert (chat_policy.timeout_seconds, chat_policy.max_attempts) == (9, 3)
    assert (chat_policy.retry_base_delay_seconds, chat_policy.retry_max_delay_seconds) == (
        .25,
        2,
    )


def test_chat_deadline_is_validated_independently(monkeypatch):
    monkeypatch.setenv("FALLBACK_GENERATION_MODEL", "")
    monkeypatch.setenv("BARION_AI_PROVIDER_TIMEOUT_SECONDS", "20")
    monkeypatch.setenv("BARION_AI_PROVIDER_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("BARION_AI_PROVIDER_RETRY_MAX_DELAY_SECONDS", "16")
    monkeypatch.setenv("BARI_CHAT_MODEL", "chat-model")
    monkeypatch.setenv("BARI_CHAT_FALLBACK_MODEL", "chat-fallback")
    monkeypatch.setenv("BARI_CHAT_PROVIDER_TIMEOUT_SECONDS", "30")
    monkeypatch.setenv("BARI_CHAT_PROVIDER_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("BARI_CHAT_PROVIDER_RETRY_MAX_DELAY_SECONDS", "20")

    with pytest.raises(GatewayError, match="Bari Chat provider.*120-second"):
        GatewaySettings.from_env()


def test_gateway_closes_each_owned_task_provider_once(monkeypatch):
    RecordingProvider.instances = []
    monkeypatch.setattr(gateway_main, "GeminiGenerationProvider", RecordingProvider)
    app = create_app(_settings())

    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        assert client.get("/v1/health").status_code == 200

    assert len(RecordingProvider.instances) == 4
    assert all(provider.closed for provider in RecordingProvider.instances)
    assert all(provider.close_calls == 1 for provider in RecordingProvider.instances)
