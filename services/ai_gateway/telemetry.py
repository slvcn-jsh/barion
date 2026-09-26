from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from typing import Any

logger = logging.getLogger("barion.ai_gateway")


@dataclass(frozen=True, slots=True)
class TelemetryEvent:
    requestId: str
    operation: str
    provider: str
    model: str
    latencyMs: int
    success: bool
    inputTokens: int | None = None
    outputTokens: int | None = None
    candidateCount: int | None = None
    errorCategory: str | None = None
    diagnostics: dict[str, Any] | None = None


def record(event: TelemetryEvent) -> None:
    # Deliberately excludes prompts, source content, provider keys, and auth headers.
    message = json.dumps(asdict(event), separators=(",", ":"))
    if event.success:
        logger.info(message)
    else:
        logger.warning(message)
