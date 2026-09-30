# Overnight Engineering Log

## 2026-09-29 03:30 +08:00 — Iteration 1

- Problem investigated: generation persistence, transaction ownership, durable job idempotency, and startup recovery.
- Evidence: transaction regression and 60-candidate browser proof pass; generation jobs lack stable logical identity; queued retries create replacement jobs; local and Smart attempts share one counter; interrupted local jobs resume through Smart path; recoverable retries have no terminal cap.
- Root cause: job lifecycle is keyed by transient row/request IDs and source-level runtime promise only. Persisted purpose and equivalence identity are absent.
- Files changed: recovery documentation and implementation blueprint only at iteration start.
- Tests run: focused Jest 3 suites / 8 tests pass; TypeScript pass; previous unchanged-tree full evidence remains 45 Jest suites / 248 tests, 198 Python tests, 3 focused Playwright flows.
- Result: current transaction fix accepted; durable idempotency selected as next P2 task.
- Remaining risk: interrupted remote publication cannot yet reuse an already validated batch after process loss.
- Next task: implement purpose-aware stable generation identity and bounded in-place retry.

## 2026-09-29 09:55 +08:00 — Iteration 2

- Problem investigated: publication retry after successful provider generation.
- Evidence: previous failure matched test fake's literal SQL, while product SQL binds status as parameter.
- Root cause: test double failed to recognize parameterized publishing transition; product retry path was not disproven.
- Files changed: generation publication retry and integration test fake/assertions.
- Tests run: TypeScript pass; focused Jest 3 suites / 25 tests pass; full Jest 45 suites / 254 tests pass.
- Result: transient publication failure retries once with retained candidates; permanent failure records `publicationFailureCount=2`; provider call count remains one logical generation.
- Remaining risk: process death after provider response cannot reuse in-memory candidates because durable candidate checkpoint precedes publication only within current process.
- Next task: verify browser flow, then document milestone.

## 2026-09-29 10:20 +08:00 — Iteration 3

- Problem investigated: focused Playwright validation stalled without test output.
- Evidence: app endpoint returned HTTP 200; runner emitted only gateway-token warning; no assertion failure or test start appeared.
- Root cause: managed Windows Playwright/web-server lifecycle remains unstable; application layer not implicated by available evidence.
- Files changed: none.
- Tests run: one Playwright attempt, interrupted after new process/port diagnostics; no repeated retry.
- Result: browser proof remains previous completed 3/3 run; current attempt recorded as environment blocker.
- Remaining risk: current-tree browser proof for publication retry not captured.
- Next task: continue independent Bari AI architecture work.

## 2026-09-29 11:10 +08:00 — Iteration 4

- Problem investigated: model-specific configuration, incomplete evaluation envelope, and unsafe data-flywheel ambiguity.
- Evidence: existing benchmark already owns immutable runs/splits/gates; raw model defaults remained duplicated; dataset registry lacked record-level training eligibility; official Google docs exclude Gemini 3.8 Flash from SFT support.
- Root cause: missing central task/model policy and explicit inference-versus-training contracts, not missing evaluator service.
- Files changed: gateway policies/telemetry/config/health, benchmark evaluation/governance, dataset schemas, tests, AI documentation.
- Tests run: 106 focused Python tests pass; full Python service suite 207 tests pass; TypeScript passes; Python source compile passes with pytest-cache access warning only.
- Result: provider-neutral policy registry, complete evaluation record, privacy/license/consent gates, feedback-label separation, and verified SFT plan implemented without paid calls.
- Remaining risk: no human-reviewed gold dataset, shadow traffic, canary, or production cost/reliability evidence.
- Next task: curate authorized gold fixtures and run frozen baseline comparisons before considering SFT.

## 2026-09-29 11:15 +08:00 — Iteration 5

- Problem investigated: global gateway model/retry configuration prevented task-specific routing and complete logical-model provenance.
- Evidence: card and chat shared one provider instance; Phase 6 lacked standard evaluation envelope; successful card telemetry referenced global policy constants instead of injected effective policy.
- Root cause: provider construction owned configuration globally while task registry remained descriptive rather than runtime-effective.
- Files changed: gateway policy/config/routing/provider/telemetry tests, Phase 6 evaluation persistence, environment/deployment docs, AI architecture docs.
- Tests run: focused Phase 6 tests 23 pass; full Python services 215 pass; TypeScript pass; Jest 45 suites / 254 tests pass; diff whitespace check pass.
- Result: card generation and Bari Chat have independent model/fallback/retry chains, each startup deadline is bounded, logical and physical provenance is recorded, and owned providers close once.
- Remaining risk: no authorized human-reviewed gold dataset, deployed cost/reliability evidence, native release proof, or stable managed-shell Playwright lifecycle.
- Next task: curate approved gold fixtures, then execute frozen baseline prompt/retrieval comparisons. Do not launch paid SFT.

## 2026-09-29 11:32 +08:00 — Iteration 6

- Problem investigated: evaluation harness could accept an isolated intervention but lacked a distinct executable production model-promotion gate.
- Evidence: no-network historical Phase 6 replay produced `ACCEPT` for citation resolution while card publication acceptance was 0, source coverage was 0.1541, and human/latency/cost/reliability metrics were absent.
- Root cause: experiment decision and model promotion were documented concepts but only experiment decision existed in code.
- Files changed: promotion thresholds/decision logic, immutable promotion runner, deterministic tests, benchmark and AI documentation.
- Tests run: promotion tests 15 pass; full card-benchmark suite 107 pass; full Python service suite 222 pass.
- Result: model promotion now requires comparable dataset/schema identities, explicit complete thresholds, complete evidence, absolute bounds, and baseline regression checks. Missing evidence returns `INCONCLUSIVE`.
- Remaining risk: production threshold values and licensed human-reviewed data require owner/legal/privacy decisions; historical cache cannot be reused because request identity changed.
- Next task: approve threshold values and gold data, then generate comparable baseline and candidate envelopes without stale-cache reuse.

## 2026-09-29 12:10 +08:00 — Iteration 7

- Problem investigated: architecture was reliable but promotion inputs, human-quality claims, lint/release gates, and medical reviewer evidence remained incomplete.
- Evidence: promotion thresholds accepted non-finite latency/cost values; evaluation runner accepted unversioned/incomplete identities; user-facing notes called heuristic scores medical `quality`; no lint gate or EAS production profile existed.
- Root cause: trust-boundary validation and release evidence lagged behind source-to-study architecture; existing blind review captured too few target-user dimensions.
- Files changed: benchmark promotion/evaluation/blind-review code and tests, card quality copy, local draft notes, Expo lint/CI configuration, EAS/app configuration, and engineering/AI documentation. Bari 3D untouched.
- Tests run: 24 focused promotion tests, 21 targeted Jest tests, 116 benchmark tests, 231 full Python service tests, 45 Jest suites / 254 tests, TypeScript, ESLint, Python compile, Expo web export, npm production audit, and unstaged diff check.
- Result: all executable gates pass; ESLint has 0 errors and 73 warnings; npm production audit has 0 high/critical and 15 moderate transitive findings.
- Remaining risk: staged workspace curation, human reviews, promotion thresholds, crash-reporting provider/privacy choice, deployed auth/Gemini canaries, and signed native builds require owner/external action.
- Next task: independent rubric-v2 medical review, then deployed release evidence. No SFT or 3D expansion.

## 2026-09-29 16:20 +08:00 — Iteration 8

- Problem investigated: whether paid Gemini Smart Generation is currently fast, reliable, grounded, terminal, idempotent, and useful in a real browser.
- Evidence: 13 paid card and three paid chat requests returned HTTP 200 with no returned 503 or fallback; representative card P50 was 3.533 seconds and observed max was 8.398 seconds; live browser produced seven local cards in 2.337 seconds and terminal ready state in 6.766 seconds.
- Root cause: successful provider retries/failover were discarded before telemetry, success logs had no effective uvicorn sink, and remote publication globally retired untouched local cards even when only five of seven targets received selected AI replacements.
- Files changed: gateway provider-result diagnostics, failover/orchestration telemetry, uvicorn telemetry routing, target-scoped generation merge, regression tests, and engineering documentation. Bari 3D untouched.
- Tests run: full Jest 45 suites / 255 tests, full Python services 232 tests, gateway 88 tests, TypeScript, ESLint, Python compile, targeted transaction/generation tests, paid gateway canaries, and live Expo web browser flow.
- Result: final live browser request used Gemini 3.8 Flash attempt 1 with zero retries/fallback; reload made no duplicate call; source remained ready and studyable; seven-card local coverage remained after five AI replacements.
- Remaining risk: small local sample cannot prove production availability; deployed auth/config, billing tier/quota, sustained cost/SLO, native builds, human medical review, and process-loss candidate checkpoint remain incomplete.
- Next task: deployed Supabase-authenticated canary and signed native release proof, then independent medical review and frozen promotion evaluation.

## 2026-09-30 01:48 +08:00 — Iteration 9

- Problem investigated: evaluator trustworthiness, numeric false contradictions, process-loss after successful AI generation, REVIEW accounting, and recovered provenance.
- Evidence: frozen evaluator calibration scored 0.8 label/disposition accuracy with one false acceptance and one false rejection; qualified initial/later doses triggered numeric contradiction; validated remote candidates existed only in memory before publication; resumed jobs used current configured model identity; corrupt checkpoints could requeue without incrementing attempts.
- Root cause: deterministic numeric checks ignored semantic role, publication lacked durable candidate state, checkpoint parser trusted nested data, recovery conflated original and current provider identity, and held candidates shared rejected accounting.
- Files changed: card evaluator validation/tests; evaluator calibration fixtures/harness/tests; generation checkpoint module/tests; batch provenance; schema version 27; generation repository/integration tests; backup compatibility test; engineering and benchmark documentation.
- Tests run: TypeScript pass; focused Jest 4 suites / 42 tests; full Jest 46 suites / 267 tests; Python service suite 233 tests with unique system-temp basetemp; Expo lint 0 errors / 73 warnings; diff whitespace check pass.
- Result: qualified numeric values no longer falsely contradict; validated batches survive restart without another provider request; original provider/model/prompt provenance survives configuration changes; malformed checkpoints fail once and clear; REVIEW candidates remain held/non-studyable with accurate counts.
- Remaining risk: semantic paraphrases still false-reject and trivial items still false-accept; AI-only ready-to-study migration remains blocked. Default workspace `.tmp_pytest` is inaccessible on Windows but isolated basetemp passes.
- Next task: obtain authorized blinded medical labels and evaluate a source-bounded semantic verifier against frozen calibration before changing publication policy or removing local studyable cards.

## 2026-09-30 01:56 +08:00 — Iteration 10

- Problem investigated: frozen evaluator accepted a source-supported typography question as a studyable learning item.
- Evidence: baseline calibration scored 0.8 label/disposition accuracy with one `BAD_LEARNING_ITEM` classified `ENTAILED/PUBLISH`; focused trace showed no educational-value validator owned document mechanics.
- Root cause: schema and grounding checks could prove literal support but did not distinguish source facts from questions about document presentation.
- Files changed: card evaluator validation/contract/tests, gateway evaluation model/tests, TypeScript evaluation parsing/tests, evaluator calibration classification/trace/tests, benchmark README, and engineering status documents.
- Tests run: 35 focused Python evaluator/contract tests; 244 Python service tests; 46 Jest suites / 267 tests; TypeScript; Expo lint with 0 errors / 73 existing warnings; frozen calibration rerun.
- Result: explicit document-mechanics items fail with `LOW_EDUCATIONAL_VALUE`; concise medication, anatomy, and developmental targets remain publishable; calibration improves to 0.9 with zero false acceptances and one unchanged semantic false rejection. Exact validator codes now survive Python and TypeScript contract boundaries.
- Remaining risk: rule covers evidenced document mechanics, not general semantic educational quality. Legitimate paraphrases can still false-reject, so AI-only publication remains deferred.
- Next task: obtain authorized blinded medical labels and compare current deterministic grounding with a source-bounded semantic verifier. Do not hardcode synonym exceptions.

## 2026-09-30 02:31 +08:00 — Iteration 11

- Problem investigated: whether source-bounded semantic verification can safely correct deterministic paraphrase false rejection without increasing false acceptance.
- Evidence: one paid Gemini 3.8 Flash structured batch evaluated 10 project-authored cases in 3.187 seconds using 1,007 input and 560 output tokens. It corrected the paraphrase but classified repeated-evidence ambiguity as entailed.
- Root cause: semantic claim entailment does not own deterministic evidence-span ambiguity; replacing deterministic verification with an LLM judge loses provenance-resolution guarantees.
- Files changed: semantic-verifier experiment, blinded label-review preparation/locking, deterministic tests, benchmark/evaluation documentation, production-readiness report, and recovery handoff.
- Tests run: 18 focused semantic/calibration/review tests, 257 full Python service tests, Python compile, and TypeScript pass. Live provider request returned structured output successfully with no retry.
- Result: experiment now records raw challenger and progressive hybrid ablations, privacy-safe metrics, model/prompt/schema/commit lineage, token/latency data, and fail-closed label authorization. Offline reuse of the paid response gives hybrid 1.0 accuracy with zero false acceptance/rejection on 10 diagnostic cases.
- Remaining risk: dataset is small, project-authored, and not independently medically reviewed. Hybrid remains experimental and does not affect production publication.
- Next task: complete two independent copies of `tmp/evaluator-label-review-20260930-023516.json` with one medical student and one clinician/medical educator/subject-matter expert, adjudicate disagreements, lock reviewed fixture, then rerun hybrid comparison.

## 2026-09-30 12:01 +08:00 — Iteration 12

- Problem investigated: owner-authorized benchmark sources remained local-only and model-generated labels could be trusted from shallow approval metadata.
- Evidence: `tmp/barion_quizlet_benchmark_v1` contains ten manifest sources plus eight hidden evaluation artifacts; immutable run `2989a802173cfc05e313a135` contains 50 cards with resolvable evidence; prior calibration accepted incomplete review declarations.
- Root cause: source authorization, immutable artifact provenance, content-free registry, and cross-role case-level consensus were separate manual assumptions instead of enforced contracts.
- Files changed: authorized source registry and tests; evaluator fixture/review/calibration/semantic-verifier trust checks; content-free dataset registries; benchmark, evaluation, governance, production-readiness, and handoff documentation.
- Tests run: focused authorization/reviewer suite 37 pass; card benchmark suite 153 pass; combined Python services 276 pass; TypeScript pass; Jest 46 suites / 267 tests pass.
- Result: ten-source pack and psychiatric source are authorized permanent evaluation/training-curation candidates; raw content and hidden gold stay out of Git; a 50-case unlabeled fixture and blinded packet are prepared; generated cases remain inference-only.
- Remaining risk: no independent medical labels exist yet, so production hybrid verification, training export, and SFT remain blocked.
- Next task: obtain complete independent medical-student and clinical/education review, adjudicate disagreements, lock the 50-case fixture, then rerun frozen deterministic-versus-hybrid evaluation.

## 2026-09-30 12:18 +08:00 — Iteration 13

- Problem investigated: authorized multi-format sources had identity records but no proof that current extraction and segmentation could prepare them safely for generation.
- Evidence: pack spans PDF, Markdown, TXT, and paste inputs; existing benchmark CLI was PDF-specific and hidden gold must remain outside generation inputs.
- Root cause: source authorization and source-pipeline readiness were not connected by a content-free, provider-free preflight step.
- Files changed: authorized pack preflight module/tests, shared registered-text extraction, benchmark plan/docs, production-readiness and handoff records.
- Tests run: focused registry/preflight tests 6 pass; combined Python services 279 pass; real pack preflight 10/10 ready, zero blockers, zero provider calls.
- Result: every registered source now verifies exact bytes/extracted text and produces stable generation segments; hidden evaluation directory is not read; report contains no raw content.
- Remaining risk: PDF table and multi-column warnings may affect downstream card quality; no ten-source paid baseline or hidden-gold score exists yet.
- Next task: execute a bounded native-default Gemini baseline on all ten sources, preserve first-pass artifacts, then score after generation without leaking hidden gold into prompts.
