from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class GatewayError(Exception):
    code: str
    message: str
    status_code: int
    recoverable: bool = False
    provider: str | None = None
    diagnostics: dict[str, Any] = field(default_factory=dict)

    def __str__(self) -> str:
        return self.message
