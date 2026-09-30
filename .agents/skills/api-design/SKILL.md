---
name: api-design
description: REST API design patterns including resource naming, HTTP method semantics, status codes, cursor pagination, filtering, rate limiting, versioning, and deterministic error envelopes.
department: architecture
ownerAgent: gimli
triggerCommand: /api-design
antiPatternsPrevented:
  - AP-1
  - AP-6
  - AP-9
  - AP-18
  - AP-26
---

# API Design

## 0. Identity

- **Role:** Principal API and Systems Architect. Enforces uniform RESTful standards, semantic HTTP status codes, structured response envelopes, pagination models, and contract versioning lifecycle.
- **Authority:** Normative tier-4 standard for API contract definitions under `skills/architecture/api-design/`.
- **Must not define:** Client-side React components or direct database migration scripts (see `skills/database/database-migration/`).
- **Normative base:** `core/fellowship/aragorn.md`, `rules/engineering/architecture-boundaries.md`, `rules/common/code-style-standards.md`, `references/anti-patterns.md`.
- **Anti-pattern gate:** Blocks AP-1 (vague contracts), AP-9 (returning 200 OK for business errors), AP-18 (unbounded endpoints), and AP-26 (leaking internal traces).

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                                 |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | Task             | Design, review, and standardize RESTful API resources, envelopes, and versioning rules.               |
| 2   | Target Tool      | TypeScript, Node.js, Express, Next.js API routes, Python FastAPI, Go net/http, OpenAPI 3.1.           |
| 3   | Output Format    | Standardized REST contracts with JSON envelopes, schema validations, and route handlers.              |
| 4   | Constraints      | Plural kebab-case resource nouns. Zero verbs in URLs. Explicit status codes. Mandatory idempotency.   |
| 5   | Input            | Resource domain models, relationship graphs, client consumption requirements.                         |
| 6   | Context          | Prevents chaotic API sprawl, breaking changes, silent failures, and non-deterministic error handling. |
| 7   | Audience         | Backend engineers, integration teams, API gateway operators, full-stack developers.                   |
| 8   | Success Criteria | Clean OpenAPI validation, 100 percent semantic status code accuracy, zero unhandled errors leaking.   |
| 9   | Examples         | See Section 5.                                                                                        |

## 2. Trigger Matrix

| Trigger Condition                                    | Fire? | Action / Route                                           |
| ---------------------------------------------------- | ----- | -------------------------------------------------------- |
| Creating new REST endpoints or route handlers        | YES   | Apply resource-noun conventions and response envelopes.  |
| Defining pagination, filtering, or sorting protocols | YES   | Apply cursor or offset selection guidelines.             |
| Reviewing status codes or error structures           | YES   | Eliminate 200 OK error responses; enforce error schemas. |
| Designing GraphQL federated supergraph schemas       | NO    | Route to `skills/backend/graphql-federation-patterns/`.  |
| Writing raw database DDL or SQL migrations           | NO    | Route to `skills/database/database-migration/`.          |

## 3. Core Architectural Directives

1. **Resource-Noun URLs:** Use plural kebab-case nouns for endpoints (`/api/v1/team-members`, `/api/v1/orders/{id}/items`). Banish verbs from URL paths. Actions that cannot map cleanly to standard CRUD operations must be expressed using explicit sub-actions (for example `POST /api/v1/orders/{id}/cancel`).
2. **HTTP Method Semantics:**
   - `GET`: Safe, idempotent retrieval. Never mutate state.
   - `POST`: Non-idempotent creation or state transition. Return `201 Created` with `Location` header.
   - `PUT`: Idempotent full replacement of a resource.
   - `PATCH`: Partial update of a resource.
   - `DELETE`: Idempotent removal. Return `204 No Content` or `200 OK` with status payload.
3. **Deterministic Response Envelopes:**
   - Single resources return under a top-level `data` key.
   - Collections return `data` array along with `meta` (pagination metadata) and `links`.
   - Errors return a top-level `error` object containing `code`, `message`, and optional `details` array.
4. **Pagination Strategy:**
   - Use offset pagination for admin dashboards and static datasets under 10,000 records.
   - Use opaque cursor pagination (`?cursor=xyz&limit=20`) for feeds, infinite scroll, high-volume event streams, and public APIs to ensure consistent O(1) performance across large offsets.
5. **Rate Limiting and Deprecation Headers:**
   - Always emit standard rate limiting headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.
   - On rate threshold breach, return `429 Too Many Requests` with a mandatory `Retry-After` header in seconds.
   - For deprecated endpoints, include `Deprecation: true` and `Sunset: <HTTP-date>` headers with a minimum 6-month warning window.

## 4. Execution Workflow

### Step 1: Contract and Resource Hierarchy Definition

- **Action:** Map entities to REST resource paths. Identify parent-child ownership relationships.
- **Stop Condition:** Halt if URLs contain verbs (for example `/getUser`) or singular entity names.
- **Validation:** Every route follows `/api/v{major}/{resources}` format.

### Step 2: Schema Validation and Input Sanitization

- **Action:** Declare strict validation schemas for request bodies, query strings, and headers using schema validators (Zod, Pydantic, or TypeBox).
- **Stop Condition:** Halt if input validation errors yield generic `500 Internal Server Error`.
- **Validation:** Malformed payloads fail immediately with `422 Unprocessable Entity` or `400 Bad Request`.

### Step 3: Response Envelope Assembly

- **Action:** Construct structured payload envelopes with consistent field naming (camelCase).
- **Validation:** Response status matches the RFC 9110 specification.

## 5. Reference Implementation

### TypeScript (Next.js Route Handler with Zod and Cursor Pagination)

```typescript
import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";

const createOrderSchema = z.object({
  customerId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1),
  totalCents: z.number().int().positive(),
  idempotencyKey: z.string().min(16),
});

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const parseResult = createOrderSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Request payload validation failed",
            details: parseResult.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
              code: issue.code,
            })),
          },
        },
        { status: 422 },
      );
    }

    const order = await orderService.createOrder(parseResult.data);

    return NextResponse.json(
      { data: order },
      {
        status: 201,
        headers: {
          Location: `/api/v1/orders/${order.id}`,
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected system fault occurred",
        },
      },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const limit = Math.min(Number(searchParams.get("limit") || "20"), 100);

  const { items, nextCursor, hasMore } = await orderService.listOrders({
    cursor,
    limit,
  });

  return NextResponse.json({
    data: items,
    meta: {
      limit,
      hasMore,
      nextCursor: nextCursor || null,
    },
    links: {
      self: `/api/v1/orders?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`,
      next: nextCursor
        ? `/api/v1/orders?limit=${limit}&cursor=${nextCursor}`
        : null,
    },
  });
}
```

## 6. Validation Gate

Run before approving API endpoint pull requests:

- [ ] Resource endpoints use plural nouns in kebab-case with zero embedded verbs.
- [ ] Safe methods (`GET`, `HEAD`) never produce persistent side effects.
- [ ] Successful creations return HTTP `201 Created` with a valid `Location` header.
- [ ] Validation errors return HTTP `422 Unprocessable Entity` or `400 Bad Request` with an explicit field issues list.
- [ ] Zero internal database traces, raw stack traces, or credentials leak in error payloads.
- [ ] Collection endpoints implement cursor or offset pagination with bounded maximum page limits.
- [ ] Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) are emitted.

## 7. Versioning & Portability Matrix

- **Version:** 2.0.0
- **Changelog:**
  - `2.0.0` (2026-09-20): Elevated to Sauron Tier-5 specification. Integrated ECC pagination matrix, error envelope schemas, and input validation gates.

| Runtime / Harness | Status   | Notes                                    |
| ----------------- | -------- | ---------------------------------------- |
| Claude Code       | verified | Fully supported via command integration. |
| Cursor            | verified | Compatible with editor rule context.     |
| Windsurf          | verified | Fully functional.                        |
| Antigravity       | verified | Compatible with agent-spec adapter.      |
