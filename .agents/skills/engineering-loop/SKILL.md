---
name: engineering-loop
description: Autonomous 5-stage engineering loop orchestrator dispatching blueprinting, UI tokens, code inspection, checkpointing, and triage.
department: workflow
ownerAgent: frodo
triggerCommand: /engineering-loop
antiPatternsPrevented:
  - AP-1
  - AP-4
  - AP-18
  - AP-26
  - AP-28
---

# Engineering Loop Lifecycle Dispatcher

## 0. Identity

- **Role:** Chief Engineering Loop Orchestrator. Sequences the 5-stage software engineering loop across pre-coding blueprinting, UI token extraction, code inspection, context checkpointing, and failure triage inside `projects/<project-name>/context/engineering-loop/`.
- **Authority:** Normative group orchestrator for `skills/workflow/engineering-loop/`. Manages execution lifecycle and context generation from templates in `context/engineering-loop/`.
- **Must not define:** Direct implementation code or individual stage rules; delegates execution sequentially to loop sub-skills.
- **Normative base:** `core/fellowship/frodo.md`, `rules/engineering/architecture-boundaries.md`, `references/anti-patterns.md`, and templates in `context/engineering-loop/`.

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                                                                            |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Task             | Sequence and dispatch engineering requests across the 5 stages of the engineering loop into `projects/<project-name>/context/engineering-loop/`. |
| 2   | Target Tool      | Any agent runtime: Claude Code, Cursor, Copilot, Windsurf, Kiro, Cline, raw API.                                                                 |
| 3   | Output Format    | Structured routing decision and execution handoff to stage sub-skills, saving artifacts in project-scoped context folder.                        |
| 4   | Constraints      | Router executes no stage tasks directly. Always enforce pre-coding blueprinting before execution. Zero root clutter.                             |
| 5   | Input            | User feature request, UI specification, code change, or failure diagnosis task; native templates from `context/engineering-loop/`.               |
| 6   | Context          | Prevents architectural drift, uninspected code, root sprawl, and unrecoverable session states (AP-1, AP-4, AP-18, AP-26, AP-42, AP-44).          |
| 7   | Audience         | Autonomous developer agents and software engineers.                                                                                              |
| 8   | Success Criteria | Clean transitions between stages with explicit developer confirmation and isolated project context artifacts.                                    |
| 9   | Examples         | See Section 10.                                                                                                                                  |

## 2. Trigger Matrix

| Stage   | Name               | Trigger                                              | Target Skill File Path                                         |
| ------- | ------------------ | ---------------------------------------------------- | -------------------------------------------------------------- |
| Stage 1 | Blueprint Session  | Feature planning, pre-coding architectural alignment | `skills/workflow/engineering-loop/blueprint-session/SKILL.md`  |
| Stage 2 | UI Snapshot Tokens | Visual design translation, UI token extraction       | `skills/workflow/engineering-loop/ui-snapshot-tokens/SKILL.md` |
| Stage 3 | Code Inspection    | Code audit against blueprint, quality review         | `skills/workflow/engineering-loop/code-inspection/SKILL.md`    |
| Stage 4 | Context Checkpoint | Long-running session state save and restore          | `skills/workflow/engineering-loop/context-checkpoint/SKILL.md` |
| Stage 5 | Failure Triage     | Build failures, runtime error diagnosis, flaky tests | `skills/workflow/engineering-loop/failure-triage/SKILL.md`     |

## 3. Execution Workflow

### Step 1: Determine Current Engineering Phase

- **Action:** Assess workspace state and incoming request to identify current stage.
- **Input:** User prompt and workspace context.
- **Validation:** Matches an entry in the Trigger Matrix.

### Step 2: Handoff to Stage Skill

- **Action:** Hand off execution to the corresponding stage `SKILL.md`.
- **Validation:** Stage pre-conditions satisfied.

### Step 3: Verify Stage Completion Gate

- **Action:** Ensure stage verification criteria are met before advancing to next stage.
- **Validation:** Stage checklist signed off.

## 4. Anti-Patterns Enforced

- **AP-1 (Vague task verb):** Rejects ambiguous tasks without clear stage mapping.
- **AP-4 (Over-permissive action):** Enforces explicit developer confirmation before executing destructive changes.
- **AP-18 (Over-reliance on internal state):** Persists session state via Context Checkpoint.
- **AP-26 (No scope boundary):** Isolates each stage within strict authority limits.
- **AP-28 (No stop condition):** Defines deterministic completion gates for every stage.
