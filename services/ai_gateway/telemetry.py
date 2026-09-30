from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from typing import Any

logger = logging.getLogger("barion.ai_gateway")
logger.setLevel(logging.INFO)


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
    policyId: str | None = None
    logicalModelId: str | None = None
    promptVersion: str | None = None
    schemaVersion: str | None = None
    policyConfiguration: dict[str, Any] | None = None
    errorCategory: str | None = None
    diagnostics: dict[str, Any] | None = None


def record(event: TelemetryEvent) -> None:
    # Deliberately excludes prompts, source content, provider keys, and auth headers.
    message = json.dumps(asdict(event), separators=(",", ":"))
    sink = _telemetry_sink()
    if event.success:
        sink.info(message)
    else:
        sink.warning(message)


def _telemetry_sink() -> logging.Logger:
    uvicorn_logger = logging.getLogger("uvicorn.error")
    return uvicorn_logger if uvicorn_logger.hasHandlers() else logger
