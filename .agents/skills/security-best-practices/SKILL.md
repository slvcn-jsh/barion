---
name: security-best-practices
description: Application security standards covering OWASP Top 10 defenses, parameterized SQL queries, HttpOnly SameSite cookie hardening, CSP headers, password hashing, and AI agent least-privilege guardrails.
department: security
ownerAgent: boromir
triggerCommand: /security-best-practices
antiPatternsPrevented:
  - AP-1
  - AP-4
  - AP-9
  - AP-18
  - AP-26
  - AP-44
---

# Security Best Practices & Defense-in-Depth

## 0. Identity

- **Role:** Chief Information Security Architect. Enforces defense-in-depth across client, server, and cloud tiers, preventing OWASP Top 10 vulnerabilities, credential leaks, and unauthorized AI tool execution.
- **Authority:** Normative tier-4 standard for application security under `skills/security/security-best-practices/`.
- **Must not define:** Direct application UI rendering templates or visual styles.
- **Normative base:** `core/fellowship/boromir.md`, `rules/engineering/architecture-boundaries.md`, `rules/common/code-style-standards.md`, `references/anti-patterns.md`, `rules/security/owasp-defensive-shield.md`, `context/core-domains/security-policies.md`.
- **Anti-pattern gate:** Blocks AP-4 (over-permissive execution), AP-26 (leaking secrets in logs/code), and AP-44 (unlocked security boundaries).

## 1. Intent (9 Dimensions)

| #   | Dimension        | Value                                                                                                 |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | Task             | Audit, implement, and enforce application and API security defenses and guardrails.                   |
| 2   | Target Tool      | OWASP ZAP, Trivy, Snyk, Semgrep, Node.js crypto, Argon2id, helmet, DOMPurify.                         |
| 3   | Output Format    | Secure code implementations, Content Security Policy headers, and vulnerability audit reports.        |
| 4   | Constraints      | Zero hardcoded secrets. Mandatory parameterized SQL queries. Strict HttpOnly cookie scoping.          |
| 5   | Input            | Application source code, authentication workflows, API endpoints, dependency manifests.               |
| 6   | Context          | Eliminates SQLi, XSS, CSRF, BOLA/IDOR vulnerabilities, and sensitive data leakage.                    |
| 7   | Audience         | Security engineers, backend developers, platform architects, DevOps leads.                            |
| 8   | Success Criteria | Zero high/critical vulnerabilities; 100 percent parameterized database queries; clean security scans. |
| 9   | Examples         | See Section 5.                                                                                        |

## 2. Trigger Matrix

| Trigger Condition                                                      | Fire? | Action / Route                                                      |
| ---------------------------------------------------------------------- | ----- | ------------------------------------------------------------------- |
| Implementing user authentication, session tokens, or password hashing  | YES   | Apply Argon2id hashing and HttpOnly SameSite cookie flags.          |
| Handling external user input, database queries, or HTML rendering      | YES   | Enforce input validation schemas, parameterized SQL, and DOMPurify. |
| Conducting line-by-line security code review against OWASP standards   | NO    | Route to `skills/security/security-auditor/`.                       |
| Running software bill of materials and dependency vulnerability audits | NO    | Route to `skills/security/sbom-software-bill-of-materials/`.        |

## 3. Core Architectural Directives

1. **Defense-in-Depth Authentication:**
   - Hash passwords with memory-hard Argon2id (`m=19MB, t=2, p=1`) or bcrypt (`cost >= 12`).
   - Deliver access tokens exclusively via `HttpOnly; Secure; SameSite=Strict` cookies. Never store session tokens in `localStorage` due to Cross-Site Scripting (XSS) extraction risks.
2. **Zero Injection (SQLi / Command):** All database access must execute through prepared statements or parameterized queries. Dynamic string interpolation in SQL or shell commands is strictly banned.
3. **Broken Object-Level Authorization (BOLA / IDOR) Defense:** Never fetch resources using user-supplied primary keys alone. Always scope database queries to the authenticated tenant or user context (`WHERE id = :id AND user_id = :authenticated_user_id`).
4. **Strict HTTP Security Headers:**
   - Enforce Content-Security-Policy (CSP) without `unsafe-inline` or `unsafe-eval`.
   - Set `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
5. **AI Agent Tool Execution Guardrails:**
   - AI tools operating on behalf of users must follow least-privilege principles.
   - Destructive operations (dropping tables, modifying production DNS, deleting files) mandate an explicit interactive confirmation gate before execution.

## 4. Execution Workflow

### Step 1: Input Validation Boundary

- **Action:** Validate incoming request payloads with strict schema parsers (Zod, Pydantic).
- **Validation:** Malformed types and unknown fields are rejected with HTTP 422 before reaching business logic.

### Step 2: Query Parameterization

- **Action:** Audit database queries to confirm all user values are passed as positional or named parameters.
- **Validation:** Zero string concatenation detected in SQL statements.

### Step 3: Header and Cookie Hardening

- **Action:** Configure security middleware (Helmet) and scope authentication cookies.
- **Validation:** Response headers reflect complete security policies in automated scans.

## 5. Reference Implementation

### TypeScript (Secure Authentication Cookies & Parameterized Tenant Query)

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 1. Secure Authentication Cookie Delivery
export function setAuthCookie(res: NextResponse, token: string): void {
  res.cookies.set({
    name: "__Host-auth-token",
    value: token,
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 3600, // 1 hour
  });
}

// 2. BOLA/IDOR-Safe Parameterized Query
export async function getOrderSecurely(
  dbClient: any,
  orderId: string,
  authenticatedUserId: string,
) {
  // Always scope lookup to the authenticated user identity
  const query = `
    SELECT id, total_cents, status, created_at 
    FROM orders 
    WHERE id = $1 AND user_id = $2
  `;
  const result = await dbClient.query(query, [orderId, authenticatedUserId]);

  if (result.rows.length === 0) {
    throw new Error("Order not found or access denied");
  }

  return result.rows[0];
}
```

## 6. Validation Gate

Run before certifying security posture:

- [ ] Passwords hashed using Argon2id or bcrypt (cost >= 12).
- [ ] Authentication tokens delivered via HttpOnly, Secure, SameSite cookies.
- [ ] Database queries use parameterized placeholders with zero string concatenation.
- [ ] Object lookups enforce tenant and user ownership boundaries (BOLA defense).
- [ ] CSP and HSTS security headers configured.
- [ ] AI tool operations enforce human confirmation gates for destructive actions.

## 7. Versioning & Portability Matrix

- **Version:** 2.0.0
- **Changelog:**
  - `2.0.0` (2026-09-20): Elevated to Sauron Tier-5 specification with BOLA defenses, cookie hardening, and AI tool guardrails.

| Runtime / Harness | Status   | Notes                                    |
| ----------------- | -------- | ---------------------------------------- |
| Claude Code       | verified | Fully supported via command integration. |
| Cursor            | verified | Compatible with editor rule context.     |
| Windsurf          | verified | Fully functional.                        |
| Antigravity       | verified | Certified.                               |
