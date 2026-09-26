from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

from .errors import GatewayError

MAX_CLIENT_GENERATION_DEADLINE_SECONDS = 120
GATEWAY_COMPLETION_MARGIN_SECONDS = 5


@dataclass(frozen=True, slots=True)
class GatewaySettings:
    auth_mode: str
    auth_token: str | None
    supabase_issuer: str | None
    supabase_jwks_url: str | None
    jwt_audience: str
    max_access_token_lifetime_seconds: int
    allowed_origins: tuple[str, ...]
    generation_provider: str
    generation_model: str
    gemini_api_key: str | None
    provider_timeout_seconds: float
    provider_max_attempts: int
    provider_retry_base_delay_seconds: float
    provider_retry_max_delay_seconds: float
    max_request_bytes: int
    max_input_characters: int

    @classmethod
    def from_env(cls) -> "GatewaySettings":
        auth_mode = os.getenv("BARION_AI_AUTH_MODE", "static").strip().lower()
        if auth_mode not in {"static", "supabase"}:
            raise GatewayError("configuration_error", "BARION_AI_AUTH_MODE must be static or supabase.", 503)

        auth_token = os.getenv("BARION_AI_GATEWAY_AUTH_TOKEN", "").strip() or None
        supabase_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/") or None
        if auth_mode == "static" and not auth_token:
            raise GatewayError("configuration_error", "BARION_AI_GATEWAY_AUTH_TOKEN is required in static auth mode.", 503)
        if auth_mode == "supabase" and not _valid_supabase_url(supabase_url):
            raise GatewayError("configuration_error", "Valid HTTPS SUPABASE_URL is required in supabase auth mode.", 503)

        provider = os.getenv("PRIMARY_GENERATION_PROVIDER", "gemini").strip().lower()
        if provider != "gemini":
            raise GatewayError("configuration_error", f"Unsupported generation provider: {provider}.", 503)

        model = os.getenv("PRIMARY_GENERATION_MODEL", "gemini-2.5-flash").strip()
        if not model:
            raise GatewayError("configuration_error", "PRIMARY_GENERATION_MODEL is required.", 503)

        allowed_origins = tuple(
            origin.strip()
            for origin in os.getenv(
                "BARION_AI_ALLOWED_ORIGINS",
                "http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082,http://localhost:19006,http://127.0.0.1:19006",
            ).split(",")
            if origin.strip()
        )
        retry_base_delay_seconds = _bounded_float(
            "BARION_AI_PROVIDER_RETRY_BASE_DELAY_SECONDS", 1, 0, 60
        )
        retry_max_delay_seconds = _bounded_float(
            "BARION_AI_PROVIDER_RETRY_MAX_DELAY_SECONDS", 16, 0, 300
        )
        if retry_base_delay_seconds > retry_max_delay_seconds:
            raise GatewayError(
                "configuration_error",
                "BARION_AI_PROVIDER_RETRY_BASE_DELAY_SECONDS must not exceed BARION_AI_PROVIDER_RETRY_MAX_DELAY_SECONDS.",
                503,
            )
        provider_timeout_seconds = _bounded_float("BARION_AI_PROVIDER_TIMEOUT_SECONDS", 20, 1, 120)
        provider_max_attempts = _bounded_int("BARION_AI_PROVIDER_MAX_ATTEMPTS", 3, 1, 10)
        maximum_generation_seconds = (
            provider_timeout_seconds * provider_max_attempts
            + retry_max_delay_seconds * max(0, provider_max_attempts - 1)
        )
        if maximum_generation_seconds > MAX_CLIENT_GENERATION_DEADLINE_SECONDS - GATEWAY_COMPLETION_MARGIN_SECONDS:
            raise GatewayError(
                "configuration_error",
                "Provider timeout and retry settings must finish within the 120-second client generation deadline.",
                503,
            )
        issuer = f"{supabase_url}/auth/v1" if supabase_url else None
        return cls(
            auth_mode=auth_mode,
            auth_token=auth_token,
            supabase_issuer=issuer,
            supabase_jwks_url=f"{issuer}/.well-known/jwks.json" if issuer else None,
            jwt_audience=os.getenv("BARION_AI_JWT_AUDIENCE", "authenticated").strip() or "authenticated",
            max_access_token_lifetime_seconds=_bounded_int(
                "BARION_AI_MAX_ACCESS_TOKEN_LIFETIME_SECONDS", 3600, 300, 3600
            ),
            allowed_origins=allowed_origins,
            generation_provider=provider,
            generation_model=model,
            gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip() or None,
            provider_timeout_seconds=provider_timeout_seconds,
            provider_max_attempts=provider_max_attempts,
            provider_retry_base_delay_seconds=retry_base_delay_seconds,
            provider_retry_max_delay_seconds=retry_max_delay_seconds,
            max_request_bytes=_bounded_int("BARION_AI_MAX_REQUEST_BYTES", 300_000, 10_000, 2_000_000),
            max_input_characters=_bounded_int("BARION_AI_MAX_INPUT_CHARACTERS", 180_000, 10_000, 500_000),
        )


def _valid_supabase_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlsplit(value)
    return (
        parsed.scheme == "https"
        and bool(parsed.hostname)
        and not parsed.username
        and not parsed.password
        and not parsed.query
        and not parsed.fragment
        and parsed.path in {"", "/"}
    )


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as error:
        raise GatewayError("configuration_error", f"{name} must be an integer.", 503) from error
    if value < minimum or value > maximum:
        raise GatewayError("configuration_error", f"{name} must be between {minimum} and {maximum}.", 503)
    return value


def _bounded_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except ValueError as error:
        raise GatewayError("configuration_error", f"{name} must be numeric.", 503) from error
    if value < minimum or value > maximum:
        raise GatewayError("configuration_error", f"{name} must be between {minimum} and {maximum}.", 503)
    return value
