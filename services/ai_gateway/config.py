from __future__ import annotations

import os
from dataclasses import dataclass

from .errors import GatewayError


@dataclass(frozen=True, slots=True)
class GatewaySettings:
    auth_token: str
    allowed_origins: tuple[str, ...]
    generation_provider: str
    generation_model: str
    gemini_api_key: str | None
    provider_timeout_seconds: float
    max_request_bytes: int
    max_input_characters: int

    @classmethod
    def from_env(cls) -> "GatewaySettings":
        auth_token = os.getenv("BARION_AI_GATEWAY_AUTH_TOKEN", "").strip()
        if not auth_token:
            raise GatewayError("configuration_error", "BARION_AI_GATEWAY_AUTH_TOKEN is required.", 503)

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
                "http://localhost:8081,http://127.0.0.1:8081",
            ).split(",")
            if origin.strip()
        )
        return cls(
            auth_token=auth_token,
            allowed_origins=allowed_origins,
            generation_provider=provider,
            generation_model=model,
            gemini_api_key=os.getenv("GEMINI_API_KEY", "").strip() or None,
            provider_timeout_seconds=_bounded_float("BARION_AI_PROVIDER_TIMEOUT_SECONDS", 30, 1, 120),
            max_request_bytes=_bounded_int("BARION_AI_MAX_REQUEST_BYTES", 300_000, 10_000, 2_000_000),
            max_input_characters=_bounded_int("BARION_AI_MAX_INPUT_CHARACTERS", 180_000, 10_000, 500_000),
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
