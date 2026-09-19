from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class GatewayError(Exception):
    code: str
    message: str
    status_code: int
    recoverable: bool = False
    provider: str | None = None

    def __str__(self) -> str:
        return self.message
