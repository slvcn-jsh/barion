---
name: clean-architecture
description: Clean Architecture standards, layer isolation, the Dependency Rule, port and adapter boundaries, YAGNI guardrails, and progressive greenfield and brownfield adoption.
department: architecture
ownerAgent: gandalf
triggerCommand: /clean-architecture
antiPatternsPrevented:
  - AP-1
  - AP-4
  - AP-6
  - AP-18
  - AP-26
  - AP-28
---

# Clean Architecture

## 0. Identity

- **Role:** Master Software Architect. Enforces boundary encapsulation, inward-pointing dependency rules, domain entity purity, and decoupling from database engines and web frameworks.
- **Authority:** Normative tier-4 standard for system architecture across repositories under `skills/architecture/clean-architecture/`.
- **Must not define:** Direct database table schemas or client-side rendering components.
- **Normative base:** `core/fellowship/aragorn.md`, `rules/engineering/architecture-boundaries.md`, `rules/common/code-style-standards.md`, `references/anti-patterns.md`.
- **Anti-pattern gate:** Blocks AP-4 (framework leakage into domain), AP-6 (speculative architecture sprawl), and AP-26 (leaking request/response objects across layers).

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                                |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| 1   | Task             | Architect, review, and decouple software modules using Clean and Hexagonal Architecture principles.  |
| 2   | Target Tool      | TypeScript, Node.js, Go, Python, Java, Rust, distributed microservices.                              |
| 3   | Output Format    | Decoupled domain entities, use case interactors, port interfaces, and infrastructure adapters.       |
| 4   | Constraints      | Strict Dependency Rule: inner layers know nothing of outer layers. Zero framework imports in domain. |
| 5   | Input            | Product requirements, domain models, third-party integrations, database systems.                     |
| 6   | Context          | Prevents high-coupling maintenance traps, test fragility, and framework lock-in.                     |
| 7   | Audience         | Principal software engineers, backend architects, full-stack developers.                             |
| 8   | Success Criteria | 100 percent of domain logic unit-testable without database or web servers running.                   |
| 9   | Examples         | See Section 5.                                                                                       |

## 2. Trigger Matrix

| Trigger Condition                                                      | Fire? | Action / Route                                                        |
| ---------------------------------------------------------------------- | ----- | --------------------------------------------------------------------- |
| Designing new enterprise domain models or business use cases           | YES   | Enforce inward-pointing dependency rule and declare port interfaces.  |
| Refactoring legacy codebase where SQL/ORM is mixed with business logic | YES   | Extract pure domain entities; introduce repository boundary adapters. |
| Writing simple 20-line standalone utility script                       | NO    | Banish speculative abstraction; use simple procedural script.         |
| Standardizing public REST HTTP interfaces                              | NO    | Route to `skills/architecture/api-design/`.                           |

## 3. Core Architectural Directives

1. **The Dependency Rule:** Source code dependencies point strictly inward toward higher-level policies. The Domain layer depends on nothing. The Application layer depends only on the Domain. Interface Adapters depend on Application and Domain. Infrastructure depends on all inner layers.
2. **Framework Independence:** Web frameworks, ORMs, message queues, and UI libraries are external plugins. Business logic must execute and pass tests without an active HTTP server or database connection.
3. **Boundary Data Crossing:** Data crossing layer boundaries must use plain Data Transfer Objects (DTOs), primitive types, or immutable records. Never leak ORM entity models into domain use cases or domain entities into external API views.
4. **YAGNI Anti-Bloat Guardrails:** Do not create abstract interfaces when only one implementation will ever exist unless required for boundary inversion or testing. Never create empty placeholder directories.

## 4. Execution Workflow

### Step 1: Core Domain Entity Modeling

- **Action:** Implement business logic as pure functions and classes using language standard libraries only.
- **Stop Condition:** Halt if external web framework, database, or network SDKs are imported into domain files.
- **Validation:** Domain entities are testable in memory without mocks.

### Step 2: Port & Use Case Interactor Definition

- **Action:** Declare use-case interactors and primary/secondary port interfaces.
- **Validation:** Application use case depends exclusively on domain models and port abstractions.

### Step 3: Infrastructure Adapter Implementation

- **Action:** Implement repository and gateway adapters fulfilling the declared ports.
- **Validation:** Inversion of Control wires dependencies at application startup boundary.

## 5. Reference Implementation

### TypeScript (Hexagonal Architecture / Clean Architecture Example)

```typescript
// 1. DOMAIN LAYER (Zero external dependencies)
export interface OrderItem {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPriceCents: number;
}

export class Order {
  constructor(
    public readonly id: string,
    public readonly customerId: string,
    private readonly items: OrderItem[],
    private status: "PENDING" | "PAID" | "CANCELLED" = "PENDING",
  ) {
    if (items.length === 0) {
      throw new Error("An order must contain at least one line item");
    }
  }

  get totalCents(): number {
    return this.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceCents,
      0,
    );
  }

  markAsPaid(): void {
    if (this.status === "CANCELLED") {
      throw new Error("Cannot pay a cancelled order");
    }
    this.status = "PAID";
  }
}

// 2. APPLICATION LAYER (Ports & Use Cases)
export interface OrderRepositoryPort {
  findById(id: string): Promise<Order | null>;
  save(order: Order): Promise<void>;
}

export interface PaymentGatewayPort {
  charge(
    customerId: string,
    amountCents: number,
  ): Promise<{ success: boolean; transactionId: string }>;
}

export class PayOrderUseCase {
  constructor(
    private readonly orderRepo: OrderRepositoryPort,
    private readonly paymentGateway: PaymentGatewayPort,
  ) {}

  async execute(orderId: string): Promise<void> {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const chargeResult = await this.paymentGateway.charge(
      order.customerId,
      order.totalCents,
    );
    if (!chargeResult.success) {
      throw new Error("Payment processing declined");
    }

    order.markAsPaid();
    await this.orderRepo.save(order);
  }
}

// 3. INFRASTRUCTURE ADAPTER (Database Implementation)
export class PostgresOrderRepository implements OrderRepositoryPort {
  constructor(private readonly dbClient: any) {}

  async findById(id: string): Promise<Order | null> {
    const row = await this.dbClient.query(
      "SELECT * FROM orders WHERE id = $1",
      [id],
    );
    if (!row) return null;
    return new Order(row.id, row.customer_id, row.items, row.status);
  }

  async save(order: Order): Promise<void> {
    await this.dbClient.query(
      "INSERT INTO orders (id, customer_id, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET status = $3",
      [order.id, order.customerId, "PAID"],
    );
  }
}
```

## 6. Validation Gate

Run before accepting clean architecture implementations:

- [ ] Domain entity source files contain zero third-party framework or database imports.
- [ ] Dependencies strictly point inward toward higher-level domain policies.
- [ ] Use cases interact with infrastructure through declared port interfaces.
- [ ] Boundary crossings utilize plain DTOs or primitive values.
- [ ] Unit tests for domain and use cases run completely in memory without network or disk IO.

## 7. Versioning & Portability Matrix

- **Version:** 2.0.0
- **Changelog:**
  - `2.0.0` (2026-09-20): Elevated to Sauron Tier-5 specification with full Hexagonal port-and-adapter patterns.

| Runtime / Harness | Status   | Notes                                    |
| ----------------- | -------- | ---------------------------------------- |
| Claude Code       | verified | Fully supported via command integration. |
| Cursor            | verified | Compatible with editor rule context.     |
| Windsurf          | verified | Fully functional.                        |
| Antigravity       | verified | Certified.                               |
