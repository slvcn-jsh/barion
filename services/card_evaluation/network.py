from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx


class SecureRetrievalError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class RetrievalLimits:
    timeoutSeconds: float = 8.0
    maximumBytes: int = 1_500_000
    allowedContentTypes: tuple[str, ...] = ("application/json", "application/xml", "text/xml")


class AllowlistedHttpClient:
    """HTTP client that accepts adapter-built URLs only and rejects unsafe destinations."""

    def __init__(self, allowed_hosts: tuple[str, ...], limits: RetrievalLimits = RetrievalLimits(),
                 transport: httpx.BaseTransport | None = None, resolver=socket.getaddrinfo) -> None:
        self.allowed_hosts = frozenset(host.lower() for host in allowed_hosts)
        self.limits = limits
        self._resolver = resolver
        self._client = httpx.Client(timeout=limits.timeoutSeconds, follow_redirects=False, transport=transport)

    def close(self) -> None:
        self._client.close()

    def get(self, url: str) -> bytes:
        self._validate_url(url)
        try:
            with self._client.stream("GET", url, headers={"Accept": ", ".join(self.limits.allowedContentTypes)}) as response:
                if 300 <= response.status_code < 400:
                    raise SecureRetrievalError("Authority redirect rejected.")
                response.raise_for_status()
                content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
                if content_type not in self.limits.allowedContentTypes:
                    raise SecureRetrievalError("Authority response content type rejected.")
                chunks: list[bytes] = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > self.limits.maximumBytes:
                        raise SecureRetrievalError("Authority response exceeds size limit.")
                    chunks.append(chunk)
                return b"".join(chunks)
        except httpx.TimeoutException as error:
            raise SecureRetrievalError("Authority request timed out.") from error
        except httpx.HTTPError as error:
            raise SecureRetrievalError("Authority request failed.") from error

    def _validate_url(self, url: str) -> None:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or host not in self.allowed_hosts or parsed.username or parsed.password:
            raise SecureRetrievalError("Authority URL rejected.")
        if parsed.port not in {None, 443} or parsed.fragment:
            raise SecureRetrievalError("Authority URL rejected.")
        try:
            addresses = {item[4][0] for item in self._resolver(host, 443, type=socket.SOCK_STREAM)}
        except OSError as error:
            raise SecureRetrievalError("Authority host resolution failed.") from error
        if not addresses or any(_unsafe_address(value) for value in addresses):
            raise SecureRetrievalError("Authority host resolved to unsafe network.")


def _unsafe_address(value: str) -> bool:
    address = ipaddress.ip_address(value)
    return not address.is_global
