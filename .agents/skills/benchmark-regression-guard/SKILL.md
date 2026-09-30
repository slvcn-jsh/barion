---
name: benchmark-regression-guard
description: Automated latency, throughput, and memory regression detection in continuous integration performance pipelines.
department: quality
ownerAgent: merry
triggerCommand: /benchmark-regression-guard
antiPatternsPrevented:
  - AP-1
  - AP-6
  - AP-18
  - AP-26
---

# Benchmark Regression Guard

## 0. Identity

- **Role:** Continuous Performance Engineer. Monitors computational performance regressions and enforces latency budgets in CI.
- **Authority:** Normative specification under `skills/quality/benchmark-regression-guard/`.
- **Must not define:** Static code formatting rules.
- **Normative base:** `core/fellowship/merry.md`, `rules/engineering/architecture-boundaries.md`, `rules/common/code-style-standards.md`, `references/anti-patterns.md`, `context/core-domains/performance-budgets.md`.

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                         |
| --- | ---------------- | --------------------------------------------------------------------------------------------- |
| 1   | Task             | Measure micro-benchmarks and fail CI on statistically significant performance regressions.    |
| 2   | Target Tool      | Tinybench, Benchmark.js, Go `testing.B`, Criterion.rs, GitHub Action benchmark.               |
| 3   | Output Format    | Performance comparison tables, latency delta graphs, CI failure notifications.                |
| 4   | Constraints      | Run warm-up iterations. Reject noise by enforcing minimum 30 sample measurement cycles.       |
| 5   | Input            | Critical path algorithms, serialization routines, cryptographic functions.                    |
| 6   | Context          | Prevents performance degradations and CPU regressions from creeping into production releases. |
| 7   | Audience         | Core library authors, engine maintainers, and systems engineers.                              |
| 8   | Success Criteria | p95 latency shifts greater than 5% automatically blocked before merge.                        |
| 9   | Examples         | See Section 5.                                                                                |

## 2. Benchmark Directives

1. **Statistical Significance:** Execute minimum 10 warmup iterations and 30 measurement runs before calculating p95 and p99 statistics.
2. **Performance Budgets:** Trigger automated CI failures if execution latency regresses by more than 5% against the baseline branch.
3. **Memory Allocation Audits:** Measure heap allocation deltas alongside execution time to catch memory leak regressions early.
4. **Isolated Benchmark Runner:** Execute performance suites on dedicated bare-metal or single-tenant virtual machine runners to eliminate neighbor CPU noise.

## 3. Benchmark Implementation Example

```typescript
import { Bench } from "tinybench";

const bench = new Bench({ time: 1000, warmupTime: 300 });

bench
  .add("json serialization baseline", () => {
    JSON.stringify({ id: "123", tags: ["a", "b", "c"], active: true });
  })
  .add("fast-json-stringify candidate", () => {
    fastStringify({ id: "123", tags: ["a", "b", "c"], active: true });
  });

await bench.run();
console.table(bench.table());

const candidate = bench.getTask("fast-json-stringify candidate");
const baseline = bench.getTask("json serialization baseline");
if (candidate.result.mean > baseline.result.mean * 1.05) {
  throw new Error("Performance regression detected exceeding 5% budget!");
}
```
