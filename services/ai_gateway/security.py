from __future__ import annotations

import hmac
from collections import defaultdict, deque
from dataclasses import dataclass
from time import monotonic
from typing import Protocol
from uuid import UUID

import jwt
from fastapi import Header, Request
from jwt import PyJWKClient
from jwt.exceptions import InvalidTokenError, PyJWKClientError

from .errors import GatewayError


@dataclass(frozen=True, slots=True)
class GatewayIdentity:
    subject: str
    session_id: str
    role: str


class GatewayAuthenticator(Protocol):
    def authenticate(self, token: str) -> GatewayIdentity: ...


class StaticTokenAuthenticator:
    def __init__(self, expected_token: str) -> None:
        if not expected_token:
            raise GatewayError("configuration_error", "Static gateway token is required.", 503)
        self.expected_token = expected_token

    def authenticate(self, token: str) -> GatewayIdentity:
        if not hmac.compare_digest(token, self.expected_token):
            raise _authentication_error()
        return GatewayIdentity("local-development-client", "static-token", "development")


class SupabaseJWTAuthenticator:
    def __init__(
        self,
        issuer: str,
        audience: str,
        jwks_url: str,
        maximum_lifetime_seconds: int,
        jwk_client: PyJWKClient | None = None,
    ) -> None:
        self.issuer = issuer
        self.audience = audience
        self.maximum_lifetime_seconds = maximum_lifetime_seconds
        self.jwk_client = jwk_client or PyJWKClient(
            jwks_url,
            cache_keys=True,
            cache_jwk_set=True,
            lifespan=300,
            timeout=5,
        )

    def authenticate(self, token: str) -> GatewayIdentity:
        try:
            signing_key = self.jwk_client.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience=self.audience,
                issuer=self.issuer,
                leeway=30,
                options={"require": ["iss", "aud", "exp", "iat", "sub", "role", "aal", "session_id", "is_anonymous"]},
            )
            subject = _uuid_claim(claims, "sub")
            session_id = _uuid_claim(claims, "session_id")
            issued_at = claims["iat"]
            expires_at = claims["exp"]
            if not isinstance(issued_at, (int, float)) or not isinstance(expires_at, (int, float)):
                raise ValueError("Invalid token timestamps")
            if expires_at <= issued_at or expires_at - issued_at > self.maximum_lifetime_seconds:
                raise ValueError("Access token lifetime is not allowed")
            if claims["role"] != "authenticated" or claims["aal"] not in {"aal1", "aal2"}:
                raise ValueError("Access token role or assurance level is not allowed")
            if claims["is_anonymous"] is not False:
                raise ValueError("Anonymous access is not allowed")
            return GatewayIdentity(subject, session_id, claims["role"])
        except (InvalidTokenError, PyJWKClientError, KeyError, TypeError, ValueError):
            raise _authentication_error() from None


class InMemoryRateLimiter:
    def __init__(self, limit: int = 30, window_seconds: int = 60) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._requests: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = monotonic()
        timestamps = self._requests[key]
        while timestamps and timestamps[0] <= now - self.window_seconds:
            timestamps.popleft()
        if len(timestamps) >= self.limit:
            raise GatewayError("rate_limited", "Gateway request limit reached.", 429, True)
        timestamps.append(now)


def require_gateway_identity(authenticator: GatewayAuthenticator):
    async def dependency(request: Request, authorization: str | None = Header(default=None)) -> GatewayIdentity:
        scheme, _, token = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise _authentication_error()
        identity = authenticator.authenticate(token)
        request.app.state.rate_limiter.check(identity.subject)
        request.state.gateway_identity = identity
        return identity

    return dependency


def _uuid_claim(claims: dict[str, object], name: str) -> str:
    value = claims[name]
    if not isinstance(value, str):
        raise ValueError(f"Invalid {name}")
    UUID(value)
    return value


def _authentication_error() -> GatewayError:
    return GatewayError("authentication_error", "Gateway authentication failed.", 401)


async def enforce_body_limit(request: Request, maximum_bytes: int) -> None:
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > maximum_bytes:
                raise GatewayError("request_too_large", "Request payload is too large.", 413)
        except ValueError as error:
            raise GatewayError("invalid_request", "Invalid Content-Length header.", 400) from error

    body = await request.body()
    if len(body) > maximum_bytes:
        raise GatewayError("request_too_large", "Request payload is too large.", 413)
