# Production card evaluation

Barion remains educational study support, not clinical decision support, diagnosis, treatment recommendation, or medical authority.

## Boundaries

`services/card_evaluation/` owns reusable normalization, atomic claim extraction, grounding, contradiction checks, risk routing, authority verification, secure retrieval/cache, sanitization, and publication policy. `services/card_benchmark/` consumes this core through compatibility exports and retains experiments, datasets, comparative analysis, and reports. Gateway evidence substring resolution proves coordinates only. It never proves claim support or current medical correctness.

## Contract

Versioned result separates source span, source claim support, citation quality, medical risk, external verification, pedagogy, and publication disposition. Shared `policy_contract.json` drives Python/TypeScript conformance.

## Publication

- `PUBLISH`: eligible for automatic study flow.
- `SANITIZE`: preserve original, remove only optional unsupported content, then rerun full evaluation.
- `REVIEW`: held outside study queue with reason.
- `REJECT`: preserved for audit, never added to study.

Gateway runs full claim evaluation after trusted span resolution. Successful `SANITIZE` results preserve original content, remove only unsupported optional fields, and rerun full evaluation before final `PUBLISH`. Ambiguous/stale spans, unresolved required verification, and authority conflicts remain `REVIEW`; unsupported or contradicted core claims remain `REJECT`. Local extractive cards retain deterministic source-extracted policy.

## Verification and offline behavior

Verification is atomic-claim selective. DailyMed adapter accepts minimized drug query metadata, uses HTTPS allowlisting, public-IP checks, no redirects, MIME and size limits, and sanitized errors. Valid versioned cache may be reused offline. Required high-risk verification without valid cache yields `not_performed_offline` and remains held. External truth never changes source support.

## Data and migration

SQLite schema 19 adds nullable evaluation/original payload JSON plus disposition and version fields to generated candidates. Existing rows migrate to `REVIEW` and `legacy`; manual cards and reviewed scheduling data remain unchanged.

## CI and operations

Fast CI is deterministic and offline. Scheduled/manual quality tier is separate and requires protected secrets plus explicit approval before paid generation or live authority calls. Telemetry must remain content-free: IDs, status counts, latency, token use, retries, cache hits, and provider categories only.

## Debugging

Inspect evaluation reason codes, source-span hashes, policy versions, provider provenance, and sanitized error categories. Never log source documents, prompts, access/refresh tokens, authorization headers, or authority credentials.

## Known limits

Production authority routing currently uses DailyMed only; unsupported authority categories fail closed to `REVIEW`. Verification cache is process-local unless a durable cache path is supplied by a deployment composition. Live mobile E2E and native performance measurements require device/deployment infrastructure.
