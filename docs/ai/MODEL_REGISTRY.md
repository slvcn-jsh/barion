# Bari AI model registry

Canonical runtime definitions live in `services/ai_gateway/policies.py`.

| Logical ID | Provider surface | Physical model | Status | Tuning status |
| --- | --- | --- | --- | --- |
| `gemini-3.8-flash/base` | Gemini | `gemini-3.8-flash` | baseline | unsupported |
| `gemini-3.5-flash/base` | Gemini Enterprise Agent Platform | `gemini-3.5-flash` | candidate | supported on Enterprise Agent Platform |
| `gemini-3.5-flash-lite/base` | Gemini | `gemini-3.5-flash-lite` | candidate fallback | unsupported/not listed |

Registry records provider, physical model ID, supported purposes, structured-output capability, status, tuned/base state, dataset lineage, and cost class. Task policies reference logical IDs, not scattered raw IDs.

## Change rules

- Revalidate provider capability from current official documentation.
- Add tests for unique logical IDs and task compatibility.
- Never mark a tuned model active without dataset lineage and immutable evaluation evidence.
- Keep retired records for artifact interpretation.
- Deployment secrets and API keys never belong in registry.
- Raw environment model ID may select deployment version, but product behavior and evaluation refer to logical policy ID.
- Unknown deployment model IDs retain explicit `provider:model` logical identity until registered; they never masquerade as baseline records.
- Phase 6 evaluation artifacts persist both logical model identity and physical provider model version.
