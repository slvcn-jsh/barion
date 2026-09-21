from __future__ import annotations

import json
import os
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path

from .models import VerificationResult

CACHE_VERSION = "1.0.0"


class VerificationCache:
    def __init__(self, path: Path | None = None, *, now=lambda: datetime.now(timezone.utc)) -> None:
        self.path = path
        self._now = now
        self._entries: dict[str, dict[str, object]] = {}
        if path and path.is_file():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                if payload.get("cacheVersion") == CACHE_VERSION:
                    self._entries = dict(payload.get("entries", {}))
            except (OSError, ValueError, TypeError):
                self._entries = {}

    def get(self, key: str) -> VerificationResult | None:
        entry = self._entries.get(key)
        if not entry:
            return None
        try:
            expires = datetime.fromisoformat(str(entry["expiresAt"]))
            if expires <= self._now():
                return None
            value = VerificationResult(**dict(entry["result"]))
            return replace(value, fromCache=True)
        except (KeyError, TypeError, ValueError):
            return None

    def put(self, result: VerificationResult) -> None:
        if not result.cacheKey or not result.cacheExpiresAt:
            return
        self._entries[result.cacheKey] = {"expiresAt": result.cacheExpiresAt, "result": asdict(result)}
        if self.path:
            payload = {"cacheVersion": CACHE_VERSION, "entries": self._entries}
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(self.path.suffix + ".tmp")
            temporary.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
            os.replace(temporary, self.path)

    def invalidate(self, key: str) -> None:
        self._entries.pop(key, None)
