---
name: testing-principles
description: Testing pyramid architecture, unit test isolation, integration test transaction rollbacks, Playwright Page Object Models, flakiness elimination, and CI test runner gates.
department: quality
ownerAgent: merry
triggerCommand: /testing-principles
antiPatternsPrevented:
  - AP-1
  - AP-3
  - AP-9
  - AP-16
  - AP-18
  - AP-28
---

# Testing Principles & Reliability Architecture

## 0. Identity

- **Role:** Principal Test Architect and Quality Engineer. Governs the testing pyramid, unit test isolation, database transaction rollbacks, Page Object Model (POM) patterns, and automated CI test gates.
- **Authority:** Normative tier-4 standard for automated testing across repositories under `skills/quality/testing-principles/`.
- **Must not define:** Application UI styles or backend persistence schemas.
- **Normative base:** `core/fellowship/merry.md`, `rules/engineering/architecture-boundaries.md`, `rules/common/code-style-standards.md`, `references/anti-patterns.md`, `context/core-domains/testing-strategy.md`.
- **Anti-pattern gate:** Blocks AP-1 (unbounded test suites), AP-9 (declaring success without verification), and AP-16 (leaking shared state between test runs).

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                                |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Task             | Architect, structure, and enforce test suites across Unit, Integration, and End-to-End layers.       |
| 2   | Target Tool      | Vitest, Jest, Playwright, Testcontainers, Supertest, React Testing Library.                          |
| 3   | Output Format    | Deterministic test specs, fixture factories, and CI test execution configurations.                   |
| 4   | Constraints      | 70/20/10 Testing Pyramid. Zero arbitrary timeouts (use auto-retry locators). Zero state bleeding.    |
| 5   | Input            | Feature requirements, API contracts, domain entities, user workflows.                                |
| 6   | Context          | Prevents flaky builds, untestable monolithic code, regression escapes, and slow CI feedback loops.   |
| 7   | Audience         | Software development engineers in test (SDET), developers, QA leads, release managers.               |
| 8   | Success Criteria | 80 percent plus critical path coverage; sub-10ms unit test execution; zero flaky test retries in CI. |
| 9   | Examples         | See Section 5.                                                                                       |

## 2. Trigger Matrix

| Trigger Condition                                            | Fire? | Action / Route                                                       |
| ------------------------------------------------------------ | ----- | -------------------------------------------------------------------- |
| Writing or structuring unit, integration, or E2E test suites | YES   | Apply Testing Pyramid allocation and Arrange-Act-Assert structure.   |
| Test suite exhibits flakiness or non-deterministic failures  | YES   | Quarantine test, replace arbitrary waits with auto-retry assertions. |
| Authoring specific test files or mock fixtures               | NO    | Route to `skills/quality/write-a-test/`.                             |
| Running formal evaluation harnesses on AI agent transcripts  | NO    | Route to `skills/quality/evaluation-harness-framework/`.             |

## 3. Core Architectural Directives

1. **The 70/20/10 Testing Pyramid:**
   - **Unit Tests (70 percent):** Fast, in-memory tests verifying pure domain functions and components in isolation. Zero disk or network I/O.
   - **Integration Tests (20 percent):** Test interactions between service layers, repositories, and databases. Wrap DB operations in rollback transactions.
   - **End-to-End Tests (10 percent):** Verify critical user journeys (authentication, checkout) in headless browsers using Playwright.
2. **Strict Test Isolation:** Each test must run in complete isolation. Never rely on state left behind by a previous test. Use test factories rather than shared global fixtures.
3. **Arrange-Act-Assert (AAA) Discipline:** Structure test cases into three visible blocks: Arrange (setup), Act (execution), and Assert (verification). Test exactly one logical concept per test case.
4. **Zero Arbitrary Timeouts:** Never write `page.waitForTimeout(5000)` or `sleep(2)`. Rely on auto-retrying assertions (`await expect(locator).toBeVisible()`) or explicit event responses (`page.waitForResponse(...)`).
5. **Mock What You Do Not Own:** Mock external third-party APIs (Stripe, Twilio, external OAuth providers). Do not mock internal domain business logic or database repositories in integration tests.

## 4. Execution Workflow

### Step 1: Layer Assignment

- **Action:** Classify requirement into Unit, Integration, or E2E layer.
- **Stop Condition:** Halt if UI components are being spun up to test pure calculation formulas.
- **Validation:** Test assigned to lowest viable layer in the pyramid.

### Step 2: Isolation & Data Preparation

- **Action:** Formulate localized test data using factory functions.
- **Validation:** Running test in random order produces identical results.

### Step 3: Assertion Verification

- **Action:** Verify assertions target user-visible behavior rather than internal private variables.
- **Validation:** Test fails cleanly when business logic is inverted.

## 5. Reference Implementation

### TypeScript (Isolated Unit Test & Integration Transaction Rollback Pattern)

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { OrderService } from "@/services/order.service";
import { TestDatabase } from "@/tests/test-db";

// UNIT TEST: Pure Domain Logic Isolation
describe("OrderService Unit Tests", () => {
  it("calculates total price including discount and sales tax", () => {
    // Arrange
    const items = [
      { productId: "prod-1", quantity: 2, unitPriceCents: 1000 },
      { productId: "prod-2", quantity: 1, unitPriceCents: 3000 },
    ];
    const discountCents = 500;
    const taxRate = 0.1;

    // Act
    const total = OrderService.computeTotal({ items, discountCents, taxRate });

    // Assert: (5000 - 500) * 1.10 = 4950
    expect(total).toBe(4950);
  });
});

// INTEGRATION TEST: Database Transaction Rollback Pattern
describe("OrderRepository Integration Tests", () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await TestDatabase.startTransaction();
  });

  afterEach(async () => {
    await db.rollback(); // Guarantees zero persistent state leakage
  });

  it("persists order record atomically", async () => {
    const repo = db.getOrderRepository();
    const orderId = await repo.createOrder({
      customerId: "cust-1",
      totalCents: 4950,
    });

    const fetched = await repo.findById(orderId);
    expect(fetched).not.toBeNull();
    expect(fetched?.totalCents).toBe(4950);
  });
});
```

## 6. Validation Gate

Run before accepting test suite changes:

- [ ] Suite maintains the 70/20/10 pyramid distribution.
- [ ] Tests execute independently without state bleeding across cases.
- [ ] Zero arbitrary sleep or timeout statements exist in test files.
- [ ] UI assertions utilize semantic user-facing locators (`getByRole`).
- [ ] Integration tests roll back database state upon completion.

## 7. Versioning & Portability Matrix

- **Version:** 2.0.0
- **Changelog:**
  - `2.0.0` (2026-09-20): Elevated to Sauron Tier-5 specification with Testing Pyramid allocation and transaction rollback patterns.

| Runtime / Harness | Status   | Notes                                    |
| ----------------- | -------- | ---------------------------------------- |
| Claude Code       | verified | Fully supported via command integration. |
| Cursor            | verified | Compatible with editor rule context.     |
| Windsurf          | verified | Fully functional.                        |
| Antigravity       | verified | Certified.                               |
