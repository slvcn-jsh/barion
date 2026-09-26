import json

from services.ai_gateway.errors import GatewayError
from services.ai_gateway.models import GeneratedCard, GeneratedCardOutput, ProviderUsage
from services.ai_gateway.prompts import CARD_GENERATION_SYSTEM_PROMPT
from services.ai_gateway.providers.base import ProviderResult
from services.card_benchmark.io_utils import sha256_text
from services.card_benchmark.models import Segment
from services.card_benchmark.production import (
    MAX_CANDIDATES,
    MIN_CANDIDATES,
    PROMPT_VERSION,
    _batch_manifest_path,
    _budget_exhausted,
    _completed_unique_candidate_count,
    _load_or_create_batch_manifest,
    _merge_batch_payloads,
    _assert_budget,
    build_batch_requests,
    build_request,
    effective_settings,
    generate_remote_batched,
    load_provider_settings,
)


def test_baseline_request_preserves_whole_document_56_card_cap():
    segments = [Segment("seg-1", "Page 1", "Topic", "Supported source statement long enough for generation.", 0, 54)]
    request = build_request(segments, "Source", "test-model")
    payload = json.loads(request.userPrompt)
    assert request.maxCandidates == MAX_CANDIDATES == 56
    assert request.minCandidates == payload["minCandidates"] == MIN_CANDIDATES == 45
    assert request.promptVersion == PROMPT_VERSION == "1.2.0"
    assert payload["targetCandidates"] == 56
    assert "as many supplied segments" in payload["coverageRequirement"]
    assert payload["segments"][0]["text"] == segments[0].text
    settings = effective_settings("test-model")
    assert settings["maxOutputTokens"] == 32_768
    assert settings["thinkingLevel"] == "low"
    assert settings["effectiveGatewayPromptSha256"] == sha256_text(CARD_GENERATION_SYSTEM_PROMPT)


def test_provider_settings_load_gateway_dotenv_without_auth_token(tmp_path, monkeypatch):
    for name in (
        "GEMINI_API_KEY",
        "PRIMARY_GENERATION_PROVIDER",
            "PRIMARY_GENERATION_MODEL",
            "BARION_AI_PROVIDER_TIMEOUT_SECONDS",
            "BARION_AI_PROVIDER_MAX_ATTEMPTS",
            "BARION_AI_GATEWAY_AUTH_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)
    env_path = tmp_path / ".env"
    env_path.write_text(
        "GEMINI_API_KEY=test-provider-key\n"
        "PRIMARY_GENERATION_PROVIDER=gemini\n"
        "PRIMARY_GENERATION_MODEL=test-model\n"
        "BARION_AI_PROVIDER_TIMEOUT_SECONDS=45\n",
        encoding="utf-8",
    )

    settings = load_provider_settings(env_path)

    assert settings.api_key == "test-provider-key"
    assert settings.provider == "gemini"
    assert settings.model == "test-model"
    assert settings.timeout_seconds == 45
    assert settings.max_attempts == 3
    assert settings.retry_base_delay_seconds == 1
    assert settings.retry_max_delay_seconds == 16


def test_provider_settings_preserve_shell_overrides(tmp_path, monkeypatch):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "GEMINI_API_KEY=file-key\n"
        "PRIMARY_GENERATION_MODEL=file-model\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("GEMINI_API_KEY", "shell-key")
    monkeypatch.setenv("PRIMARY_GENERATION_MODEL", "shell-model")
    monkeypatch.setenv("PRIMARY_GENERATION_PROVIDER", "gemini")
    monkeypatch.setenv("BARION_AI_PROVIDER_TIMEOUT_SECONDS", "30")

    settings = load_provider_settings(env_path)

    assert settings.api_key == "shell-key"
    assert settings.model == "shell-model"


def test_cached_request_identity_rejects_stale_artifact(tmp_path):
    from services.card_benchmark.production import read_cached_cards

    segments = [Segment("seg-1", "Page 1", "Topic", "Supported source statement long enough for generation.", 0, 54)]
    request = build_request(segments, "Source", "test-model")
    cache = tmp_path / "cache.json"
    cache.write_text(json.dumps({"requestId": "different-request", "provider": "gemini", "model": "test-model",
                                 "output": {"candidates": []}, "usage": None}), encoding="utf-8")
    try:
        read_cached_cards(cache, request)
    except ValueError as error:
        assert "stale artifact mixing" in str(error)
    else:
        raise AssertionError("stale cache accepted")




def _segments(count=12):
    return [Segment(f"seg-{index}", f"Page {index}", f"Section {index % 3}",
                    f"Supported source statement number {index} long enough for generation.", 0, 64)
            for index in range(count)]


def _candidate(index, question=None):
    return {
        "segmentId": f"seg-{index}", "cardType": "definition",
        "learningObjective": f"Recall concept {index}.",
        "question": question or f"What is concept {index}?",
        "answer": f"Answer: Concept {index}.\nWhy it matters: Review.\nStudy note: Recall it.",
        "evidenceText": f"Supported source statement number {index}",
    }


def test_batch_partition_is_deterministic_complete_and_balanced():
    first = build_batch_requests(_segments(), "Source", "test-model", 4, 6)
    second = build_batch_requests(_segments(), "Source", "test-model", 4, 6)
    first_ids = [[item["segmentId"] for item in json.loads(request.userPrompt)["segments"]] for request in first]
    assert [request.requestId for request in first] == [request.requestId for request in second]
    assert len(first) == 6
    assert sorted(item for batch in first_ids[:4] for item in batch) == sorted(segment.segmentId for segment in _segments())
    assert max(map(len, first_ids[:4])) - min(map(len, first_ids[:4])) <= 1
    assert all(request.minCandidates == 3 and request.maxCandidates == 14 for request in first)


def test_merge_deduplicates_and_caps_cards():
    candidates = [_candidate(index) for index in range(56)]
    duplicate = dict(candidates[0])
    duplicate["question"] = "WHAT is concept 0!!!"
    payloads = [{"output": {"candidates": candidates[:30]}},
                {"output": {"candidates": [duplicate] + candidates[30:] + [_candidate(57)]}}]
    cards, duplicate_count = _merge_batch_payloads(payloads)
    assert len(cards) == 56
    assert duplicate_count == 1
    assert cards[0].cardId == "production-001"


def test_batch_manifest_resumes_completed_batches_and_rejects_changed_plan(tmp_path):
    requests = build_batch_requests(_segments(), "Source", "test-model", 4)
    path = _batch_manifest_path(tmp_path / "production.json")
    manifest = _load_or_create_batch_manifest(path, requests, 6, 100_000, 20_000)
    manifest["batches"][0]["status"] = "complete"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    resumed = _load_or_create_batch_manifest(path, requests, 6, 100_000, 20_000)
    assert resumed["batches"][0]["status"] == "complete"
    changed = build_batch_requests(_segments(11), "Source", "test-model", 4)
    try:
        _load_or_create_batch_manifest(path, changed, 6, 100_000, 20_000)
    except ValueError as error:
        assert "stale artifact mixing" in str(error)
    else:
        raise AssertionError("changed batch plan accepted")


def test_batch_manifest_allows_append_only_plan_and_budget_expansion(tmp_path):
    initial_requests = build_batch_requests(_segments(), "Source", "test-model", 4, 4)
    path = _batch_manifest_path(tmp_path / "production.json")
    manifest = _load_or_create_batch_manifest(path, initial_requests, 4, 100_000, 20_000)
    manifest["batches"][0].update({"status": "complete", "errorType": "ValueError"})
    path.write_text(json.dumps(manifest), encoding="utf-8")

    expanded_requests = build_batch_requests(_segments(), "Source", "test-model", 4, 8)
    resumed = _load_or_create_batch_manifest(path, expanded_requests, 8, 120_000, 25_000)

    assert len(resumed["batches"]) == 8
    assert resumed["batches"][0]["status"] == "complete"
    assert "errorType" not in resumed["batches"][0]
    assert resumed["batches"][4]["requestId"] == expanded_requests[4].requestId
    assert resumed["budgets"] == {
        "maxRequests": 8, "maxInputTokens": 120_000, "maxOutputTokens": 25_000,
    }

    try:
        _load_or_create_batch_manifest(path, expanded_requests, 7, 120_000, 25_000)
    except ValueError as error:
        assert "may only be increased" in str(error)
    else:
        raise AssertionError("reduced resume budget accepted")


def test_batched_generation_caches_valid_underproduced_responses(tmp_path, monkeypatch):
    segments = _segments(4)
    requests = build_batch_requests(segments, "Source", "test-model", 2, 2)
    cache = tmp_path / "production.json"

    class FakeGeminiProvider:
        id = "gemini"
        model = "test-model"

        def __init__(self, *_args, **_kwargs):
            pass

        async def generate_cards(self, request):
            source = json.loads(request.userPrompt)["segments"][0]
            candidate = GeneratedCard(
                segmentId=source["segmentId"],
                cardType="definition",
                learningObjective="Recall supported source statement.",
                question=f"What does {source['segmentId']} state?",
                answer="Answer: Supported statement.\nWhy it matters: Review.\nStudy note: Recall it.",
                evidenceText=source["text"],
            )
            return ProviderResult(
                request_id=f"provider-{request.requestId}",
                output=GeneratedCardOutput(candidates=[candidate]),
                usage=ProviderUsage(inputTokens=10, outputTokens=20),
            )

        async def close(self):
            pass

    monkeypatch.setattr("services.card_benchmark.production.GeminiGenerationProvider", FakeGeminiProvider)
    monkeypatch.setattr(
        "services.card_benchmark.production.load_provider_settings",
        lambda: type("Settings", (), {
            "api_key": "key", "model": "test-model", "timeout_seconds": 30,
            "max_attempts": 4, "retry_base_delay_seconds": 1,
            "retry_max_delay_seconds": 16,
        })(),
    )

    try:
        generate_remote_batched(requests, cache, 2, 100, 100)
    except ValueError as error:
        assert "minimum is 45" in str(error)
    else:
        raise AssertionError("aggregate minimum unexpectedly met")

    manifest = json.loads(_batch_manifest_path(cache).read_text(encoding="utf-8"))
    assert manifest["attemptCount"] == 2
    assert all(batch["status"] == "complete" for batch in manifest["batches"])
    assert all(batch["validatedCandidateCount"] == 1 for batch in manifest["batches"])
    assert all(batch["batchMinimumMet"] is False for batch in manifest["batches"])
    assert all("errorType" not in batch for batch in manifest["batches"])
    assert manifest["usage"] == {"inputTokens": 20, "outputTokens": 40}


def test_batched_generation_continues_after_recoverable_provider_failure(tmp_path, monkeypatch):
    segments = _segments(6)
    requests = build_batch_requests(segments, "Source", "test-model", 3, 3)
    cache = tmp_path / "production.json"
    calls = []

    class FakeGeminiProvider:
        id = "gemini"
        model = "test-model"

        def __init__(self, *_args, **_kwargs):
            pass

        async def generate_cards(self, request):
            calls.append(request.requestId)
            if len(calls) == 1:
                raise GatewayError(
                    "provider_unavailable", "Unavailable.", 503, True, "gemini",
                    {"attempt": 4, "maxAttempts": 4, "retryCount": 3},
                )
            source = json.loads(request.userPrompt)["segments"][0]
            return ProviderResult(
                request_id=f"provider-{request.requestId}",
                output=GeneratedCardOutput(candidates=[GeneratedCard(
                    segmentId=source["segmentId"],
                    cardType="definition",
                    learningObjective="Recall supported source statement.",
                    question=f"What does {request.requestId} state?",
                    answer="Answer: Supported statement.\nWhy it matters: Review.\nStudy note: Recall it.",
                    evidenceText=source["text"],
                )]),
                usage=ProviderUsage(inputTokens=10, outputTokens=20),
            )

        async def close(self):
            pass

    monkeypatch.setattr("services.card_benchmark.production.GeminiGenerationProvider", FakeGeminiProvider)
    monkeypatch.setattr(
        "services.card_benchmark.production.load_provider_settings",
        lambda: type("Settings", (), {
            "api_key": "key", "model": "test-model", "timeout_seconds": 30,
            "max_attempts": 4, "retry_base_delay_seconds": 1,
            "retry_max_delay_seconds": 16,
        })(),
    )

    try:
        generate_remote_batched(requests, cache, 3, 100, 100)
    except ValueError as error:
        assert "minimum is 45" in str(error)
    else:
        raise AssertionError("aggregate minimum unexpectedly met")

    manifest = json.loads(_batch_manifest_path(cache).read_text(encoding="utf-8"))
    assert len(calls) == 3
    assert manifest["attemptCount"] == 3
    assert manifest["batches"][0]["status"] == "failed"
    assert manifest["batches"][0]["errorCode"] == "provider_unavailable"
    assert manifest["batches"][0]["errorDiagnostics"] == {
        "attempt": 4, "maxAttempts": 4, "retryCount": 3,
    }
    assert [batch["status"] for batch in manifest["batches"][1:]] == ["complete", "complete"]
    assert manifest["usage"] == {"inputTokens": 20, "outputTokens": 40}



def test_supplements_use_unique_count_before_stopping(tmp_path):
    batch_dir = tmp_path / "batches"
    batch_dir.mkdir()
    candidates = [_candidate(index) for index in range(28)]
    duplicate_payload = {"output": {"candidates": candidates}}
    (batch_dir / "one.json").write_text(json.dumps(duplicate_payload), encoding="utf-8")
    (batch_dir / "two.json").write_text(json.dumps(duplicate_payload), encoding="utf-8")
    manifest = {"batches": [
        {"status": "complete", "cacheFilename": "one.json"},
        {"status": "complete", "cacheFilename": "two.json"},
    ]}
    assert _completed_unique_candidate_count(batch_dir, manifest) == 28


def test_quantity_contract_can_complete_at_request_ceiling(tmp_path, monkeypatch):
    segments = _segments(4)
    requests = build_batch_requests(segments, "Source", "test-model", 4, 4)
    cache = tmp_path / "production.json"

    class FakeGeminiProvider:
        id = "gemini"
        model = "test-model"

        def __init__(self, *_args, **_kwargs):
            pass

        async def generate_cards(self, request):
            source = json.loads(request.userPrompt)["segments"][0]
            candidates = [GeneratedCard(
                segmentId=source["segmentId"],
                cardType="definition",
                learningObjective=f"Recall {request.requestId} supported statement {index}.",
                question=f"What is {request.requestId} supported concept {index}?",
                answer=f"Answer: {request.requestId} supported concept {index}.\nWhy it matters: Review.\nStudy note: Recall it.",
                evidenceText=source["text"],
            ) for index in range(MIN_CANDIDATES)]
            return ProviderResult(
                request_id=f"provider-{request.requestId}",
                output=GeneratedCardOutput(candidates=candidates),
                usage=ProviderUsage(inputTokens=10, outputTokens=20),
            )

        async def close(self):
            pass

    monkeypatch.setattr("services.card_benchmark.production.GeminiGenerationProvider", FakeGeminiProvider)
    monkeypatch.setattr(
        "services.card_benchmark.production.load_provider_settings",
        lambda: type("Settings", (), {
            "api_key": "key", "model": "test-model", "timeout_seconds": 30,
            "max_attempts": 4, "retry_base_delay_seconds": 1,
            "retry_max_delay_seconds": 16,
        })(),
    )

    cards, response = generate_remote_batched(requests, cache, 4, 100, 100)

    assert len(cards) >= MIN_CANDIDATES
    assert response["batchGeneration"]["requestCount"] == 4


def test_budget_exhaustion_is_detected_at_any_ceiling():
    assert _budget_exhausted(
        {"attemptCount": 6, "usage": {"inputTokens": 5, "outputTokens": 4}}, 6, 100, 100,
    )
    assert _budget_exhausted(
        {"attemptCount": 1, "usage": {"inputTokens": 100, "outputTokens": 4}}, 6, 100, 100,
    )
    assert not _budget_exhausted(
        {"attemptCount": 1, "usage": {"inputTokens": 5, "outputTokens": 4}}, 6, 100, 100,
    )




def test_request_and_token_budgets_stop_before_call():
    manifest = {"attemptCount": 6, "usage": {"inputTokens": 5, "outputTokens": 4}}
    try:
        _assert_budget(manifest, 6, 100, 100)
    except ValueError as error:
        assert "request budget exhausted" in str(error)
    else:
        raise AssertionError("request budget not enforced")
    manifest = {"attemptCount": 1, "usage": {"inputTokens": 100, "outputTokens": 4}}
    try:
        _assert_budget(manifest, 6, 100, 100)
    except ValueError as error:
        assert "token budget exhausted" in str(error)
    else:
        raise AssertionError("token budget not enforced")
