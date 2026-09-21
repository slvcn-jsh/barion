# Card pipeline security review

Reviewed: secret handling, provider tokens, authority URLs, SSRF, redirects, MIME/size limits, upload size/type controls, path traversal, malformed PDFs, prompt injection, rendering, logging, migration safety, authentication, and CORS.

Implemented controls:

- Provider keys remain server-side; refresh tokens never reach gateway.
- Authority adapter builds URLs internally; HTTPS host allowlist, DNS public-IP validation, no credentials, no redirects, strict timeouts, response caps, MIME checks.
- Source imports enforce supported types, 30 MB PDF cap, and 160-page cap. Extraction errors are sanitized.
- Source prompts label delimited content untrusted and forbid executing embedded instructions, tool calls, secret requests, or system-rule changes.
- React Native renders source content through `Text`, not raw HTML.
- Telemetry excludes prompts, documents, keys, and headers.
- SQLite migration is additive; legacy rows default held.
- Supabase asymmetric JWT checks and CORS allowlist remain active.

Open deployment items: shared multi-instance rate limiter, production TLS/edge policy, live penetration test, mobile native malformed-file fuzzing, and monitoring backend configuration.
