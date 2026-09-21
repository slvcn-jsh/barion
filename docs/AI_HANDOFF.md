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
- **Evaluation:** `services/card_benchmark/` handles structural extraction, source-only concept inventory, claim decomposition, grounding, citations, risk/verification integration, pedagogy, and policy. `services/card_evaluation/` owns reusable risk, authority verification, secure retrieval/cache, and policy. TypeScript mirrors production contracts.
- **Study:** approved/manual cards share local card/evidence path. `ts-fsrs` drives review; review events are append-only, memory state is recalculated cache, non-recall modes stay separate from durable FSRS.
- **Offline:** SQLite study/review works offline. Remote generation failure uses local extraction. Authority checks may use valid cache; required high-risk checks without cache remain held.

## 3. CURRENT END-TO-END FLOW

1. **WORKING:** picker import -> file persistence/hash -> duplicate detection -> source row/source-owned deck.
2. **WORKING:** PDF/text extraction -> page locators -> segmentation -> source segments and study guide.
3. **WORKING:** `generateDraftsForSource()` -> gateway/session token -> Gemini structured generation and deterministic validation; any failure -> local extractive candidates.
4. **WORKING:** trusted evidence-span resolution -> candidate/provenance/evaluation persistence -> review UI.
5. **PARTIAL:** gateway candidates are span-verified, but semantic claim grounding is absent from gateway request path; they intentionally receive `REVIEW`. Exact local extractive candidates can receive `PUBLISH` and pass quality threshold.
6. **PARTIAL:** claim/risk/external-verification/publication stack exists and is benchmark-tested, but is not wired end-to-end into gateway persistence.
7. **WORKING:** approval/manual creation -> cards/evidence/initial FSRS -> offline study, testing, review, undo, calendar, backup.
8. **NOT YET INTEGRATED:** production authority routing/external verification in deployed flow; live mobile upload-to-offline-study E2E; production monitoring/deployment.

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
- Atomic claims, grounding/citation/numeric/contradiction checks, selective risk routing, secure DailyMed adapter, cache, pedagogy rubric, and PUBLISH/SANITIZE/REVIEW/REJECT policy.
- Sanitization preserves original, removes optional unsupported fields only, and requires reevaluation.
- Governed fixtures, structural extraction, frozen inventories, weighted coverage, semantic matching, blind review, SOL evaluator contract, immutable hash-linked runs, reproducible splits, costs, and optimization gates.

## 5. CURRENT CLINE SESSION

**Goal:** restore interrupted AI/card-benchmark work to valid, fully tested state, then prepare Codex handoff without new feature work.

**Implementation:** fixed malformed braces in `src/ai/evaluation.ts`; replaced undefined `input()` with explicit prompt-injection fixture in `src/ai/__tests__/prompts.test.ts`; restored eight valid 64-character SHA-256-formatted values in `services/card_benchmark/fixtures/dataset_registry.json`; added this handoff; changed machine-specific source-span documentation path to repository-relative form; expanded ignore rules for `tmp/`, Python virtual environments, and pytest caches.

**Decisions:** no paid calls, live authority calls, generated benchmark edits, scope expansion, broad cleanup, destructive deletion, or blind staging. Existing generated runs remain untouched.

**Validation:** 259 tests pass across Jest, benchmark/evaluation pytest, and gateway pytest; TypeScript passes. Commands appear in section 14.

**Remaining:** broad worktree contains intentional multi-phase work predating this repair. It is not clean and was not committed. Native/device E2E and production deployment remain unverified.

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
- Structured output is strict; segment IDs, evidence, quantity, and duplicates are revalidated. Gateway candidates stay `REVIEW` because claim support is not evaluated.
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
- `npm test -- --runInBand` — 16 suites, 122 tests passed.
- `python -m pytest services/card_evaluation/tests services/card_benchmark/tests -q` — 94 passed.
- `python -m pytest services/ai_gateway/tests -q` — 43 passed.

Final checks after handoff/hygiene edits:

- `python -m compileall -q services` — pass.
- `git diff --check` — pass.
- Full handoff re-read/repository cross-check — complete.

Total executed tests: **259 passed**.

### FAILING

- None in executed suites.

### NOT RUN

- Playwright E2E; requires running web/gateway setup and prior docs mark it pending.
- Native iOS/Android builds, device tests, migration/performance tests, live malformed-file fuzzing.
- Live Gemini, DailyMed, or paid SOL calls. Intentionally avoided.
- Expo production bundle/build. Existing product code passed TypeScript/Jest; final edits were documentation/ignore only.

## 15. KNOWN BUGS / LIMITATIONS / TECHNICAL DEBT

- Semantic claim evaluation and production authority routing are not wired into gateway-to-SQLite flow; remote cards remain `REVIEW`.
- Gateway rate limiter is process-local; multi-instance deployment needs shared atomic storage and edge controls.
- Production deployment, TLS/edge policy, monitoring, penetration test remain open.
- Native PDFs need ingestion service; scanned PDFs need unimplemented OCR.
- Browser source persistence depends on picker/blob availability; original bytes are not copied durably like native files.
- Bari chat retrieval is foundation, not complete product behavior.
- Canonical comparison has five shared concepts and no independent human review. Coverage is low and critical coverage zero.
- Dataset registry values satisfy 64-character hash format; source fixture bytes are absent, so they cannot be independently recomputed here.
- Older completion/setup docs contain stale counts, placeholders, and machine-specific `cd` examples. They are non-authoritative.
- Worktree contains large preexisting multi-phase modified/untracked implementation. No safe clean commit boundary was assumed.

## 16. GIT STATE

- Branch: `master`, 3 commits ahead of `origin/master`.
- HEAD: `23a71da5d02ad89e4a9ccfabf889878de3868f56` (`feat: enforce minCandidates; add segment-based grounding audit`).
- Recent relevant commits: `5b3cd45 test(ai): verify resilient local fallback provenance`; `1be316e feat(ai): add grounded Gemini gateway`; remote baseline `1fb6184 checkpoint: working Barion version before Cline integration`.
- Working tree: **not clean**. Before final handoff edits: 37 modified tracked paths and 97 untracked status entries; most represent prior multi-phase work. Handoff/hygiene paths add to this state.
- Staged files: none. No commit created.
- Modified groups: env/ignore/agent rules; app auth/source-review UI; package/Jest; gateway; benchmark integration; client AI; trust/domain/ingestion/storage.
- Untracked intended groups: CI workflow, auth/sign-in, client AI evaluation/span tests, gateway tests/retrieval, benchmark/evaluation implementations/fixtures, architecture/deployment docs, handoff.
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

**Objective:** review and checkpoint current multi-phase work into a coherent Git commit, without product changes.

**Why next:** implementation and focused validation are green, but repository remains heavily modified/untracked. Codex needs a durable baseline before development; blind staging risks local environments, caches, generated evidence, stale docs, or unrelated assets.

**Expected scope:** classify all modified/untracked paths by subsystem; reconcile intended source/tests/docs/config versus local/generated/stale material; reconcile `.env.example` Supabase variable naming; scan secrets; stage only intended files; inspect staged diff; rerun fast CI gates; commit with transition checkpoint message. Never alter immutable benchmark runs.

**Required validation:** `python -m pytest services/card_evaluation/tests services/card_benchmark/tests services/ai_gateway/tests -q`, `npm run typecheck`, `npm test -- --runInBand`, `python -m compileall -q services`, `git diff --cached --check`, secret/path scan, final status/staged diff.

## 20. CODEX TRANSITION NOTES

- Start from dirty worktree; do not reset, clean, or assume untracked means disposable. Much implementation exists only as untracked files.
- `tmp/` and `services/ai_gateway/venv/` are intentionally ignored; generated runs still exist locally as evidence, not commit inputs.
- No transition commit exists. First Codex task is checkpoint review only; do not begin another feature first.
- Canonical artifacts reference dirty HEAD `23a71da...`; preserve hashes/immutability. Never fix reports in place.
- Production app holds model cards at `REVIEW`; benchmark sophistication is not deployed end-to-end integration.
- `.env.example` uses `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, while `src/auth/supabaseClient.ts` reads `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Resolve deliberately during checkpoint review; never expose real values.


