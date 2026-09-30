---
name: agent-introspection-debugging
description: Structured self-debugging workflow for autonomous agents covering failure state capture, context pressure analysis, root-cause diagnosis, and contained recovery.
department: workflow
ownerAgent: gandalf
triggerCommand: /agent-introspection-debugging
antiPatternsPrevented:
  - AP-1
  - AP-4
  - AP-18
  - AP-26
  - AP-28
  - AP-53
---

# Agent Introspection Debugging

## 0. Identity

- **Role:** Autonomous Agent Diagnostics and Introspection Specialist. Investigates recursive tool loops, context window degradation, token burnout, and state mismatches before executing contained recoveries.
- **Authority:** Normative tier-4 standard under `skills/workflow/agent-introspection-debugging/`.
- **Must not define:** General code refactoring or external infrastructure provisioning.
- **Normative base:** `core/fellowship/gandalf.md`, `rules/engineering/architecture-boundaries.md`, and `references/anti-patterns.md`.
- **Anti-pattern gate:** Blocks AP-28 (unbounded loops), AP-53 (blind tool execution without verification), and AP-4 (over-permissive execution).

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                      |
| --- | ---------------- | ------------------------------------------------------------------------------------------ |
| 1   | Task             | Intercept and diagnose agent task failures, infinite loops, and token exhaustion.          |
| 2   | Target Tool      | Autonomous agents across Claude Code, Codex, Cursor, Windsurf, and Antigravity.            |
| 3   | Output Format    | Structured Failure Capture blocks, Diagnosis findings, and Contained Recovery action logs. |
| 4   | Constraints      | Banish blind retries. Require single-action hypotheses before modifying environment.       |
| 5   | Input            | Execution transcripts, tool call history, error traces, working directory state.           |
| 6   | Context          | Prevents runaway token burn, catastrophic hallucinated edits, and state desynchronization. |
| 7   | Audience         | Autonomous agents, human operators, debugging subagents.                                   |
| 8   | Success Criteria | Deterministic root cause identified in under 2 iterations; zero repetitive tool loops.     |
| 9   | Examples         | See Section 5.                                                                             |

## 2. Trigger Matrix

| Trigger Condition                                           | Fire? | Action / Route                                                                             |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| Agent hits maximum tool calls or loops on same command      | YES   | Activate Phase 1 Failure Capture immediately.                                              |
| Context overflow or degraded reasoning observed             | YES   | Prune low-signal bulk context; re-anchor goals.                                            |
| Service timeout (ECONNREFUSED) or 429 quota exhaustion      | YES   | Diagnose service health or apply exponential backoff.                                      |
| Standard application unit test failure during feature build | NO    | Route to `skills/workflow/autonomous-dev/05-quality-and-testing/test-driven-development/`. |
| General codebase security scan                              | NO    | Route to `skills/security/security-auditor/`.                                              |

## 3. Core Architectural Directives

1. **Banish Blind Retries:** Never repeat a failed tool invocation with identical parameters. Each retry must be preceded by an explicit state verification check.
2. **Four-Phase Diagnosis Protocol:**
   - **Phase 1: Failure Capture:** Record exact error message, stack trace, tool call sequence, and environment assumptions.
   - **Phase 2: Root-Cause Diagnosis:** Match observed pattern against known failure classes (Tool loop, Context overflow, Network fault, File system drift).
   - **Phase 3: Contained Recovery:** Execute the smallest reversible action that tests the diagnosis hypothesis.
   - **Phase 4: Introspection Report:** Summarize root cause, corrective intervention, and prevention directives.
3. **Context Trimming Discipline:** When context approaches saturation thresholds, eliminate duplicate command outputs and dead-end transcripts while preserving active goals and file paths.
4. **World State Grounding:** Verify file existence, git branch, and active processes via direct shell observations rather than relying on session memory.

## 4. Execution Workflow

### Step 1: Failure Capture

- **Action:** Record the failing command, error payload, and the last three tool operations.
- **Stop Condition:** Halt if failure details cannot be determined; query operator for logs.
- **Validation:** Failure capture block populated with concrete data.

### Step 2: Root-Cause Classification

- **Action:** Compare symptoms against diagnostic taxonomy:
  - Repeated identical tool calls: Observer loop or missing exit criteria.
  - Degraded reasoning: Excessive low-signal context.
  - File missing after write: Working directory mismatch or branch desynchronization.
- **Validation:** Single crisp root-cause hypothesis formulated.

### Step 3: Contained Action and Recovery

- **Action:** Execute a single minimal check (for example `git status` or path verification) to validate the hypothesis.
- **Validation:** Verification check confirms root cause before proceeding with fixes.

## 5. Reference Implementation

### Structured Self-Debug and Introspection Templates

```markdown
## Failure Capture

- Session / Task: Order fulfillment API migration
- Goal in progress: Add database transaction wrapper to checkout service
- Error: FileNotFoundError: [Errno 2] No such file or directory: 'src/services/checkout.ts'
- Last successful step: Read schema definitions in 'src/db/schema.ts'
- Last failed tool / command: view_file on 'src/services/checkout.ts'
- Repeated pattern seen: None (first occurrence)
- Environment assumptions to verify: Current working directory and file path location

## Root Cause Diagnosis

- Observed symptom: Target file path does not exist at expected relative location.
- Hypothesis: File resides under 'src/modules/checkout/checkout.service.ts' per modular organization.
- Discriminating check: Run glob search for '_checkout_' across the repository.

## Recovery Action

- Smallest action taken: Executed directory listing to verify true path.
- Result: Confirmed path is 'src/modules/checkout/checkout.service.ts'.
- Resolution: Resumed inspection with corrected path.
```

## 6. Validation Gate

Run before marking self-debug resolution complete:

- [ ] Exact error message and failing step recorded in Failure Capture.
- [ ] Root cause classified without speculative guessing.
- [ ] Direct file system or process observation executed to verify state.
- [ ] Zero unverified blind retries performed.
- [ ] Introspection report delivers actionable prevention guidance for future sessions.

## 7. Versioning & Portability Matrix

- **Version:** 1.0.0
- **Changelog:**
  - `1.0.0` (2026-09-20): Created Sauron Tier-5 skill aligned with ECC agent-introspection-debugging patterns.

| Runtime / Harness | Status   | Notes                   |
| ----------------- | -------- | ----------------------- |
| Claude Code       | verified | Native diagnostic loop. |
| Cursor            | verified | Fully supported.        |
| Windsurf          | verified | Fully supported.        |
| Antigravity       | verified | Certified.              |
