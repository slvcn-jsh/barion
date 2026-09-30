---
name: database-principles
description: Database architecture standards for relational schema design, 3NF normalization, index optimization, zero-downtime expand-contract migrations, and ACID transaction boundaries.
department: backend
ownerAgent: frodo
triggerCommand: /database-principles
antiPatternsPrevented:
  - AP-1
  - AP-4
  - AP-18
  - AP-26
  - AP-28
---

# Database Principles & Persistence Architecture

## 0. Identity

- **Role:** Principal Database Architect. Governs relational schema normalization, non-blocking indexing strategies, ACID transaction boundaries, connection pooling formulas, and zero-downtime expand-contract migrations.
- **Authority:** Normative tier-4 standard for database persistence under `skills/backend/database-principles/`.
- **Must not define:** Application UI components or frontend client routing.
- **Normative base:** `core/fellowship/frodo.md`, `rules/engineering/architecture-boundaries.md`, `rules/common/code-style-standards.md`, `references/anti-patterns.md`.
- **Anti-pattern gate:** Blocks AP-1 (unindexed foreign keys), AP-4 (unverified destructive DDL), and AP-18 (full table scan queries).

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                                      |
| --- | ---------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Task             | Architect, optimize, and safely migrate relational and NoSQL database schemas and queries.                 |
| 2   | Target Tool      | PostgreSQL, MySQL, SQLite, MongoDB, Redis, Prisma, Drizzle, Flyway, pg_stat_statements.                    |
| 3   | Output Format    | Normalized schema DDL, composite indexes, atomic transaction blocks, and migration scripts.                |
| 4   | Constraints      | Mandatory non-null defaults. Non-blocking concurrent indexing. Zero table locking during migrations.       |
| 5   | Input            | Entity relationship models, query traffic patterns, read/write workloads, SLA latency goals.               |
| 6   | Context          | Prevents database deadlocks, connection exhaustion, slow query saturation, and data corruption.            |
| 7   | Audience         | Database administrators, backend engineers, distributed systems leads.                                     |
| 8   | Success Criteria | p99 query latency under 10ms; zero full table scans on large tables; 100 percent zero-downtime migrations. |
| 9   | Examples         | See Section 5.                                                                                             |

## 2. Trigger Matrix

| Trigger Condition                                                      | Fire? | Action / Route                                                   |
| ---------------------------------------------------------------------- | ----- | ---------------------------------------------------------------- |
| Designing new database tables, foreign keys, or relational constraints | YES   | Apply 3NF normalization baseline and index foreign keys.         |
| Adding indexes to production tables exceeding 50,000 rows              | YES   | Enforce non-blocking concurrent DDL (CREATE INDEX CONCURRENTLY). |
| Executing breaking schema changes (renaming, splitting columns)        | YES   | Implement Expand-Contract parallel write migration pattern.      |
| Configuring application in-memory cache-aside layers                   | NO    | Route to `skills/backend/caching-principles/`.                   |

## 3. Core Architectural Directives

1. **Schema Normalization Baseline:** Design relational schemas to 3rd Normal Form (3NF) to eliminate anomalies and redundancy. Denormalize only when verified read bottlenecks demand precomputed views or materialized aggregates.
2. **Deterministic Indexing Hierarchy:**
   - Always index foreign key columns to prevent cascade locking deadlocks.
   - For composite indexes, follow the Leftmost Prefix Rule: equality predicates first, range predicates second, and sort keys third.
   - Use partial or covering indexes (`CREATE INDEX ... ON orders (customer_id) INCLUDE (total_cents) WHERE status = 'ACTIVE'`) to enable Index-Only Scans.
3. **Non-Blocking DDL Operations:** Never execute table-locking DDL on production tables. In PostgreSQL, use `CREATE INDEX CONCURRENTLY` and `ALTER TABLE ... VALIDATE CONSTRAINT` across split migration steps.
4. **Expand-Contract Migration Pattern:**
   - **Phase 1 (Expand):** Add the new column or table without removing the old one.
   - **Phase 2 (Dual Write):** Update backend code to write to both old and new columns, reading from the old.
   - **Phase 3 (Backfill):** Backfill historical data in bounded batches.
   - **Phase 4 (Read Switch):** Update code to read from the new column.
   - **Phase 5 (Contract):** Deprecate and drop the old column safely.
5. **Connection Pool Scaling Formula:** Size database connection pools scientifically:
   `Pool Size = (CPU Cores * 2) + Effective Spindle / Disk Count`. Avoid oversized pools that cause CPU context switching and lock contention.

## 4. Execution Workflow

### Step 1: Normalization & Constraint Design

- **Action:** Define tables with explicit `NOT NULL` constraints, foreign keys, and surrogate keys (UUIDv7 or ULID for time-ordered locality).
- **Validation:** Every entity relationship has an explicit cascade policy (`ON DELETE RESTRICT` or `CASCADE`).

### Step 2: Query Plan Inspection

- **Action:** Run `EXPLAIN (ANALYZE, BUFFERS)` on critical query paths.
- **Validation:** Query execution plan verifies index scans; zero sequential table scans appear on tables over 10,000 records.

### Step 3: Migration Safety Verification

- **Action:** Verify migration scripts are backward-compatible with the currently running application version.
- **Validation:** Application can run against database state before, during, and after migration execution.

## 5. Reference Implementation

### SQL (Non-Blocking PostgreSQL DDL and Covering Indexes)

```sql
-- 1. Create non-blocking composite index on high-volume table
-- Leftmost prefix: tenant_id (equality), status (equality), created_at (range/sort)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_tenant_status_created
ON orders (tenant_id, status, created_at DESC)
INCLUDE (total_cents, currency)
WHERE status != 'ARCHIVED';

-- 2. Expand Phase of Expand-Contract Migration: Add new column safely
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_e164 VARCHAR(32);

-- Add check constraint without locking whole table
ALTER TABLE users
ADD CONSTRAINT chk_phone_e164_format
CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+[1-9]\d{1,14}$')
NOT VALID;

-- Validate constraint asynchronously in non-blocking scan
ALTER TABLE users VALIDATE CONSTRAINT chk_phone_e164_format;
```

## 6. Validation Gate

Run before executing database changes:

- [ ] All foreign key columns have dedicated indexes.
- [ ] Production indexes use `CONCURRENTLY` non-blocking DDL syntax.
- [ ] Schema breaking changes follow the 5-phase Expand-Contract lifecycle.
- [ ] Critical queries are verified using `EXPLAIN ANALYZE` with zero unplanned sequential scans.
- [ ] Connection pool sizes respect the hardware core formula.
- [ ] Multi-table mutations execute within an explicit atomic transaction block.

## 7. Versioning & Portability Matrix

- **Version:** 2.0.0
- **Changelog:**
  - `2.0.0` (2026-09-20): Elevated to Sauron Tier-5 specification with non-blocking DDL and Expand-Contract patterns.

| Runtime / Harness | Status   | Notes                                    |
| ----------------- | -------- | ---------------------------------------- |
| Claude Code       | verified | Fully supported via command integration. |
| Cursor            | verified | Compatible with editor rule context.     |
| Windsurf          | verified | Fully functional.                        |
| Antigravity       | verified | Certified.                               |
