# Autonomous Engineering Handoff

## Current objective

Run and score the authorized ten-source native-default Gemini baseline; independently complete cross-role labeling of the prepared 50-case blinded fixture before changing production publication policy.

## Current repository status

- Branch: `master` at `8b44d54`; large pre-existing staged workspace preserved.
- Transaction, generation-job, publication-retry, AI-policy, dataset-governance, tests, and docs changes remain unstaged over staged versions.
- Card-generation and Bari Chat routing/configuration changes remain uncommitted with the preserved workspace.
- Database schema is version 27 with nullable generation candidate checkpoint storage; migration is additive and backup-compatible.
- Validated remote batches resume after restart without another provider request; corrupt checkpoints fail terminally and clear for later explicit retry.
- Paid local canaries and final live browser flow pass; no secrets were printed or added.
- No reset, cleanup, revert, commit, or push performed.
- Local pytest output directories remain untracked and untouched.
- Workspace `.tmp_pytest` is inaccessible to current process. Full Python suite passes with unique system-temp `--basetemp`; locked directory was not deleted or altered.
- Owner authorization is recorded for `tmp/card-benchmark/PDF_INPUT.pdf` and all ten sources in `tmp/barion_quizlet_benchmark_v1` for permanent evaluation and training-data curation.
- Raw sources, hidden gold, generated fixtures, and review packets remain git-ignored; content-free tracked registries preserve exact identities and policy state.

## Completed during this run

- Verified Expo SDK 57 documentation before code changes.
- Revalidated FIFO SQLite writer and generation transaction fix.
- Completed one bounded publication retry using retained validated candidates; provider is not recalled.
- Verified durable purpose/key identity, completed-result reuse, automatic Smart Enhancement queue, bounded in-place retry, and active-job UI polling.
- Added provider-neutral model/task policy registry with card-generation and Bari Chat policy provenance in health/telemetry.
- Added independent card/chat model, fallback, timeout, retry, temperature, and thinking policies with separately owned provider chains.
- Added effective-policy telemetry, logical/physical model provenance, independent deadline validation, and provider lifecycle coverage.
- Added complete evaluation-run metric envelope to existing immutable benchmark harness.
- Added Phase 6 `evaluation_run.json` with logical model ID, physical model version, configuration, and strict commit-SHA validation.
- Added immutable no-network model-promotion runner with explicit thresholds and fail-closed `PROMOTE`/`REJECT`/`INCONCLUSIVE` outcomes.
- Replayed existing Phase 6 evidence without provider calls; historical run remains non-promotable because required metrics are absent.
- Added dataset/training eligibility and feedback-label validators plus versioned JSON Schemas.
- Documented Bari AI architecture, model strategy, evaluation, dataset governance, model registry, and evidence-based SFT plan.
- Verified official Google docs: Gemini 3.8 Flash is not SFT-supported; Gemini API/AI Studio currently provide no fine-tunable model.
- Hardened promotion thresholds against `NaN`/infinity and required compatible, complete evaluation envelopes.
- Replaced user-facing `quality` percentages with explicit automated-check score language.
- Upgraded blind medical review to rubric v2 with medical-student and clinical/education authority gates plus human acceptance output.
- Added Expo SDK 57 ESLint configuration, package scripts, and CI gate; current result is 0 errors and 73 warnings.
- Added explicit EAS store-production profile and scripts; removed undocumented app-config cleartext flag after verifying release/debug manifest separation.
- Froze Bari 3D scope; no 3D code or asset changes made during this iteration.
- Ran 13 bounded paid card requests and three source-strict Bari Chat requests: all returned HTTP 200; no returned 503 or fallback use.
- Measured representative card P50 3.533 seconds and nearest-rank P95/max 8.398 seconds; 30/30 candidate evidence spans were exact.
- Verified live browser TTFLC 2.337 seconds and terminal ready 6.766 seconds, with study controls usable and no duplicate request after reload.
- Preserved uncovered local cards during partial Smart Enhancement by replacing only selected concept targets.
- Added successful retry/failover diagnostics and reliable uvicorn telemetry routing; final live request recorded attempt 1, retry count 0, and no fallback.
- Added privacy-safe evaluator calibration harness with 10 frozen project-authored cases and end-to-end diagnostic traces.
- Fixed deterministic numeric contradiction logic so qualified initial/later values do not conflict while same-role value conflicts still reject.
- Added durable validated-candidate checkpoints before remote publication. Recovery uses checkpoint without provider access, preserves original generation provenance, and clears checkpoint only after commit.
- Made corrupt checkpoint recovery terminal and bounded; existing cards remain ready, automatic retry cannot loop, and later explicit retry starts cleanly.
- Made `REVIEW` candidates held/pending instead of rejected or auto-published; persisted held counts and `review-ready` source state are accurate.
- Retained no-concept batch provenance so request/model/token diagnostics survive publication and checkpoint recovery.
- Added deterministic low-educational-value rejection for explicit document mechanics while preserving concise medication, anatomy, and developmental answers.
- Improved frozen evaluator calibration to 0.9 label/disposition accuracy with zero false acceptances; one known semantic-paraphrase false rejection remains visible.
- Added explicit validator-code metadata to production evaluation contracts; gateway validation and TypeScript parsing preserve it without breaking older responses.
- Added isolated source-bounded semantic-verifier experiment with structured output, bounded paid inference, privacy-safe reports, label-authorization gates, and deterministic-versus-semantic ablation.
- Ran one 10-case Gemini 3.8 Flash diagnostic batch: 3.187 seconds, 1,007 input tokens, 560 output tokens. Raw semantic accuracy was 0.9 with one false acceptance and zero false rejections.
- Proved progressive hybrid ownership using the same persisted response without another provider call: deterministic ambiguity/safety vetoes plus semantic escalation only for `UNSUPPORTED` scored 1.0 on the 10 diagnostic cases with zero false acceptances/rejections.
- Added blinded evaluator-label packet generation and consensus locking. Gold labels/rationales stay hidden during review; two complete cross-role reviews are required; disagreement blocks; original fixture is immutable.
- Hardened model-generated calibration so shallow approval metadata cannot authorize labels; complete case-level cross-role consensus, reviewer-file hashes, timezone-aware lock time, and source-fixture hash are required.
- Added content-free authorized-source registration with path containment, manifest/gold completeness, supported-format, hash, and obvious secret/PII checks.
- Registered all ten Quizlet benchmark sources and eight hidden evaluation artifacts without copying content into Git.
- Converted immutable run `2989a802173cfc05e313a135` into a 50-case unlabeled fixture with complete provider/model/prompt provenance and prepared a blinded packet containing no gold labels or rationales.
- Added provider-free authorized-pack preflight that verifies source/extracted-text hashes, reuses current PDF extraction, adapts Markdown/TXT/paste into the same segment contract, and never reads hidden evaluation data.
- Ran real pack preflight: 10/10 sources generation-ready, zero blockers, zero provider calls; PDF table and multi-column warnings remain visible for attribution.

## Current hypothesis if debugging

No generation P0/P1 failure reproduced. Current local live sample is healthy. Raw semantic verification fixed the known paraphrase false rejection but missed deterministic repeated-evidence ambiguity, proving it cannot replace existing gates. Experimental progressive hybrid scored perfectly on 10 project-authored cases, but this sample lacks authorized independent medical labels and cannot justify production publication changes. Reliability beyond small local sample, deployed authentication/configuration, native builds, and account billing/quota remain unverified.

## Known failing tests

- None in Jest, TypeScript, or Python suites.
- Repository Playwright runner lifecycle can hang in managed Windows shell. Direct installed Playwright browser diagnostic completed successfully.
- Default workspace pytest basetemp fails setup with Windows access denied; unique system-temp basetemp passes all tests.

## Known passing tests

- TypeScript: pass.
- Focused publication/concurrency Jest: 2 suites / 12 tests pass after target-scoped merge change.
- Full Jest: 46 suites / 267 tests pass.
- Full Python service suite: 279 tests pass with unique system-temp basetemp.
- Full card benchmark suite: 156 tests pass.
- ESLint: pass, 0 errors / 73 warnings.
- Evaluator calibration: 10 cases; label accuracy 0.9; disposition accuracy 0.9; zero false acceptances; one false rejection.
- Expo web production export: pass, 1,670 modules.
- Python compile: 1,568 discovered service Python files compile in bounded Windows-safe batches; broad `compileall` traversal still reports inaccessible pytest-cache directory only.
- Last completed focused Playwright proof: 3/3 assertions, including local readiness, HTTP 429 degradation, and 60-candidate persistence.

## Open P0 issues

- None identified.

## Open P1 issues

- None reproduced after transaction serialization and publication retry.

## Next recommended action

Execute a bounded native-default Gemini baseline over the ten preflighted sources, preserving first-pass outputs before hidden-gold scoring. In parallel, have one medical student and one clinician/medical educator/subject-matter expert independently complete copies of `tmp/evaluator-model-output-review-packet.json`, adjudicate disagreements, lock a reviewed fixture, then rerun the frozen hybrid comparison. Do not disable local studyable output or launch paid SFT yet.

## External blockers

- Sustained deployed Gemini reliability, billing/quota, latency, and cost proof; local paid canary now passes.
- Production EAS/Supabase/gateway verification.
- Native Android/iOS release proof.
- Human-reviewed, record-level training-eligible gold dataset. Source authorization is complete; quality labels are not.
- Owner-approved absolute model-promotion thresholds for quality, human review, latency, cost, and reliability.
- Managed-shell Playwright lifecycle instability.
- Authorized human adjudication for semantic verifier calibration.

## Important commands/results

- `node node_modules/typescript/bin/tsc --noEmit` — pass.
- `node node_modules/jest/bin/jest.js --runInBand` — 46 suites / 267 tests pass.
- Focused task-routing benchmark tests — 23 pass.
- Full Python service suite with unique `%TEMP%` `--basetemp` — 276 tests pass; default `.tmp_pytest` is inaccessible.
- `python -m services.card_benchmark.evaluator_calibration --output tmp/evaluator-calibration-current.json` — 0.9 label/disposition accuracy, zero false acceptances, one false rejection.
- `python -m services.card_benchmark.semantic_verifier_experiment --output tmp/semantic-verifier-experiment-current.json --model gemini-3.8-flash` — `DIAGNOSTIC_ONLY`; raw semantic 0.9 accuracy / one false acceptance / zero false rejections; offline hybrid reuse 1.0 / zero / zero.
- `python -m services.card_benchmark.evaluator_label_review prepare ...` — created ignored blinded packet `tmp/evaluator-label-review-20260930-023516.json`; no gold labels/rationales/dispositions included.
- `python -m services.card_benchmark.authorized_source_registry ...` — registered 10 sources and 8 hidden evaluation artifacts; zero obvious secret/PII matches; no raw content in registry.
- `python -m services.card_benchmark.evaluator_artifact_fixture ...` — created 50-case `tmp/evaluator-model-output-unlabeled.json` with run/provider/model/prompt provenance and exact evidence resolution.
- `python -m services.card_benchmark.evaluator_label_review prepare ...` — created 50-case `tmp/evaluator-model-output-review-packet.json`; no gold labels or rationales included.
- Focused authorization/reviewer tests — 37 pass; full card benchmark suite — 153 pass; combined Python service suite — 276 pass.
- `python -m services.card_benchmark.authorized_pack_preflight ...` — 10/10 sources generation-ready, zero blockers, zero provider calls, content-free report.
- Focused registry/preflight tests — 6 pass; full card benchmark suite — 156 pass; combined Python service suite — 279 pass.
- Paid card canary — 13/13 HTTP 200, 0 returned 503, 0 fallback; five-fixture P50 3.533 seconds, observed max 8.398 seconds.
- Paid Bari Chat canary — 3/3 HTTP 200; P50 2.549 seconds; unsupported question declined.
- Live Expo web flow — local cards 2.337 seconds, terminal ready 6.766 seconds, one provider request, no duplicate after reload, no runtime errors.
- Task-specific gateway routing/configuration/telemetry tests — pass.
- Promotion-gate unit/integration tests — 24 pass; full card-benchmark suite — 116 pass.
- Expo ESLint — pass with 0 errors / 73 warnings.
- Expo web production export — pass, 1,670 modules.
- Production dependency audit — 0 high/critical; 15 moderate transitive advisories.
- `git diff --check` — pass after implementation; staged unrelated content still fails `git diff --cached --check` and requires owner curation.
