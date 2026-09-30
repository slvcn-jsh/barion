# Barion Production Readiness Audit

Audit date: 2026-09-28  
Source of truth: current `master` filesystem, staged index, working tree, and local verification results.

## Executive result

Status: **not ready for public production release**.

Core source-to-study behavior is substantially implemented and covered by passing lint, TypeScript, Jest, Python, focused browser, and web-export checks. Remaining release blockers are production environment/auth verification, native release-build proof, lint warning debt, crash reporting, and staged workspace hygiene.

## Reconstructed work state

### Completed before this audit

- `HEAD` (`8b44d54`) contains AI gateway, Bari chat, source provenance, evaluation, and fallback hardening.
- Staged work implements reviewer-PDF reliability blueprint: queue binding, study availability, coordinate-aware PDF layout, target filtering, local-first generation, candidate selection, retry/failover, source currency, repository decomposition, and focused regressions.
- Staged UI and Bari 3D work includes native/web model integration, animation state tests, screen updates, Metro GLB support, Android package metadata, and internal EAS APK profiles.
- Existing architecture artifacts define local-first source ownership and acceptance gates in `context/engineering-loop/`.

### Completed during this continuation

- Fixed Expo public gateway configuration reads. Expo SDK 57 requires direct `process.env.EXPO_PUBLIC_*` references for build-time inlining; prior aliased reads left gateway URL/model unavailable in production bundles.
- Kept static gateway token development-only. Production export contains configured gateway URL/model but not configured local static token.
- Wired Bari chat to Supabase session-token provider, matching card-generation auth behavior.
- Added regression coverage for environment parsing and development-only static authorization.

## Verification matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| TypeScript | PASS | `npm run typecheck` |
| Jest | PASS | 44 suites, 245 tests |
| Python services | PASS | 190 tests; cache-write warning only |
| Focused browser flow | PASS | 2 local-first/rate-limit Playwright tests |
| Expo web production export | PASS | SDK 57 export completed, 1,670 modules |
| Expo dependency compatibility | PASS with limitation | Offline SDK check reports dependencies current; online cache write blocked by sandbox permissions |
| Python bytecode compile | PASS with limitation | Service code compiled; inaccessible existing pytest cache produced warning |
| Production dependency audit | PASS for severe findings | 0 high, 0 critical; 47 moderate transitive findings |
| Lint | PASS with debt | Expo ESLint gate reports 0 errors and 73 warnings; CI now executes it |
| Native release build | NOT RUN | No local Android release/iOS build or EAS production build proof |
| Production backend/auth | NOT VERIFIED | EAS production environment and deployed gateway were not inspected |

## Live Gemini smoke result

Run date: 2026-09-28

- Local gateway health and static authentication passed. Gateway reported provider `gemini`, model `gemini-3.8-flash`, and configured embeddings.
- One authenticated `/v1/card-generation` request reached Gemini but failed with HTTP `503 UNAVAILABLE` after all 3 configured attempts. Provider detail reported temporary high demand.
- One authenticated `/v1/bari/chat` request also failed with HTTP `503 provider_unavailable`; no Gemini response or citation was returned.
- No local fallback was counted as success in either probe.
- These calls prove key/model routing reaches Gemini. They do not prove paid billing status, quota tier, or consistent availability; billing must be confirmed in Google AI Studio or Google Cloud billing/usage controls.

### Follow-up diagnosis and remediation

- Root cause found: gateway process inherited a different `GEMINI_API_KEY` from parent shell. Python dotenv correctly preserved parent environment, so current service-owned key never loaded. Direct calls with service key succeeded while inherited key returned rate-limit/capacity failures.
- Local gateway now starts through `services.ai_gateway.local_server`, which deliberately gives `services/ai_gateway/.env` priority for local development. Production Uvicorn startup continues to preserve deployment-managed environment priority.
- Added configured Gemini model failover: `gemini-3.8-flash` primary, `gemini-3.5-flash-lite` fallback locally. Recoverable primary failures can cross to fallback once while remaining within 120-second client deadline.
- Added per-result provider/model provenance safe for concurrent requests and generated Bari request IDs when Gemini omits response header.
- Post-fix live proof passed: card generation returned 1 grounded candidate from Gemini in 1.839 seconds; Bari Chat returned a source-cited Gemini response in 2.570 seconds with request ID and no local fallback.
- This is successful smoke proof, not long-term availability proof. Production still needs deployed canary monitoring and billing/quota confirmation.

## Prioritized remaining work

### Critical

1. **Gemini reliability and billing proof**
   - Current corrected local configuration passes one card-generation and one Bari Chat probe.
   - Confirm paid billing/quota externally, then run deployed capped canaries and record success rate, latency, request IDs, actual model, and fallback rate over time.

2. **Production environment/auth proof**
   - Configure EAS production environment with HTTPS ingestion/gateway URLs, Supabase public routing values, and server-side secrets.
   - Omit `EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN` from production.
   - Verify Supabase JWT auth, gateway CORS, provider access, and `/v1/health` against deployed services.

3. **Native release proof**
   - Explicit EAS `production` profile now exists.
   - Produce Android release build and iOS build, then run install/launch/import/study/backup smoke tests.

### Important

1. **Reduce lint warning debt**
   - Expo ESLint now runs locally and in CI. Resolve 73 existing warnings before enabling a zero-warning gate.

2. **Preserve release-only HTTPS behavior**
   - Undocumented `android.usesCleartextTraffic` was removed from `app.json`.
   - Native release manifest does not allow cleartext; debug manifest explicitly allows it for local development. Production endpoints must remain HTTPS.

3. **Clean release staging with owner approval**
   - Staged index includes unrelated agent-skill imports, duplicate 3D starter-pack content, `debug.log`, and malformed one-off `fix.py`.
   - `git diff --cached --check` reports conflict-marker examples and whitespace errors inside staged skill/reference files.
   - These files were preserved per instruction; no reset, clean, revert, or deletion was performed.

4. **Make browser gate terminate cleanly in Windows harness**
   - Both focused tests pass, ports 8091/8092 close, but shell session does not return after Playwright output and requires interruption in this managed PTY.
   - Confirm normal CI exit on GitHub Actions before treating this as repository defect.

### Follow-up

- Review 47 moderate transitive npm advisories when Expo-compatible upgrades become available.
- Add observability/crash reporting and release health thresholds before broad rollout.
- Measure web bundle and 3D asset loading on lower-end devices.

## Preserved state

All pre-existing staged and untracked work remains intact. No repository reset, revert, clean, checkout, deletion, or forced overwrite was used.
