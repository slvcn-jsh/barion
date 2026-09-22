from __future__ import annotations

import hashlib
import json
import re
from typing import Any

TOKEN = re.compile(r"[a-z0-9]+(?:['-][a-z0-9]+)?", re.I)
STOP = frozenset(
    "a an and are as at be been by can did do does for from had has have how in into is it its of on or "
    "that the their this to was were what when where which who why with".split()
)


def tokens(text: str) -> list[str]:
    return [token.lower() for token in TOKEN.findall(text) if len(token) > 2 and token.lower() not in STOP]


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
