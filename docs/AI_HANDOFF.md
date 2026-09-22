# BARION AI DEVELOPMENT HANDOFF

## 1. PROJECT PURPOSE

Barion is an offline-first medical and health-science study app. It imports learner-provided sources, preserves provenance, creates source-grounded flashcard candidates, and supports active recall and FSRS review. Barion is educational study support, not general medical advice, diagnosis, treatment guidance, or clinical decision support.

## 2. CURRENT SYSTEM ARCHITECTURE

- **Client:** Expo 57 / React Native 0.86 / React 19 with Expo Router routes in `app/`.
- **Local data:** Expo SQLite `medstudy.db`; `src/storage/database.ts` owns schema/migration and `src/storage/repository.ts` workflows. Native imported files persist under app documents; web retains picker URI plus hash.
- **Ingestion:** web PDF.js; native text/Markdown; native PDF through optional stateless PyMuPDF service. Pages become deterministic local segments with locators and offsets.
- **Generation:** client uses authenticated FastAPI gateway through provider abstraction, then falls back to deterministic local extractive drafts on configuration, auth, network, provider, quantity, or validation failure.
- **Gateway:** `services/ai_gateway/`; static bearer auth locally, Supabase asymmetric JWT/JWKS in production, current adapter Gemini. Structured output, prompt-injection boundaries, limits, rate limiting, retries, and sanitized diagnostics exist.
- **Provenance:** cross-language `source-span/1.0.0`: SHA-256, UTF-16 code-unit offsets, half-open ranges. Provider offsets are untrusted; gateway/client derive spans from trusted segments.
- **Evaluation:** `services/card_evaluation/` now owns reusable normalization, atomic claim extraction, grounding, contradiction validation, risk/verification integration, sanitization, and publication policy. `services/card_benchmark/` consumes that production core while retaining structural extraction, concept inventory, experiments, pedagogy scoring, and reporting. TypeScript independently revalidates production contracts.
- **Study:** approved/manual cards share local card/evidence path. `ts-fsrs` drives review; review events are append-only, memory state is recalculated cache, non-recall modes stay separate from durable FSRS.
- **Offline:** SQLite study/review works offline. Remote generation failure uses local extraction. Authority checks may use valid cache; required high-risk checks without cache remain held.

## 3. CURRENT END-TO-END FLOW

1. **WORKING:** picker import -> file persistence/hash -> duplicate detection -> source row/source-owned deck.
2. **WORKING:** PDF/text extraction -> page locators -> segmentation -> source segments and study guide.
3. **WORKING:** `generateDraftsForSource()` -> gateway/session token -> Gemini structured generation and deterministic validation; any failure -> local extractive candidates.
4. **WORKING:** trusted evidence-span resolution -> candidate/provenance/evaluation persistence -> review UI.
5. **WORKING:** gateway candidates receive trusted span resolution, atomic claim extraction, semantic source grounding, contradiction checks, selective risk/authority routing, sanitization with full reevaluation, and deterministic PUBLISH/SANITIZE/REVIEW/REJECT policy.
6. **WORKING:** mobile revalidates evaluation metadata, persists original/sanitized payloads and policy results transactionally, auto-publishes only final PUBLISH candidates, and keeps REVIEW/REJECT/unresolved candidates outside normal study.
7. **WORKING:** approval/manual creation -> cards/evidence/initial FSRS -> offline study, testing, review, undo, calendar, backup.
8. **PARTIAL:** production authority routing is integrated with DailyMed and fails closed when unsupported/unavailable; authority breadth, durable deployment cache composition, live mobile upload-to-offline-study E2E, and production monitoring/deployment remain open.

## 4. IMPLEMENTED FEATURES

### Mobile application
- Source, deck, course/module, library, study, test, Match, calendar, profile, print/export, backup/recovery, and source-review routes.
- Optional Supabase sign-in/session restoration; native sessions use SecureStore.

### Storage and ingestion
- SQLite schema v19, `PRAGMA user_version`, WAL/foreign keys, FTS5 with LIKE fallback, additive repairs, indexes, source-owned decks, archive/trash.
- Durable native source copy; SHA-256 duplicate detection; PDF.js/PyMuPDF extraction; 30 MB/160-page PDF limits; deterministic segmentation.

### AI and generation
- Model-agnostic client `CardGenerationProvider` and gateway envelope.
- Gemini adapter with strict JSON schema, 32,768 combined thinking/output tokens, low thinking, bounded retry/hints, usage/provenance, auth, CORS, and content-free telemetry.
- Evidence-span derivation and local extractive fallback without AI.

### Evaluation, benchmarking, safety
- Atomic claims, grounding/citation/numeric/contradiction checks, selective risk routing, secure DailyMed adapter, cache, gateway integration, and PUBLISH/SANITIZE/REVIEW/REJECT policy.
- Sanitization preserves original, removes optional unsupported fields only, and requires reevaluation.
- Governed fixtures, structural extraction, frozen inventories, weighted coverage, semantic matching, blind review, SOL evaluator contract, immutable hash-linked runs, reproducible splits, costs, and optimization gates.

## 5. CURRENT CODEX SESSION

**Goal:** complete Workstream A by connecting reusable claim evaluation, medical-risk routing, selective authority verification, sanitization, and publication policy to production gateway/mobile persistence.

**Implementation:** production gateway now evaluates every remote candidate after trusted span resolution; shared evaluator owns claims, grounding, contradictions, risk, verification, policy, sanitization, and reevaluation; mobile independently validates evaluation envelopes, persists original/sanitized provenance, auto-publishes only PUBLISH candidates, and explains held claims in review UI.

**Decisions:** production reuses benchmark-proven evaluation primitives without depending on benchmark experiment/reporting infrastructure. No paid provider calls, model changes, schema migration, immutable benchmark edits, or unrelated Workstream H configuration fixes.

**Validation:** 280 tests pass across Jest, benchmark/evaluation pytest, and gateway pytest; TypeScript passes. One pre-existing Expo environment inlining isolation test remains failing. Commands appear in section 14.

**Remaining:** native SQLite/device upload-to-offline-study E2E, durable deployment authority cache composition, broader authority coverage, and production deployment remain unverified. Workstream H owns deterministic Expo environment isolation.

## 6. IMPORTANT ARCHITECTURAL DECISIONS

- **Source fidelity != external medical truth.** Medically true can remain source-unsupported; external evidence never creates support.
- **Citation correctness != document support.** Coordinates prove location, not semantic support or medical truth.
- **Deterministic gates dominate pedagogy.** Expert quality may tighten disposition, never erase grounding/safety failure.
- **Provider abstraction stays model-agnostic.** Client uses gateway contract, never direct Gemini credentials.
- **Benchmark runs are immutable.** Child runs hash-link parents; existing directories cannot be overwritten.
- **Offline-first:** SQLite remains authoritative. Remote outages cannot break existing study/review or local fallback.
- **Source spans:** SHA-256 over UTF-8, UTF-16 offsets, zero-based half-open ranges; ambiguity stays unresolved.
- **Publication:** unsupported core rejects; removable optional unsupported material sanitizes; uncertainty/high-risk missing verification reviews; safe supported content publishes.
- **Sanitization requires reevaluation.** Deletion alone never proves publishability.

## 7. IMPORTANT FILES AND DIRECTORIES

- `AGENTS.md` — operating rules; Expo work requires exact v57 docs.
- `app/` — Expo Router screens/shell.
- `src/storage/database.ts` — schema v19, migrations/repairs, indexes, FTS.
- `src/storage/repository.ts` — import, generation persistence, approval, study/review workflows.
- `src/ingestion/` — readers, segmentation, extractive drafts, guides.
- `src/ai/` — provider/config, prompts, validation, spans, evaluation, policy, sanitization, quality.
- `src/auth/` — Supabase client/session.
- `src/scheduler/fsrs.ts` — FSRS creation, apply, replay, preview.
- `services/ai_gateway/` — FastAPI auth, limits, orchestration, Gemini, validation/retrieval.
- `services/card_evaluation/` — risk, verification, adapters/cache, policy contract.
- `services/card_benchmark/` — CLI, cache/resume, evaluators, phase runners, fixtures/tests.
- `services/source_span.py`, `services/source_span_contract.json` — Python spans and conformance fixture.
- `docs/architecture/` — architecture/safety contracts.
- `.github/workflows/quality.yml` — fast CI commands.
- `tmp/card-benchmark/` — ignored generated/cached evidence; immutable in place, never checkpoint by default.


## 8. DATABASE / SCHEMA / MIGRATION STATE

- Current `DATABASE_VERSION = 19`; initialization uses `PRAGMA user_version`, additive table creation, and column-repair helpers.
- Core tables: `decks`, `notes`, `cards`, `sources`, `source_segments`, `source_study_guides`, `card_evidence`, `generation_jobs`, `generated_candidates`, `review_events`, `memory_states`.
- Additional state: profiles, card quality/learning, tests, courses/modules, study sessions/activity, short-term mastery, calendar blocks, games, trash, sync operations.
- FSRS: `memory_states` stores initial/current serialized FSRS card, difficulty/stability/retrievability/due/version; `review_events` is append-only with reversible marker and session/mode metadata. Review writes are transactional.
- Provenance/evaluation: source hash/local URI; segment locator/text/offsets; evidence/support status; candidate span/evaluation/original JSON, disposition, versions, sanitization reason; generation provider/model/prompt/request/token/fallback metadata.
- Indexes cover active cards/decks, due memory, reviews, sources/segments, generation, learning state, tests, sessions, games, and calendar.
- Migration v19 is additive; legacy candidates default `REVIEW` and `legacy`. No schema change occurred in final repair. Native migration/device performance validation remains pending.

## 9. AI / PROVIDER / GATEWAY ARCHITECTURE

- Path: `generateDraftsForSource` -> `createGatewayCardGenerationProvider` -> `POST /v1/card-generation` -> `GenerationOrchestrator` -> `GeminiGenerationProvider` -> gateway validation -> client revalidation/persistence.
- Client abstraction: `CardGenerationProvider`; current server adapter Gemini only. Defaults are provider `gemini`, model `gemini-2.5-flash`. Canonical local benchmark used `gemini-3.5-flash`; that does not redefine production default.
- Auth: local static bearer or Supabase RS256/ES256 JWT/JWKS. Client retries one 401 after forced session refresh. Refresh tokens never reach gateway.
- Provider retries: default 4 total attempts for 429/500/502/503/504, timeout, and transport errors; full-jitter exponential delay capped at 16 seconds by default; bounded server retry hints. Auth/invalid requests are not retried.
- Gateway defaults: 300,000 request bytes, 180,000 input characters, 1–100 candidates. Gemini uses low thinking and 32,768 combined thinking/output tokens.
- Structured output is strict; segment IDs, spans, evaluation envelopes, quantity, and duplicates are revalidated. Gateway dispositions now reflect semantic claim evaluation; only final PUBLISH candidates enter normal study automatically.
- Benchmark defaults: 4 initial batches, 6 logical requests, 100k input/20k output token ceilings; deterministic balanced plan, per-batch cache, recoverable continuation, resume, append-only budget expansion, minimum 45 unique cards and target 56.
- Deterministic: schema/span/duplicate/quantity checks, local fallback, benchmark grounding/policy. Model-driven: candidate wording and optional SOL pedagogy evaluation.

## 10. SOURCE GROUNDING / SAFETY ARCHITECTURE

- **Source support:** claim-level citation/segment/document grounding against supplied source.
- **Citation correctness:** evidence coordinates/scope: exact, sufficient, partial, wrong, missing, overbroad, uncertain, or stale.
- **External medical correctness:** selective authority result, stored separately; it cannot change source support.
- **Medical risk:** deterministic routing for emergency, dose, lab/diagnostic thresholds, timing/frequency/action, contraindication/interaction, and numeric criteria.
- **PUBLISH:** eligible for automatic study after required gates.
- **SANITIZE:** preserve original, remove only unsupported removable optional content, then rerun full evaluation.
- **REVIEW:** hold outside automatic study due uncertainty, citation issue, unresolved high risk, external conflict, poor pedagogy, or incomplete evaluation.
- **REJECT:** preserve for audit; unsupported/contradicted core or unusable/safety-failing content never enters study.

## 11. BENCHMARK / EVALUATION STATE

- Pipeline covers extraction, segmentation, cards, claims, grounding, citations, validation, policy, source-only concepts, weighted coverage, semantic calibration/matching, blind comparison, pedagogy, selective verification, and optimization.
- Concept IDs derive from source/proposition/span/version, not list position. Matching is source-constrained with numeric/contradiction vetoes; matching is not medical verification.
- GPT-5.6 Sol High evaluator contract scores 15 dimensions and seeded A/B comparisons. Selective second pass is same-model self-consistency, never independent-rater agreement.
- Model benchmarking hides identity, discloses family overlap, preserves unknown currency cost, and applies safety/grounding/critical-coverage/citation vetoes.
- Canonical local runs: generation `2989a802173cfc05e313a135` (50 validated Gemini 3.5 Flash cards); phase 3 `e5fbe83b8d865684f81100a9`; span child `c22c1ea010b5e54e6df3b0a1`; optimization `840cb748beb9347964ac8834`, accepting deterministic span resolution only. Runs are ignored under `tmp/card-benchmark/`; inspected, not modified.


## 12. CURRENT MODEL QUALITY FINDINGS

Supported by canonical local artifacts only:

- Generation returned 50 validated cards: above 45 minimum, below 56 target.
- Frozen eligible concepts: 474. Barion weighted source coverage 15.4%; Quizlet 17.7%. Critical concept coverage in phase-6 summary is 0.0; no broad superiority claim is justified.
- Original phase-1 dispositions: 13 REJECT, 35 REVIEW, 2 SANITIZE. Span re-evaluation resolved all 50 legacy spans exactly and produced 12 REJECT, 37 REVIEW, 1 SANITIZE; phase-6 summary published none.
- Root-cause artifact records citation insufficiency/source ambiguity for all 48 held/rejected cards, source conflict for 10, timing risk 13, numeric risk 9, unsupported optional enrichment 3, and unsupported core answer 1. Counts overlap.
- Comparison scope had five shared concepts. Results favored Quizlet 3 and tied 2, with 100% same-model self-consistency; this is not independent review or enough for broad conclusions.
- Atomicity and active-recall differences were 0 on five pairs. Conciseness favored Quizlet by mean 0.6 (95% bootstrap interval -0.2 to 1.0). Global atomicity/conciseness remain unmeasured (`null`).
- Reliability mechanisms exist, but no production provider reliability rates are available.

## 13. ENVIRONMENT / CONFIGURATION

- Validated locally: Node `v22.22.2`, npm `10.9.7`, Python `3.12.10`, pytest `8.4.2`. CI pins Node `22.13.1`, Python `3.12`.
- Expo `~57.0.23`; before Expo code changes, read exact `https://docs.expo.dev/versions/v57.0.0/` docs per `AGENTS.md`.
- Install app with `npm ci`. Python CI installs `services/card_benchmark/requirements.txt`.
- Gateway: `python -m uvicorn services.ai_gateway.main:app --host 127.0.0.1 --port 8790` or `npm run gateway`.
- Environment names: `EXPO_PUBLIC_BARION_INGESTION_URL`, `EXPO_PUBLIC_BARION_AI_GATEWAY_URL`, `EXPO_PUBLIC_BARION_AI_MODEL`, local-only `EXPO_PUBLIC_BARION_AI_GATEWAY_TOKEN`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`; `BARION_AI_AUTH_MODE`, `BARION_AI_GATEWAY_AUTH_TOKEN`, `SUPABASE_URL`, `BARION_AI_JWT_AUDIENCE`, `BARION_AI_MAX_ACCESS_TOKEN_LIFETIME_SECONDS`, `GEMINI_API_KEY`, `PRIMARY_GENERATION_PROVIDER`, `PRIMARY_GENERATION_MODEL`, `BARION_AI_ALLOWED_ORIGINS`, provider timeout/retry variables, request/input limits, `BARION_ALLOWED_ORIGINS`, `BARION_WEB_PORT`, `BARION_METRO_PORT`.
- `.env` and gateway `.env` are ignored. Never place provider secrets in `EXPO_PUBLIC_*`.
- No OmniRoute dependency/workflow was found. Do not assume it is required.

## 14. TEST STATUS

### PASSING

Run against final product-code state before handoff-only documentation/ignore changes:

- `npm run typecheck` — pass.
- `npm test -- --runInBand` equivalent direct Jest run — 25 suites passed, 132 tests passed; one known configuration-isolation test failed.
- `python -m pytest services/card_evaluation/tests services/card_benchmark/tests -q` — 102 passed.
- `python -m pytest services/ai_gateway/tests -q` — 46 passed.

Final checks after handoff/hygiene edits:

- `python -m compileall -q services` — pass.
- `git diff --check` — pass.
- Full handoff re-read/repository cross-check — complete.

Total executed tests: **280 passed, 1 known failure**.

### FAILING

- `src/ai/__tests__/config.test.ts` — Expo statically inlined public environment values prevent runtime deletion from isolating optional gateway configuration. Existing Workstream H defect; unrelated to Workstream A.

### NOT RUN

- Playwright E2E; requires running web/gateway setup and prior docs mark it pending.
- Native iOS/Android builds, device tests, migration/performance tests, live malformed-file fuzzing.
- Live Gemini, DailyMed, or paid SOL calls. Intentionally avoided.
- Expo production bundle/build. Existing product code passed TypeScript/Jest; final edits were documentation/ignore only.

## 15. KNOWN BUGS / LIMITATIONS / TECHNICAL DEBT

- Production authority coverage is currently DailyMed-focused. Claims requiring an unsupported authority category or unavailable authority remain `REVIEW`.
- Gateway rate limiter is process-local; multi-instance deployment needs shared atomic storage and edge controls.
- Production deployment, TLS/edge policy, monitoring, penetration test remain open.
- Native PDFs need ingestion service; scanned PDFs need unimplemented OCR.
- Browser source persistence depends on picker/blob availability; original bytes are not copied durably like native files.
- Bari chat retrieval is foundation, not complete product behavior.
- Canonical comparison has five shared concepts and no independent human review. Coverage is low and critical coverage zero.
- Dataset registry values satisfy 64-character hash format; source fixture bytes are absent, so they cannot be independently recomputed here.
- Older completion/setup docs contain stale counts, placeholders, and machine-specific `cd` examples. They are non-authoritative.
- Worktree contains uncommitted Workstream A production-evaluation integration only; no commit was created during implementation.

## 16. GIT STATE

- Branch: `master`.
- HEAD: `b7b9bebb16cf4fbaf8e3f77e1ec386605f932236` (accepted transition checkpoint).
- Working tree: **not clean**. Current changes are Workstream A evaluator, gateway, TypeScript contract, persistence, review UX, deterministic tests, and documentation.
- Staged files: none. No commit created.
- Modified groups: source-review UI; gateway models/orchestration/validation; benchmark compatibility exports; shared evaluation policy/models; TypeScript evaluation/validation/policy; candidate persistence; tests/docs.
- Untracked intended groups: shared evaluation implementation/fixtures/tests, gateway contract test, and mocked production evaluation flow test.
- Ignored local-only items: root `.env`, `output/`, `dist/`, `.expo/`, `tmp/`, `services/ai_gateway/venv/`, `__pycache__`, `.pytest_cache`, `node_modules/`. Never stage them. Generated benchmark runs remain under ignored `tmp/card-benchmark/`.

## 17. AUTHORITATIVE SPECIFICATIONS

1. `AGENTS.md` and Expo v57 versioned docs.
2. This `docs/AI_HANDOFF.md` for current repository/transition state.
3. `docs/architecture/implementation-plan.md` for offline study/product invariants.
4. `docs/architecture/card-evaluation-production.md` for evaluation boundaries/integration gap.
5. `docs/architecture/source-span-provenance.md` and `services/source_span_contract.json`.
6. `docs/architecture/benchmark-methodology.md` and `services/card_benchmark/README.md`.
7. `docs/architecture/ai-gateway-authentication.md`, `services/ai_gateway/README.md`, and security review.
8. `services/card_evaluation/policy_contract.json` for cross-language publication conformance.
9. `.github/workflows/quality.yml` for CI gates.

Older testing/setup/completion/telemetry notes may help historically but contain stale or planned claims. Verify against code.

## 18. DO-NOT-REGRESS RULES

- Do not manually edit generated benchmark results.
- Do not weaken grounding/safety to raise publication rate.
- Do not let external medical correctness create source support.
- Do not treat substring/span match as claim support or medical verification.
- Do not fabricate or trust provider-supplied citation offsets.
- Do not hide underproduction, partial batches, failed verification, or uncertainty.
- Do not break offline study, SQLite authority, append-only reviews, or local fallback.
- Do not duplicate provider/evaluator/policy/span infrastructure.
- Do not let pedagogy override grounding or safety.
- Do not publish unsupported core; sanitize only removable optional content and reevaluate.
- Do not introduce machine-specific paths or expose secrets/tokens/source documents in logs.
- Do not stage `.env`, virtual environments, caches, `tmp/`, `output/`, or blind-review keys.

## 19. NEXT RECOMMENDED IMPLEMENTATION TASK

**Objective:** after Workstream A review/acceptance, begin Workstream B generation reliability and completeness.

**Why next:** production safety decisions now run end to end. Highest remaining production risk is rigid one-shot generation (`target=56`, `minimum=45`) that can discard recoverable partial progress or misrepresent completeness.

**Expected scope:** reuse benchmark-proven batching/continuation primitives for bounded batches, stable IDs, persisted checkpoints, duplicate-safe merge, explicit completion states, and concept-aware gap continuation. Do not clone benchmark reporting infrastructure into production.

**Required validation:** gateway/provider retry and partial-success tests, checkpoint/resume tests, duplicate-safe persistence tests, mocked interrupted-generation E2E, TypeScript tests/typecheck, Python compile checks, and `git diff --check`.

## 20. CODEX TRANSITION NOTES

- Start from uncommitted Workstream A worktree; do not reset, clean, or assume untracked evaluation files are disposable.
- `tmp/` and `services/ai_gateway/venv/` are intentionally ignored; generated runs still exist locally as evidence, not commit inputs.
- Transition checkpoint is `b7b9bebb...`; Workstream A changes remain uncommitted pending review.
- Immutable benchmark runs remain untouched. Never fix generated reports in place.
- Production app deploys shared evaluator logic end to end; remaining generation completeness, concept targeting, native offline validation, and authority breadth are separate follow-up workstreams.
- `.env.example` uses `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, while `src/auth/supabaseClient.ts` reads `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Resolve deliberately during checkpoint review; never expose real values.


