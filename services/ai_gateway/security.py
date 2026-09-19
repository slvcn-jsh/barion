from __future__ import annotations

import hmac
from collections import defaultdict, deque
from time import monotonic

from fastapi import Header, Request

from .errors import GatewayError


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


def require_gateway_token(expected: str):
    async def dependency(authorization: str | None = Header(default=None)) -> None:
        scheme, _, token = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not token or not hmac.compare_digest(token, expected):
            raise GatewayError("authentication_error", "Gateway authentication failed.", 401)

    return dependency


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
