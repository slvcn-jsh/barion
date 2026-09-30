# Barion Production Readiness Report

Date: 2026-09-30

## Current verdict

Barion core learning pipeline is locally healthy, but public release remains blocked by production deployment proof.

Initial live Gemini proof failed because gateway inherited a stale parent-shell API key instead of current service-owned key. Local launcher now prioritizes `services/ai_gateway/.env`, and gateway has `gemini-3.5-flash-lite` model failover after `gemini-3.8-flash` retries.

Fresh paid proof passes: 13 card requests and three Bari Chat requests returned HTTP 200 with no returned 503 and no model fallback. Five representative medical card calls produced 30 exact-grounded candidates in 3.221–8.398 seconds; quality gates marked 23 publish, two review, and five reject. Final telemetry-confirmed browser call used primary Gemini on attempt 1 with zero retries. Deterministic browser proof also persists a 60-candidate remote result through Expo SDK 57 SQLite without nested transactions. Long-term and deployed reliability remain unproven.

Completed behavior now includes local-first source decks, PDF layout reconstruction, queue/availability fixes, source-grounded generation, AI failover/retry handling, Bari chat, repository separation, 3D Bari integration, and broad automated coverage.

Latest production-readiness fix restores Expo SDK 57 environment inlining for AI gateway URL/model, prevents local static gateway token from entering production export, and gives Bari chat same Supabase session-token path as card generation.

Latest source-to-study fix serializes repository transactions per database connection without using connection-wide transaction state as caller ownership. Failed publication retains remote candidate and selection evidence instead of reporting `60` as `0`, and one transient publication retry reuses validated candidates without another provider request.

Latest live-flow fix preserves local coverage during partial Smart Enhancement. Remote publication now retires only untouched auto cards whose concept target has a selected AI replacement. Live web proof kept seven active cards while applying five AI replacements, reached ready in 6.766 seconds, survived reload without another request, and produced no runtime errors.

Successful gateway telemetry now retains sanitized retry/failover diagnostics and reliably reaches uvicorn logging. This makes a recovered provider retry distinguishable from clean first-attempt success without exposing prompts, source content, credentials, or response content.

Generation jobs now use stable source/hash/purpose/prompt identity, suppress equivalent completed work, resume queued attempts in place, and cap Smart retries. Local baseline automatically queues Smart Enhancement while keeping deck studyable.

Validated remote candidate batches now persist before publication. Restart recovery publishes from local checkpoint without another Gemini request, preserves original provider/model/prompt provenance, and clears checkpoint only after completion. Corrupt checkpoints fail terminally instead of entering an infinite retry loop. `REVIEW` candidates remain held and non-studyable with accurate terminal accounting.

Evaluator calibration exposes remaining trust gap: 10 frozen project-authored cases now score 0.9 label accuracy and 0.9 disposition accuracy. Explicit document-mechanics questions are rejected with zero known false acceptances, while one legitimate semantic paraphrase remains falsely rejected. AI-only ready-to-study migration remains blocked until semantic verification is calibrated against authorized human truth.

One isolated paid Gemini semantic-verifier diagnostic corrected the paraphrase but introduced a false acceptance by overlooking repeated-evidence source-span ambiguity. A progressive hybrid that preserves deterministic ambiguity/contradiction/educational-value vetoes and semantically escalates only `UNSUPPORTED` results scored 1.0 on the same 10 cases using the persisted response. This is promising architecture evidence, not production medical validation; labels remain project-authored and unreviewed.

Evaluation tooling now converts governed immutable model-output runs into unlabeled reviewer fixtures only after source/deck/segment hashes and exact evidence resolution pass. Source rights, evaluation authorization, non-sensitive classification, and inference-only fixture status are mandatory. Owner authorization is now recorded for the existing 50-card psychiatric-nursing source and the ten-source Quizlet comparison pack. The 50-card run has been converted into an unlabeled fixture and a blinded review packet; neither contains or implies human truth labels.

Content-free registries under `datasets/bari-cardgen/registries/` preserve exact source hashes, pack identity, hidden-gold separation, and evaluation/training-candidate authorization without committing raw source text, hidden gold, or model output. Automated scans found no obvious secret or PII patterns. Generated cards remain `inference-only` until record-level review; source authorization does not make model output training truth.

Multi-format benchmark preflight now verifies registered bytes and extracted-text hashes before applying the current source segmentation contract. All 10 authorized sources are generation-ready with zero blockers. PDF table/two-column warnings remain visible; no hidden evaluation file was read and no provider call was made.

Bari AI now has provider-neutral logical model/task policies, complete evaluation-run metadata, explicit training-data eligibility checks, and feedback-label separation. Official Google documentation does not list Gemini 3.8 Flash as fine-tunable; no paid tuning is authorized or warranted yet.

Card generation and Bari Chat now resolve independent effective model/fallback/retry policies and provider chains. Health and content-free telemetry expose logical plus physical model provenance, while Phase 6 evaluation artifacts persist both identities. Startup validates each task deadline independently.

Model promotion now has a separate executable fail-closed gate. It requires comparable frozen evaluation runs plus explicit owner-approved thresholds, returns `INCONCLUSIVE` when evidence is missing, and cannot confuse a Phase 6 intervention `ACCEPT` with production model promotion.

Latest alignment work rejects non-finite promotion thresholds and incompatible evaluation envelopes, replaces user-facing AI `quality` percentages with honest automated-check language, and upgrades medical blind review to require target-learner plus clinical/education authority evidence. Expo-compatible ESLint now runs in CI. Explicit EAS store-production profiles exist, while native builds remain intentionally unexecuted without signing/deployment authority. Bari 3D work is frozen.

## Current proof

- Typecheck: pass.
- Jest: 46 suites / 267 tests pass.
- Python service suite: 279 tests pass with an isolated Windows basetemp, including task routing, model promotion, medical blind review, dataset governance, authorized-source registration/preflight, evaluation, gateway, ingestion, card evaluation, and evaluator calibration.
- Card benchmark suite: 156 tests pass.
- ESLint: pass with 0 errors and 73 recorded warnings; warning cleanup remains debt.
- Focused Playwright: 3/3 flows pass, including 60-candidate persistence.
- Expo web production export: pass.
- Severe production dependency advisories: 0 high / 0 critical.
- Expo SDK dependency check: current in offline mode.

## Release blockers

- Paid billing/quota tier remains externally unverified because successful API requests do not identify account billing configuration.
- Sustained availability and configured-model fallback rate need deployed canary evidence; this small local sample cannot establish a production SLO.
- Production EAS environment, Supabase auth, deployed gateway, and HTTPS ingestion service remain unverified.
- Native Android/iOS release builds and device smoke tests remain unverified.
- Lint has 73 warnings that should be reduced before strict zero-warning enforcement.
- Crash reporting needs an approved provider, privacy policy, DSN, and production environment configuration.
- Staged workspace contains unrelated/generated artifacts requiring owner-approved release curation.
- Semantic evaluator is not yet calibrated to production medical trust: current frozen accuracy is 0.9 with one false rejection, despite zero known false acceptances.
- The 50-case reviewer packet still lacks independent human labels. One medical student and one clinician, medical educator, or subject-matter expert must review every case independently; disagreement requires adjudication.

## Next task

Run a bounded native-default Gemini baseline over the now-preflighted ten-source pack, preserving first-pass outputs and scoring only afterward against hidden gold. In parallel, complete two independent copies of `tmp/evaluator-model-output-review-packet.json`, adjudicate disagreements, and lock the reviewed fixture. Do not remove local studyable output or launch SFT until evaluator, dataset, privacy, and provider-support gates pass.

Detailed evidence and priorities: `docs/engineering/PRODUCTION_READINESS_AUDIT.md`.
