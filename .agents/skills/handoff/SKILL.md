---
name: handoff
description: Compress the active conversation into a clean, structured handoff document enabling a new chat session, a colleague, or future-you to resume work without losing decisions, constraints, or progress. Use when the user says "handoff", mentions hitting context limits, or asks to export where things stand.
department: workflow
ownerAgent: gandalf
triggerCommand: /handoff
antiPatternsPrevented:
  - AP-1
  - AP-6
  - AP-11
  - AP-18
  - AP-26
---

# Handoff

## 0. Identity

- **Role:** Principal Technical Project Manager and Context Handoff Architect. Compresses long working threads into a structured, actionable state snapshot so the next session or developer can resume immediately without relitigating settled questions.
- **Authority:** Owns the handoff document workflow. Cannot invent state; everything in the handoff must trace directly to the thread.
- **Must not define:** Direct application business logic; strictly governs session state preservation.
- **Normative base:** `core/fellowship/gandalf.md`, `core/fellowship/samwise.md`, `rules/engineering/architecture-boundaries.md`, and `references/anti-patterns.md`.

---

## 1. Intent (9 Dimensions)

| Dimension           | Specification                                                                                   |
| :------------------ | :---------------------------------------------------------------------------------------------- |
| Task Domain         | Session context compression and technical handoff generation.                                   |
| Execution Level     | Autonomous workflow protocol.                                                                   |
| Input Format        | Full conversation thread, file system state, and target recipient.                              |
| Output Format       | Structured Markdown handoff file saved to `docs/handoffs/`.                                     |
| Constraints         | State snapshot only; zero chronological narration. Every decision must carry its stated reason. |
| Validation          | Check output retains all single-mention constraints, verified file paths, and exact numbers.    |
| Tone and Style      | Terse, spartan, technical, and direct.                                                          |
| Fallback Strategy   | Emit Markdown code block if disk writes are unavailable.                                        |
| Escalation Criteria | Flag unverified file states explicitly rather than guessing.                                    |

---

## 2. Trigger Matrix

| Trigger                                            | Decision | Action                            |
| :------------------------------------------------- | :------- | :-------------------------------- |
| "Handoff / summarize thread to continue elsewhere" | YES      | Execute Handoff Workflow          |
| "Hitting context limits"                           | YES      | Execute Handoff Workflow          |
| "Brief a teammate / export where things stand"     | YES      | Execute Handoff Workflow          |
| General meeting summary                            | NO       | Excluded; not a state snapshot    |
| Changelog or progress report                       | NO       | Excluded; different document type |

---

## 3. Execution Workflow

### Step 1: Identify Target Recipient

- **Action:** Determine if this handoff is for a new AI session (needs exact constraints and opening prompt), a human colleague (needs clear business context), or future self.
- **Input:** Conversation context and user instruction.
- **Stop Condition:** Ask user if recipient type is ambiguous.
- **Validation:** Recipient profile confirmed before extraction.

### Step 2: Extract Decisions and Rationale

- **Action:** Mine the thread for technical and architectural decisions. Record each as `[decision]: [reason]`.
- **Input:** Full conversation transcript.
- **Stop Condition:** If a decision reason is missing, mark it "reason not stated" rather than inferring.
- **Validation:** Every decision listed carries its verified reason.

### Step 3: Extract Dead Ends and Rejected Approaches

- **Action:** List approaches tried and discarded, including specific reasons for rejection to prevent repeating mistakes.
- **Input:** Full conversation transcript.
- **Stop Condition:** None.
- **Validation:** Every discarded approach recorded with rationale.

### Step 4: Extract Constraints and User Corrections

- **Action:** Sweep for user corrections, stylistic preferences, and single-mention constraints.
- **Input:** Full conversation transcript.
- **Stop Condition:** Record verbatim rather than generalizing if scope is uncertain.
- **Validation:** Zero dropped corrections; zero dropped single-mention constraints.

### Step 5: Map Artifacts and Codebase State

- **Action:** Document every file produced or modified, its exact path, and its status (`completed`, `in-progress`, `pending`).
- **Input:** Conversation transcript and file system verification.
- **Stop Condition:** Mark "unverified" if file existence cannot be confirmed.
- **Validation:** Artifact inventory complete and paths verified.

### Step 6: Verify, Archive, and Register

- **Action:** Run a final verification scan to ensure zero dropped constraints. Write output to a new immutable snapshot file at `docs/handoffs/YYYY-MM-DD-<topic-slug>.md` and append a new row to the Master Handoff Index in `docs/handoffs/README.md`. Never overwrite existing handoff documents.
- **Input:** Draft handoff and thread context.
- **Stop Condition:** Correct any omissions before final delivery.
- **Validation:** Passes all validation gates; file created with date prefix; index updated.

---

## 4. Output Specification

Deliver as a new immutable Markdown file in `docs/handoffs/YYYY-MM-DD-<topic-slug>.md`:

```markdown
# Handoff: [Topic Name]

[Date] · [Single sentence summary of thread purpose]

## 1. Objective

[Target objective in 1-2 direct sentences]

## 2. Current State

[Exact state of the repository and ongoing work right now]

## 3. Key Decisions & Rationale

- [decision]: [reason]

## 4. Dead Ends (Do Not Retry)

- [approach]: [why it failed or was rejected]

## 5. Artifacts and File Changes

- [path]: [status - completed / in-progress / unverified]

## 6. Verbatim Essentials & Constraints

[Exact values, formulas, equity splits, approved naming patterns]

## 7. Working Preferences & Writing Rules

[Zero banned words, zero em dashes, zero Latin abbreviations, Caveman mode rules]

## 8. Open Items & Immediate Next Steps

- Next action: [Concrete next step]
- Blocked: [Item and what unblocks it]

## 9. Suggested Opening Prompt for Next Session

[Ready-to-paste opening prompt for the next AI session]
```

---

## 5. Validation Gate

- [ ] Recipient identified and content tailored appropriately
- [ ] Zero chronological narration; snapshot structure only
- [ ] Every decision carries its stated reason
- [ ] All rejected approaches listed with reasons
- [ ] Zero dropped corrections or single-mention constraints
- [ ] Artifact paths verified on disk
- [ ] Readable in under 3 minutes
