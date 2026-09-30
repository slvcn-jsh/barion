---
name: git-reconciler
description: Automated git merge conflict reconciliation, three-way diff inspection, structural conflict resolution, and non-destructive branch re-alignment.
origin: sauron
---

# Git Reconciler: Conflict Resolution Engine

Resolve git merge conflicts safely without destroying teammate contributions or introducing silent regression errors. Parse three-way diff markers, isolate conflicting AST nodes, and verify test suites before finalizing merges.

## When to Activate

- Encountering merge conflicts during git merge, pull, or rebase operations.
- Reconciling concurrent branch edits on shared configuration files or schemas.
- Resolving conflicting package lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `uv.lock`).
- Invoking the automated conflict resolver via `/reconcile-conflicts`.

## Core Concepts

### 1. Three-Way Diff Analysis Protocol

Merge conflict markers delineate three distinct code versions:

```text
<<<<<<< HEAD (Ours: Current branch state)
ourChanges();
||||||| base (Common ancestor state)
originalBase();
=======
theirChanges();
>>>>>>> feature-branch (Theirs: Incoming branch state)
```

1. **Inspect Ancestor Base:** Identify the original intent of both branches relative to the common ancestor commit.
2. **Intent Preserving Synthesis:** Whenever both branches introduced non-conflicting enhancements to the same block, synthesize both changes rather than discarding either side.
3. **Lockfile Protocol:** Never resolve package lockfile conflicts manually. Check out the lockfile from the target branch and regenerate it deterministically (`npm install --package-lock-only`, `pnpm install`, or `uv lock`).

### 2. Verification Gate Before Commit

Never conclude a merge resolution without running the full test and lint suite:

1. Parse all files to ensure zero conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) remain.
2. Run type checker (`npx tsc`, `mypy`, `cargo check`).
3. Run test runner (`npm test`, `pytest`).
4. Stage resolved files and create merge commit.

## Code Examples

### Conflict Marker Verification Script

```bash
#!/usr/bin/env bash
set -euo pipefail

# Scan repository for lingering conflict markers
CONFLICT_FILES=$(git grep -E -l '^(<{7}|={7}|>{7})' || true)

if [ -n "${CONFLICT_FILES}" ]; then
  printf "[ERROR] Unresolved merge conflict markers detected in:\n%s\n" "${CONFLICT_FILES}" >&2
  exit 1
fi

printf "[SUCCESS] Zero conflict markers detected. Running verification tests...\n"
npm test
```

## Anti-Patterns

- **AP-17 (Skipping tests):** Committing merge conflict resolutions without executing tests.
- **AP-18 (Non-atomic commit):** Bundling feature modifications into a conflict resolution commit.
- **AP-52 (Fake fix):** Deleting incoming teammate code entirely to silence merge conflicts.

## Related Skills

- [conventional-commit](file:///C:/Users/IGING/Documents/GitHub/sauron/core/skills/devsecops/conventional-commit.md)
- [agent-guard](file:///C:/Users/IGING/Documents/GitHub/sauron/skills/security/agent-guard/SKILL.md)
- [samwise](file:///C:/Users/IGING/Documents/GitHub/sauron/core/fellowship/samwise.md)
