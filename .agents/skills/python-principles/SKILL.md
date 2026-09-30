---
name: python-principles
description: Framework-agnostic baseline standard for modern Python 3.10+ development, strict type hinting, virtual environment hygiene, async safety, and anti-malware defense.
origin: sauron
---

# Python Engineering Principles

Enforce idiomatic, type-safe, and secure Python engineering across applications, scripts, and libraries. Eliminate arbitrary dynamic execution, unpinned dependencies, and untrusted deserialization vulnerabilities.

## 0. Identity

- **Role:** Backend Engineering Specialist.
- **Authority:** Enforces backend architectural boundaries and runtime safety.
- **Must not define:** Frontend UI layout or client-side hydration routines.
- **Normative base:** `core/fellowship/frodo.md`, `rules/engineering/architecture-boundaries.md`, `rules/common/code-style-standards.md`, `references/anti-patterns.md`.

## When to Activate

- Creating, editing, or reviewing Python source files (`.py`, `.pyi`).
- Configuring Python build tools, virtual environments, and dependency managers (`uv`, `poetry`, `pip`, `pyproject.toml`).
- Designing domain models, service layers, async routines, and data pipelines.
- Auditing Python code for performance bottlenecks, type errors, or security vulnerabilities.

## Core Concepts

### 1. Modern Language Standards and Architecture

- Target Python 3.10 or newer exclusively. Utilize native union syntax (`X | Y` instead of `Union[X, Y]`) and structural pattern matching (`match / case`).
- Adopt `pyproject.toml` (PEP 621) as the singular configuration standard for package metadata, linters, and build settings. Discard legacy `setup.py` and `setup.cfg` configurations.
- Enforce strict static typing with Mypy or Pyright. Annotate every function parameter and return type explicitly.
- Separate business logic from framework adapters. Ensure core business models remain importable without web frameworks or ORMs present.

### 2. Dependency and Environment Hygiene

- Never install packages into global system Python environments. Mandate isolated virtual environments via `.venv` managed by `uv` or `poetry`.
- Pin all production dependencies using deterministic lockfiles (`uv.lock`, `poetry.lock`).
- Audit installed packages against known CVEs before merging code using automated scanners (`pip-audit`, `safety`).

### 3. Resource Management and Async Discipline

- Employ context managers (`with` and `async with`) for all resources requiring release (file handles, database transactions, network connections, thread locks).
- Avoid blocking calls inside `async def` routines. Offload CPU-intensive operations or synchronous filesystem IO to worker pools (`asyncio.to_thread`).
- Set explicit timeouts on all network requests (`httpx.Client(timeout=10.0)`, `requests.get(..., timeout=10.0)`). Never issue unbounded HTTP requests.

## Security and Anti-Malware Directives

1. **Prohibit Dynamic Code Execution:** Never invoke `eval()`, `exec()`, or `compile()` on dynamic or user-supplied strings. Dynamic evaluation constitutes a remote code execution vulnerability.
2. **Prohibit Insecure Deserialization:** Never use the `pickle` module to deserialize data from untrusted or network sources. Use typed JSON, Protocol Buffers, or MessagePack schemas validated through Pydantic.
3. **Safe Subprocess Invocation:** When invoking system processes using `subprocess.run()`, pass argument lists directly and set `shell=False`. Never execute commands with `shell=True` on interpolated strings to prevent shell injection.
4. **Path Traversal Protection:** Sanitize all incoming file paths using `pathlib.Path.resolve()`. Verify that the resolved target path begins with the intended base directory to prevent directory traversal attacks (`../../`).
5. **No Plaintext Credential Exposure:** Read credentials exclusively from verified environment variables. Never print, log, or persist raw credential dictionaries or system environment dumps.

## Code Examples

### Idiomatic Type-Safe Service Example

```python
"""User service implementation following Sauron Python principles."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import json


@dataclass(frozen=True, slots=True)
class UserRecord:
    """Immutable user entity representation."""
    user_id: str
    email: str
    is_active: bool
    created_at: datetime


class UserService:
    """Provides validated user profile management."""

    def __init__(self, storage_directory: Path) -> None:
        self._storage_directory = storage_directory.resolve()
        if not self._storage_directory.exists():
            self._storage_directory.mkdir(parents=True, exist_ok=True)

    def save_user(self, user: UserRecord) -> Path:
        """Saves user record to filesystem safely without path traversal."""
        # Sanitize filename to prevent directory traversal
        safe_filename = f"{user.user_id}.json"
        target_path = (self._storage_directory / safe_filename).resolve()

        # Enforce boundary containment check
        if not str(target_path).startswith(str(self._storage_directory)):
            raise ValueError(f"Illegal path traversal detected: {target_path}")

        payload = {
            "user_id": user.user_id,
            "email": user.email,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat(),
        }

        # Safe atomic write with UTF-8 encoding
        temp_path = target_path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temp_path.replace(target_path)
        return target_path
```

## Anti-Patterns

- **AP-14 (Leaking secrets):** Hardcoding API tokens or committing `.env` files into source repositories.
- **AP-41 (Unparameterized queries):** Formatting SQL queries with string concatenation instead of parameterized placeholders.
- **AP-44 (Phantom types):** Relying on raw untyped dictionaries instead of Pydantic models or typed Dataclasses.
- **AP-52 (Fake fix):** Suppressing Mypy errors with blanket `# type: ignore` or catching broad `Exception` with silent `pass`.

## Best Practices

- Format all Python code strictly using Ruff (`ruff format` and `ruff check`).
- Maintain 100 percent type annotation coverage for public modules.
- Ensure all test suites run hermetically in isolated pytest runners without mutating host machine state.

## Related Skills

- [docker-principles](file:///C:/Users/IGING/Documents/GitHub/sauron/skills/devops/docker-principles/SKILL.md)
- [security-audit](file:///C:/Users/IGING/Documents/GitHub/sauron/core/skills/security/security-audit.md)
- [backend-development](file:///C:/Users/IGING/Documents/GitHub/sauron/skills/backend/backend-development/SKILL.md)
