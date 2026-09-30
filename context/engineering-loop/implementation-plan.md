# Implementation Blueprint: Reviewer PDF Reliability

## Execution order

1. Repair queue parameter binding and add availability diagnostics/tests.
2. Make source CTA show actual session availability and provide Browse all fallback.
3. Add coordinate-aware PDF layout reconstruction and table-row normalization.
4. Harden segment and target validation against fragments and source-navigation questions.
5. Replace fixed local quality with deterministic quality checks.
6. Enforce selection budget during target-anchor selection.
7. Persist target identity and detailed fallback diagnostics compatibly.
8. Align readiness and trust wording with actual pipeline state.
9. Add raw-layout, reviewer, queue, fallback, and end-to-end regression coverage.
10. Run TypeScript, Jest, Python gateway/evaluator, diff, and browser verification.

## Stop condition

Implementation is complete when acceptance gates pass or a concrete external blocker is proven and reported.

## Autonomous reliability iteration: durable generation identity

1. Add explicit generation purpose and stable logical key derived from source identity, content hash, purpose, and prompt version.
2. Resume queued logical jobs in place instead of creating replacement jobs.
3. Reuse completed equivalent Smart Enhancement results so repeated triggers cannot repeat paid requests.
4. Recover interrupted local work as local baseline work, not Smart Enhancement.
5. Bound automatic recoverable Smart Enhancement attempts and preserve local usability at terminal failure.
6. Add deterministic repository and recovery regressions, then run typecheck and related suites.

Stop when equivalent concurrent/completed triggers cannot duplicate provider work, queued retries preserve job identity, interrupted local work resumes locally, and retry exhaustion reaches explicit terminal state.

## Medical-reviewer production alignment iteration

Objective: convert current reliable source-to-study architecture into release evidence for medical learners without expanding Bari 3D or claiming unreviewed AI output is expert quality.

Terms:

- **Automated check score:** deterministic formatting, grounding, and evidence-coverage signal. It is not a calibrated medical-quality percentage.
- **Gold review:** licensed or project-authored source/card evidence completed by independent authorized human reviewers through the existing blind-review workflow.
- **Release gate:** deterministic repository, test, build, authentication, or deployment proof required before public distribution.
- **Frozen 3D scope:** existing Bari 3D code and assets remain untouched unless they block a release-critical workflow.

Execution order:

1. Harden model-promotion inputs against non-finite thresholds and incompatible/incomplete evaluation envelopes.
2. Replace misleading human-facing `quality` percentages with explicit automated-check language while preserving internal score contracts.
3. Reuse and document the existing independent blind-review pipeline for medical gold evidence; never fabricate reviewer outcomes.
4. Add an Expo-compatible lint gate and wire it into CI only when the repository passes it.
5. Add explicit store-production EAS profiles and validate local Expo/native configuration without deploying or invoking paid services.
6. Run targeted tests, full TypeScript/Jest/Python regressions, configuration checks, and diff validation.
7. Update production-readiness, overnight log, and autonomous handoff with external blockers and next authorized actions.

Stop when repository-owned gates pass and remaining work requires human medical review, production credentials, store signing, external deployment, or paid provider evidence.

## Owner-authorized evaluation-source iteration

Objective: admit explicitly owner-authorized benchmark sources into Barion's permanent evaluation pipeline without treating raw or model-generated material as automatic training truth.

Execution order:

1. Harden model-output calibration so full cross-role consensus metadata is required wherever reviewed labels are consumed.
2. Require immutable run, provider, model, and prompt provenance before converting generated artifacts.
3. Record separate evaluation-use and training-use authorization while keeping newly created evaluator fixtures inference-only until quality review completes.
4. Create content-free hash inventories and local governance declarations for `tmp/card-benchmark/PDF_INPUT.pdf` and `tmp/barion_quizlet_benchmark_v1`.
5. Validate benchmark manifest paths, source hashes, hidden-gold separation, and obvious secret/PII absence without copying raw content into Git.
6. Build the existing 50-card run into an unlabeled reviewer fixture and prepare blinded review packets where source lineage verifies.
7. Run focused evaluator tests, full benchmark/Python regressions, TypeScript/Jest gates, diff inspection, and update durable handoff documentation.

Stop when all repository-owned provenance and fixture gates pass. Independent medical-student and clinical/education labels remain a human gate; SFT and production semantic-verifier promotion remain deferred until reviewed data exists.

## Authorized benchmark-pack preflight iteration

Objective: prove the current source pipeline can prepare every authorized benchmark input for generation without exposing hidden evaluation artifacts or paying for model calls.

Execution order:

1. Verify the tracked content-free registry against local source bytes and extracted-text hashes.
2. Reuse existing PDF extraction and segmentation; adapt Markdown and pasted/plain text into the same `Page`/`Segment` contract.
3. Emit a content-free preflight report with per-source segment counts, extraction warnings, blockers, and generation readiness.
4. Never read `evaluation/` during preflight and never include source text in reports.
5. Add synthetic PDF/text tests for success, drift rejection, path containment, and report redaction.
6. Run preflight against all ten real sources, then rerun focused and full regression gates.

Stop when every registered source either reports generation-ready or has an explicit source-pipeline blocker. Remote generation and gold scoring remain separate later phases.
