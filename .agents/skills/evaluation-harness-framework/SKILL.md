---
name: evaluation-harness-framework
description: Formal evaluation framework for autonomous agents implementing Eval-Driven Development (EDD), pass@k reliability metrics, code-based deterministic grading, and regression testing.
department: quality
ownerAgent: merry
triggerCommand: /evaluation-harness-framework
antiPatternsPrevented:
  - AP-1
  - AP-3
  - AP-9
  - AP-18
  - AP-28
  - AP-53
---

# Evaluation Harness Framework

## 0. Identity

- **Role:** Agent Reliability and Evaluation Specialist. Designs deterministic eval suites, capability test matrices, pass@k metrics, and regression test suites for autonomous AI agents.
- **Authority:** Normative tier-4 standard for agent evaluation under `skills/quality/evaluation-harness-framework/`.
- **Must not define:** Application UI components or database table schemas.
- **Normative base:** `core/fellowship/merry.md`, `rules/engineering/architecture-boundaries.md`, `rules/common/code-style-standards.md`, `references/anti-patterns.md`, `context/core-domains/testing-strategy.md`.
- **Anti-pattern gate:** Blocks AP-3 (unclear success criteria), AP-9 (declaring success without verified execution), and AP-53 (blind tool confidence).

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                                      |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Task             | Define, execute, and score automated capability and regression evals for AI agent workflows.               |
| 2   | Target Tool      | Sauron test suites, Jest, Vitest, Python pytest, Bash verification scripts, model graders.                 |
| 3   | Output Format    | Structured Eval Definitions, Pass/Fail Execution Logs, and pass@k Summary Reports.                         |
| 4   | Constraints      | Code-based deterministic grading preferred over subjective model grading. Always define evals before code. |
| 5   | Input            | Capability specifications, agent transcripts, expected code artifacts, regression test suites.             |
| 6   | Context          | Prevents silent capability drift, brittle prompt edits, and unreliable agent task completion.              |
| 7   | Audience         | Quality engineers, agent platform architects, autonomous workflow operators.                               |
| 8   | Success Criteria | 100 percent deterministic grading for code tasks; minimum pass@3 score of 90 percent on critical paths.    |
| 9   | Examples         | See Section 5.                                                                                             |

## 2. Trigger Matrix

| Trigger Condition                                                    | Fire? | Action / Route                                                                             |
| -------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------ |
| Designing acceptance criteria for complex autonomous agent workflows | YES   | Formulate Capability and Regression Evals.                                                 |
| Measuring agent consistency across repeated trials                   | YES   | Calculate pass@k and pass^k reliability metrics.                                           |
| Testing application business logic or backend endpoints              | NO    | Route to `skills/workflow/autonomous-dev/05-quality-and-testing/test-driven-development/`. |
| Running security audits or vulnerability scans                       | NO    | Route to `skills/security/security-auditor/`.                                              |

## 3. Core Architectural Directives

1. **Eval-Driven Development (EDD):** Define the evaluation criteria and grading logic before starting feature implementation. Evals serve as unit tests for AI agent behavior.
2. **Deterministic Code-Based Grading:** Prioritize exit-code and regex checks over probabilistic LLM-as-a-judge graders. If an outcome can be verified via command exit code or compiler check, do not use an LLM grader.
3. **Three-Tier Grader Hierarchy:**
   - **Tier 1 (Code Grader):** Automated Bash/Node/Python scripts checking test exit codes, schema validity, or file changes.
   - **Tier 2 (Model Grader):** Scored rubric (1 to 5) evaluating open-ended prose quality or architectural trade-offs.
   - **Tier 3 (Human Grader):** Explicit manual review gates for high-risk security or financial code paths.
4. **Reliability Metrics:**
   - `pass@k`: Probability of at least one success across k independent trials.
   - `pass^k`: Probability that all k consecutive trials succeed (mandatory for high-severity core operations).

## 4. Execution Workflow

### Step 1: Eval Definition

- **Action:** Author evaluation definition file containing capability criteria, regression baselines, and scoring metrics.
- **Stop Condition:** Halt if success criteria are subjective or lack measurable validation thresholds.
- **Validation:** Clear list of binary pass/fail checks defined.

### Step 2: Implementation Run

- **Action:** Agent executes the targeted engineering task against the workspace.
- **Validation:** Agent completes work and signals readiness for verification.

### Step 3: Automated Grading & Reporting

- **Action:** Trigger the evaluation harness scripts across multiple test iterations.
- **Validation:** Generate structured evaluation report with pass rates.

## 5. Reference Implementation

### Eval Definition and Automated Code Grader Template

````markdown
# Eval Definition: PostgreSQL Partitioning Migration

## 1. Capability Criteria

- [ ] Table partitioned into monthly range tables without data loss.
- [ ] Default partition exists to capture out-of-range records.
- [ ] Database queries targeting 'created_at' perform partition pruning.

## 2. Deterministic Code Graders

```bash
# Grader 1: Verify partition syntax in migration script
grep -q "PARTITION BY RANGE (created_at)" migrations/001_partition.sql \
  && echo "GRADER 1: PASS" || echo "GRADER 1: FAIL"

# Grader 2: Run migration and verify tables in test database
npm run migrate:test \
  && echo "GRADER 2: PASS" || echo "GRADER 2: FAIL"

# Grader 3: Run execution plan verification test
npm test -- tests/database/partition-pruning.test.ts \
  && echo "GRADER 3: PASS" || echo "GRADER 3: FAIL"
```
````

## 3. Evaluation Summary Report Format

```text
EVALUATION REPORT: PostgreSQL Partitioning Migration
===================================================
Trial 1: PASS (3/3 graders)
Trial 2: PASS (3/3 graders)
Trial 3: PASS (3/3 graders)

Reliability Score:
- pass@1: 100%
- pass^3: 100%

Status: VERIFIED FOR PRODUCTION PROMOTION
```

```

## 6. Validation Gate

Run before accepting an evaluation harness definition:

- [ ] Capability criteria are expressed as unambiguous binary checks.
- [ ] All code-based graders rely on deterministic shell exit codes or test runners.
- [ ] Evals include regression checks against existing baseline features.
- [ ] Reliability thresholds (pass@k) are established and enforced.

## 7. Versioning & Portability Matrix

- **Version:** 1.0.0
- **Changelog:**
  - `1.0.0` (2026-09-20): Created Sauron Tier-5 skill aligned with ECC eval-harness specifications.

| Runtime / Harness | Status | Notes |
|---|---|---|
| Claude Code | verified | Fully supported. |
| Cursor | verified | Tested with test runner. |
| Windsurf | verified | Fully supported. |
| Antigravity | verified | Certified. |
```
