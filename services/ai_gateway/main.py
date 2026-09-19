from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import GatewaySettings
from .errors import GatewayError
from .models import (
    BariChatRequest,
    BariChatResponse,
    BariGeneration,
    CardGenerationRequest,
    CardGenerationResponse,
)
from .orchestration import GenerationOrchestrator
from .providers.gemini import GeminiGenerationProvider
from .security import InMemoryRateLimiter, enforce_body_limit, require_gateway_token


def create_app(
    settings: GatewaySettings | None = None,
    orchestrator: GenerationOrchestrator | None = None,
) -> FastAPI:
    resolved_settings = settings or GatewaySettings.from_env()
    provider = None
    if orchestrator is None and resolved_settings.gemini_api_key:
        provider = GeminiGenerationProvider(
            resolved_settings.gemini_api_key,
            resolved_settings.generation_model,
            resolved_settings.provider_timeout_seconds,
        )
        orchestrator = GenerationOrchestrator(provider)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        if provider:
            await provider.close()

    app = FastAPI(title="Barion AI Gateway", version="1.0.0", lifespan=lifespan)
    app.state.settings = resolved_settings
    app.state.orchestrator = orchestrator
    app.state.rate_limiter = InMemoryRateLimiter()
    auth = require_gateway_token(resolved_settings.auth_token)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(GatewayError)
    async def gateway_error_handler(_request: Request, error: GatewayError) -> JSONResponse:
        return _gateway_error_response(error)

    @app.exception_handler(RequestValidationError)
    async def request_validation_handler(_request: Request, _error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "invalid_request", "message": "Request payload is invalid.", "recoverable": False}},
        )

    @app.middleware("http")
    async def request_controls(request: Request, call_next):
        try:
            await enforce_body_limit(request, resolved_settings.max_request_bytes)
            if request.url.path.startswith("/v1/") and request.url.path != "/v1/health":
                app.state.rate_limiter.check(request.client.host if request.client else "unknown")
        except GatewayError as error:
            return _gateway_error_response(error)
        return await call_next(request)

    @app.get("/v1/health")
    async def health() -> dict[str, object]:
        configured = app.state.orchestrator is not None
        return {
            "status": "ok" if configured else "degraded",
            "gateway": "ok",
            "database": "not-required",
            "generationProvider": {
                "status": "configured" if configured else "unconfigured",
                "provider": resolved_settings.generation_provider,
                "model": resolved_settings.generation_model,
            },
            "embeddingProvider": "not-configured",
            "validator": "ok",
        }

    @app.post(
        "/v1/card-generation",
        response_model=CardGenerationResponse,
        dependencies=[Depends(auth)],
    )
    async def card_generation(request: CardGenerationRequest) -> CardGenerationResponse:
        if request.model != resolved_settings.generation_model:
            raise GatewayError("model_not_allowed", "Requested model is not enabled.", 422)
        if len(request.systemPrompt) + len(request.userPrompt) > resolved_settings.max_input_characters:
            raise GatewayError("request_too_large", "Generation input is too large.", 413)
        if app.state.orchestrator is None:
            raise GatewayError("provider_unavailable", "Generation provider is not configured.", 503, True)
        return await app.state.orchestrator.generate_cards(request)

    @app.post("/v1/bari/chat", response_model=BariChatResponse, dependencies=[Depends(auth)])
    async def bari_chat(request: BariChatRequest) -> BariChatResponse:
        request_id = str(uuid4())
        return BariChatResponse(
            message="I couldn't find enough support for that in your selected material.",
            evidence=request.evidence,
            warnings=["Bari source-grounded chat generation is not enabled in this sprint."],
            generation=BariGeneration(requestId=request_id),
        )

    return app


def _gateway_error_response(error: GatewayError) -> JSONResponse:
    headers = {"WWW-Authenticate": "Bearer"} if error.status_code == 401 else None
    return JSONResponse(
        status_code=error.status_code,
        headers=headers,
        content={
            "error": {
                "code": error.code,
                "message": error.message,
                "recoverable": error.recoverable,
                "requestId": str(uuid4()),
            }
        },
    )


app = create_app()
