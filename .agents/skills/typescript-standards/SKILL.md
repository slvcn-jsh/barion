---
name: typescript-standards
description: Strict TypeScript standards covering tsconfig setup, erasable syntax, interface vs type rules, runtime validation, and advanced type derivation.
origin: sauron
---

# TypeScript Standards

Enforce strict type-safety, optimal compiler performance, and safe runtime boundaries across all TypeScript code. Eliminate type loopholes, runtime prototype bloat from legacy syntax, and arbitrary casting.

## When to Activate

- Creating or editing `.ts` and `.tsx` source files.
- Configuring `tsconfig.json` compiler options.
- Defining domain data contracts, interfaces, and function signatures.
- Reviewing type error resolutions, compiler performance regressions, or type guards.

## Core Concepts

### 1. Core Setup and Architecture

- **Strict Mode Enforcement:** Enable `strict: true` explicitly in `tsconfig.json`. Declare it explicitly even on modern toolchains to prevent silent downgrades.
- **Type Declarations Location:** Place shared interfaces and type declarations in dedicated domain files within `src/types/` (for example `src/types/user.ts`). Components and hooks import from `src/types/` instead of declaring local duplicates.
- **Explicit Type Imports and Verbatim Module Syntax:** Enable `verbatimModuleSyntax` in `tsconfig.json`. Type-only imports and exports must explicitly use `import type` (for example `import type { User } from './user'`) to guarantee clean tree-shaking and compatibility with Node.js native type stripping, Vite, SWC, and esbuild.

### 2. Type Definition Rules

- **Interface for Object Shapes:** Use `interface` for object shapes and public contracts. Interfaces support declaration merging, class implementation, and cached type relationships in the compiler.
- **Interface Extends Over Intersections:** Compose object types with `interface extends` rather than intersections (`&`). The compiler caches relationships between interfaces and re-evaluates intersections structurally on each check. Reserve `type` strictly for unions, primitives, mapped types, conditional types, and utility mappings.
- **No Enums:** Never declare TypeScript enums. Regular enums compile into runtime lookup objects through an IIFE pattern that bundlers cannot tree-shake. Const enums break under `isolatedModules`. Model finite value sets with union literal types first (`type Status = 'idle' | 'loading' | 'success'`). Promote to an `as const` object map only when you also require runtime iteration or member access (`Status.Loading`).
- **Erasable Syntax Only:** Enable `erasableSyntaxOnly` (available since TypeScript 5.8). It rejects syntax requiring runtime transpilation, including enums and namespaces, keeping the codebase compatible with bundler pipelines, `isolatedModules`, and Node.js native execution.
- **Make Illegal States Unrepresentable:** Model polymorphic data using discriminated unions with a `kind` or `type` tag instead of optional fields (`?`) paired with non-null assertions (`!`).
- **Tuples Over Loose Arrays:** Use tuples (`[string, number]`) for fixed-length positional arrays instead of union arrays (`(string | number)[]`).
- **Explicit Resource Management:** Use the `using` keyword for disposables implementing `Symbol.dispose` or `Symbol.asyncDispose` (such as database connections, file handles, or lock allocations) to automate resource cleanup.

### 3. Runtime Safety and Validation

- **Parse, Don't Validate:** Parse external API responses (DTOs) into internal domain models at the system edge using runtime validation schemas (for example Zod). Do not bleed raw API types through UI logic.
- **Absolute Ban on `any`:** Treat `any` as banned. Use `unknown` for external data and force safe narrowing with type guards before execution.
- **Type Assertions as Last Resort:** Prefer type predicates over manual casts (`as`). Rely on automatic type predicate inference for simple array filters instead of manual predicates. Never use truthiness filters like `.filter(Boolean)` because `false` cannot exclude falsy values such as `0`. Filter with explicit comparisons (`score !== undefined`) instead.
- **Explicit Return Types:** Annotate return types on exported functions and functions returning computed generics. Inferred anonymous return types slow large builds and can produce circularity errors on complex generics. Do not annotate trivial local lambdas where inference is cheap.
- **Exhaustive Checks:** Enforce compile-time coverage on unions using `const _exhaustiveCheck: never = value` in default switch branches.
- **No Floating Promises:** Unhandled or un-awaited promises are strictly banned. Asynchronous calls executed in the background must be explicitly marked with the `void` operator (for example `void trackAnalytics()`) or appended with a `.catch()` error handler.

### 4. Advanced Type Manipulation

- **Branded Types:** Introduce branded types (`type UserId = string & { readonly __brand: unique symbol }`) for critical identifiers so identical primitives cannot mix across domains.
- **Types as Sets:** Treat types as sets of values. `unknown` is the universal set, `never` is the empty set, `&` is intersection, `|` is union.
- **Control Distribution in Conditionals:** Wrap generic parameters in tuples (`[T] extends [Array<unknown>]`) when you must prevent union distribution inside conditional types.
- **Literal Precision:** Use `as const` for literal types and tuples. Use `satisfies` to validate schema conformance without widening inferred literal types.
- **Derive Types:** Derive types with `typeof`, `ReturnType<T>`, `Pick`, `Omit`, mapped types, and template literal types instead of duplicating structures manually.
- **Extract with `infer`:** Use `infer` inside conditional generic types to unwrap payload types dynamically.

## Code Examples

```typescript
// Branded Type definition for domain safety
export type UserId = string & { readonly __brand: unique symbol };

export function parseUserId(raw: string): UserId {
  if (!raw || raw.length < 8) {
    throw new Error("Invalid UserId format");
  }
  return raw as UserId;
}

// Discriminated Union making illegal states unrepresentable
export type AsyncResult<T> =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "error"; readonly error: Error };

// Exhaustive switch validation
export function handleResult<T>(result: AsyncResult<T>): string {
  switch (result.status) {
    case "idle":
      return "Waiting to begin";
    case "loading":
      return "Loading data...";
    case "success":
      return `Loaded successfully`;
    case "error":
      return `Error: ${result.error.message}`;
    default: {
      const _exhaustiveCheck: never = result;
      return _exhaustiveCheck;
    }
  }
}
```

## Anti-Patterns

- **AP-13 (Hallucination invite / Type loopholes):** Using `any` or `as any` to silence compiler errors instead of fixing structural type mismatches.
- **Non-Null Assertion Abuse:** Appending `!` to nullable variables (for example `user!.email`) without prior null checking.
- **Truthiness Filter Traps:** Using `.filter(Boolean)` on arrays containing valid falsy values like `0` or `""`.
- **Floating Promises:** Triggering async functions without `await`, `void`, or `.catch()`, causing silent unhandled promise rejections.
- **Enum Runtime Pollution:** Declaring `enum` which outputs un-treeshakeable IIFE code into JavaScript bundles.

## Best Practices

- Enable `strict`, `verbatimModuleSyntax`, and `erasableSyntaxOnly` in `tsconfig.json`.
- Prefer `interface extends` over type intersections (`&`) for object composition.
- Annotate return types on all exported functions to prevent compile-time degradation.

## Related Skills

- `module-organization`
- `react-principles`
- `clean-architecture`
