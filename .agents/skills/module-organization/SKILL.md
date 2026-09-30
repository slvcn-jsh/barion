---
name: module-organization
description: Module organization standards covering flat dependency graphs, barrel-file bans in application code, package entry points, circular dependency elimination, and type-only imports.
department: architecture
ownerAgent: legolas
triggerCommand: /module-organization
antiPatternsPrevented:
  - AP-1
  - AP-4
  - AP-8
  - AP-16
  - AP-18
  - AP-26
  - AP-28
---

# Module Organization & Graph Integrity

## 0. Identity

- **Role:** Module Hierarchy and Bundling Architect. Enforces clean dependency graphs, tree-shakeable packaging, cycle elimination, and fast dev-server compilation.
- **Authority:** Normative tier-4 standard for project module structuring under `skills/architecture/module-organization/`.
- **Must not define:** Application UI presentation or database SQL queries.
- **Normative base:** `core/fellowship/aragorn.md`, `rules/engineering/architecture-boundaries.md`, `rules/common/code-style-standards.md`, `references/anti-patterns.md`.
- **Anti-pattern gate:** Blocks AP-8 (wildcard barrel re-exports), AP-16 (context graph dumping), and AP-28 (circular dependency loops).

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                              |
| --- | ---------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Task             | Structure, lint, and enforce modular boundaries and dependency graphs across codebases.            |
| 2   | Target Tool      | TypeScript, Turbopack, Vite, esbuild, Webpack, madge, ESLint import plugins.                       |
| 3   | Output Format    | Clean direct import statements, explicit package.json export maps, and path mappings.              |
| 4   | Constraints      | Banish barrel files in application source code. Zero circular dependencies. Mandatory import type. |
| 5   | Input            | Directory trees, import statements, bundle analysis profiles, package manifests.                   |
| 6   | Context          | Prevents slow HMR, inflated bundle sizes, runtime initialization temporal dead zones.              |
| 7   | Audience         | Frontend engineers, backend developers, release engineers, tooling maintainers.                    |
| 8   | Success Criteria | Zero circular dependencies; 100 percent tree-shakeable published libraries; sub-second HMR.        |
| 9   | Examples         | See Section 5.                                                                                     |

## 2. Trigger Matrix

| Trigger Condition                                               | Fire? | Action / Route                                                     |
| --------------------------------------------------------------- | ----- | ------------------------------------------------------------------ |
| Creating new files or structuring project directory hierarchies | YES   | Apply direct file import structure and path aliases.               |
| Circular dependency warning detected during build or test       | YES   | Extract shared types into downstream leaf module.                  |
| Writing published NPM library package exports                   | YES   | Declare explicit export map and sideEffects false in package.json. |
| Designing domain entity business logic                          | NO    | Route to `skills/architecture/clean-architecture/`.                |

## 3. Core Architectural Directives

1. **Banish Barrel Files in Application Code:** Do not create `index.ts` files whose sole purpose is re-exporting sibling files (`export * from './button'`). Barrel files force bundlers to load unneeded dependency graphs, degrade hot module reload (HMR) times, and cause accidental circular dependencies.
2. **Mandatory Direct Imports:** Import components and functions directly from their defining file: `import { Button } from '@/components/button/button'`, never `import { Button } from '@/components'`.
3. **Zero Circular Dependencies:** Modules must form an acyclic directed graph (DAG). Module A importing Module B while Module B imports Module A is strictly prohibited. Resolve cycles by moving shared contracts down to a leaf module.
4. **Type-Only Imports:** Use `import type` whenever referencing TypeScript interfaces or type aliases. This guarantees that type references are erased during compilation and generate zero JavaScript bundle weight.
5. **Path Mapping Hygiene:** Configure path aliases (for example `@/`) rooted in the project source root to eliminate fragile relative traversal chains like `../../../../components`.

## 4. Execution Workflow

### Step 1: Import Path Inspection

- **Action:** Audit import declarations. Replace any barrel imports with direct file path references.
- **Validation:** Zero imports reference application-level `index.ts` files.

### Step 2: Cycle Detection Audit

- **Action:** Run circular dependency analysis (`npx madge --circular src/`).
- **Validation:** Build verification yields zero circular dependency loops.

### Step 3: Type Import Isolation

- **Action:** Convert value imports that only serve as type annotations to `import type`.
- **Validation:** Tree-shaker confirms zero unused module imports retained in emitted chunks.

## 5. Reference Implementation

### TypeScript & Package Manifest Configuration

```json
// package.json (Published Library Package Export Pattern)
{
  "name": "@sauron/ui-core",
  "version": "1.0.0",
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./button": {
      "types": "./dist/button/button.d.ts",
      "import": "./dist/button/button.js"
    },
    "./modal": {
      "types": "./dist/modal/modal.d.ts",
      "import": "./dist/modal/modal.js"
    }
  }
}
```

```typescript
// Application Import Examples

// PASS: Direct source import with explicit path alias
import { calculateDiscount } from "@/modules/billing/calculator";

// PASS: Explicit type-only import to eliminate runtime overhead
import type { InvoiceItem } from "@/modules/billing/types";

// FAIL: Barrel import that loads entire billing graph into memory
// import { calculateDiscount } from "@/modules/billing";
```

## 6. Validation Gate

Run before accepting module organization changes:

- [ ] Zero barrel files (`index.ts` re-exporting siblings) created in application source folders.
- [ ] Application modules import directly from specific feature files.
- [ ] Type-only references use explicit `import type` syntax.
- [ ] Automated check confirms zero circular dependency cycles (`madge --circular`).
- [ ] Library manifests declare `"sideEffects": false` for tree-shaking optimization.

## 7. Versioning & Portability Matrix

- **Version:** 2.0.0
- **Changelog:**
  - `2.0.0` (2026-09-20): Elevated to Sauron Tier-5 specification with package export maps and tree-shaking rules.

| Runtime / Harness | Status   | Notes                                    |
| ----------------- | -------- | ---------------------------------------- |
| Claude Code       | verified | Fully supported via command integration. |
| Cursor            | verified | Compatible with editor rule context.     |
| Windsurf          | verified | Fully functional.                        |
| Antigravity       | verified | Certified.                               |
