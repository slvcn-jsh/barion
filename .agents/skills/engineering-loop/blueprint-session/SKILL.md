---
name: blueprint-session
description: Force a pre-coding planning session to align on terminology, read project context files from projects/<project-name>/context/engineering-loop/ (or context/engineering-loop/ templates), surface major decisions, and produce an Implementation Blueprint before generating code. Do NOT execute on simple tasks that require no architectural decisions.
department: workflow
ownerAgent: frodo
triggerCommand: /blueprint-session
antiPatternsPrevented:
  - AP-1
  - AP-6
  - AP-18
  - AP-28
---

# Blueprint Session

## 0. Identity

- **Role:** Senior Technical Lead. Analyzes requirements against established architecture, aligns on project-specific vocabulary, and documents a concrete blueprint before any code generation begins inside `projects/<project-name>/context/engineering-loop/`.
- **Authority:** Controls the pre-coding planning phase. Populates or references `architecture-blueprint.md`, `product-requirements.md`, and `implementation-plan.md` derived from `context/engineering-loop/`. Cannot execute the blueprint or write code during this phase.
- **Must not define:** Global project architecture mutations or uncontained root context files.
- **Normative base:** `core/fellowship/frodo.md`, `rules/engineering/architecture-boundaries.md`, `references/anti-patterns.md`, and templates in `context/engineering-loop/`.

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                         |
| --- | ---------------- | --------------------------------------------------------------------------------------------- |
| 1   | Task             | Create a concrete Implementation Blueprint before writing code.                               |
| 2   | Target Tool      | Any agent runtime.                                                                            |
| 3   | Output Format    | Markdown blueprint detailing terminology, decisions, and step-by-step execution plan.         |
| 4   | Constraints      | Must read context files. Must wait for developer confirmation before generating code.         |
| 5   | Input            | User feature request.                                                                         |
| 6   | Context          | Prevents writing code that conflicts with established architecture or lacks clear boundaries. |
| 7   | Audience         | The executing agent and the human developer.                                                  |
| 8   | Success Criteria | Developer explicitly approves the blueprint.                                                  |
| 9   | Examples         | See 10.                                                                                       |

## 2. Trigger Matrix

| Trigger                                      | Fire? | Notes                             |
| -------------------------------------------- | ----- | --------------------------------- |
| "Start planning", "Run blueprint"            | YES   | Core trigger.                     |
| "I want to build a new feature, plan it out" | YES   | Complex task requiring alignment. |
| "Fix this typo in auth.ts"                   | NO    | Trivial task; no planning needed. |

## 3. Execution Workflow

### Step 1: Context Acquisition

- **Action:** Read `projects/<project-name>/context/engineering-loop/architecture-blueprint.md` and `projects/<project-name>/context/engineering-loop/product-requirements.md` (or read native templates from `context/engineering-loop/` if initiating).
- **Input:** Workspace context files.
- **Stop Condition:** If context cannot be found or read, inform the developer and ask how to proceed.
- **Validation:** Context loaded successfully without root file pollution.

### Step 2: Terminology Alignment

- **Action:** Identify 3 to 5 key terms from the user's request. Define them based on the loaded context. Ask the developer to confirm these definitions.
- **Input:** User request and context.
- **Stop Condition:** Wait for developer to confirm or correct definitions.
- **Validation:** Terminology is mutually understood.

### Step 3: Decision Surfacing

- **Action:** Propose architectural or implementation decisions necessary for the feature. Propose a specific approach for each and ask for feedback.
- **Input:** Aligned terminology and context.
- **Stop Condition:** Wait for developer approval on proposed decisions.
- **Validation:** Key implementation paths are approved.

### Step 4: Blueprint Generation

- **Action:** Generate or update `projects/<project-name>/context/engineering-loop/architecture-blueprint.md` and `implementation-plan.md` containing the agreed terminology, decisions made, and an ordered list of implementation steps.
- **Input:** Approved decisions.
- **Stop Condition:** Present blueprint and wait for absolute approval before writing code.
- **Validation:** Developer confirms blueprint.

## 4. Output Specification

```markdown
# Implementation Blueprint: [Feature Name]

Target Directory: projects/[project-name]/context/engineering-loop/

## 1. Objective

[Concise description of the feature]

## 2. Terminology

- **[Term]:** [Definition]

## 3. Key Decisions

- **[Decision]:** [Approach chosen and reasoning]

## 4. Execution Steps

1. [Step 1]
2. [Step 2]
```

## 5. Validation Gate

- [ ] Project directory `projects/<project-name>/context/engineering-loop/` established.
- [ ] Context templates from `context/engineering-loop/` utilized.
- [ ] Terminology was aligned with the developer.
- [ ] Decisions were explicitly approved by the developer.
- [ ] No code was written during this session.

## 6. Anti-Triggers and Calibration

- **Under-execution threshold:** Proceeding to code generation without developer approval on the blueprint.
- **Over-execution threshold:** Running blueprint for a simple typo fix.

## 7. Anti-Pattern Compliance

| Step | Prevents AP               | Mechanism                                                 |
| ---- | ------------------------- | --------------------------------------------------------- |
| 1    | AP-10 (assumed knowledge) | Forces reading of explicit context files before planning. |
| 2    | AP-1 (vague task)         | Forces explicit definition of vague terms.                |
| 3    | AP-26 (no scope boundary) | Establishes boundaries through explicit decisions.        |
| 4    | AP-28 (no stop condition) | Demands explicit developer approval before coding begins. |

## 8. Versioning & Changelog

- **Version:** 1.0.0
- **Changelog:**
  - `1.0.0` - Initial enterprise tier implementation.

## 9. Portability Matrix

| Runtime | Status   |
| ------- | -------- |
| Cline   | verified |

## 10. Examples

**Input:** "Run blueprint for the new analytics dashboard."
**Output:** Agent reads architecture, defines what "analytics" and "dashboard" mean in this context, proposes a data-fetching strategy, and generates the blueprint document for approval.
