# Bari AI evaluation framework

## Existing harness

`services/card_benchmark` is permanent evaluation owner. It already provides immutable manifests, source hashes, deterministic extraction, concept inventory, claim grounding, frozen splits, blind comparisons, cost/token accounting, and single-intervention experiments. New work extends this harness rather than creating another evaluator.

`evaluation_run_record` writes one provider-neutral envelope containing model/model version, prompt version, dataset version, schema version, configuration, timestamp, commit SHA, and metrics. Missing measurements stay `null`; they are never inferred.

Phase 6 now emits `evaluation_run.json` beside immutable experiment artifacts. `identity.model` is logical registry identity, `identity.modelVersion` is physical provider model ID, and commit SHA must be lowercase hexadecimal. This keeps historical comparisons interpretable after provider routing changes.

## Card-generation rubric

Each candidate is evaluated across:

- source faithfulness and unsupported claims;
- atomicity;
- clear, unambiguous question wording without answer leakage;
- concise, sufficient answer using source terminology;
- educational value and active recall quality;
- important-concept coverage;
- redundancy and duplicate knowledge;
- evidence provenance accuracy;
- appropriate difficulty;
- structured-schema validity.

Machine-readable rejection reasons remain authoritative. Pedagogy cannot override grounding or safety.

## Required run metrics

- `groundingFaithfulness`, `unsupportedClaimRate`, `conceptCoverage`
- `atomicityScore`, `answerSpecificity`, `duplicateRate`, `provenanceAccuracy`
- `schemaValidity`, `qualityGateAcceptanceRate`
- `humanAcceptanceRate`, `humanEditRate` when reviewed data exists
- `latencyP50`, `latencyP95`
- `inputTokens`, `outputTokens`, `estimatedCost`, `providerFailureRate`

## Promotion gate

A candidate may advance only when:

- unsupported claims, grounding, safety, schema validity, and critical coverage do not regress;
- validation improves and frozen holdout does not regress;
- human preference or correction rate improves when adequate review exists;
- latency, cost, and provider reliability meet declared bounds;
- run is reproducible from immutable artifacts and commit SHA.

Then use bounded shadow traffic, followed by small canary traffic with immediate policy rollback. Duplicate inference must have a fixed sample/budget ceiling.

`services.card_benchmark.promotion_run` makes this gate executable. It compares baseline and candidate `evaluation_run.json` files produced from the same frozen dataset and schema, requires an explicit complete threshold file, and writes an immutable `PROMOTE`, `REJECT`, or `INCONCLUSIVE` decision. Missing metrics always produce `INCONCLUSIVE`; no default threshold silently authorizes promotion.

Promotion input validation rejects non-finite threshold values, unsupported evaluation-envelope versions, missing physical model identity, invalid commit SHA, and missing configuration metadata. Prompt and runtime configuration remain recorded but may differ because a promotion candidate represents a complete task policy; dataset and schema versions must match.

Phase 6 experiment `ACCEPT` means one isolated intervention survived its declared comparison. It does not mean a model is production-approved. Only promotion-run `PROMOTE` has that meaning.

Required promotion evidence includes grounding, unsupported claims, coverage, atomicity, answer specificity, duplication, provenance, schema validity, quality-gate acceptance, human acceptance/edit rates, latency P95, estimated cost, and provider failure rate. Candidate must satisfy every declared bound and avoid baseline quality/reliability regression; cost and latency may vary only within explicitly declared ratios.

Blind medical review version 2 scores accuracy, source faithfulness, atomicity, clarity, answer specificity, and learning value. Comparative claims require at least one medical-student reviewer and one clinician, medical educator, or subject-matter expert. Reviewer IDs are pseudonymous; system identity remains concealed until review files lock.

## Source-bounded semantic-verifier experiment

`services.card_benchmark.semantic_verifier_experiment` compares current deterministic labels with a structured Gemini challenger without changing production publication. Source passages are marked untrusted data, outside knowledge is prohibited, one bounded batch is used without automatic retry, and reports omit source/question/answer text by default.

Initial project-authored diagnostic produced equal raw accuracy (`0.9`) but different errors: semantic verification corrected the legitimate paraphrase false rejection and incorrectly overrode repeated-evidence ambiguity, producing one false acceptance. This disproves replacing deterministic verification with an LLM judge.

Progressive hybrid policy therefore retains deterministic `CONTRADICTED`, `AMBIGUOUS`, `BAD_LEARNING_ITEM`, and `ENTAILED` results and allows semantic escalation only for deterministic `UNSUPPORTED` results. Offline reuse of the same paid response scored `1.0` on the 10 diagnostic cases with zero false acceptances and zero false rejections. This tiny project-authored set is not medical promotion evidence. Promotion remains blocked until labels are independently reviewed, locked, and include both medical-student and clinical/education authority review.

`services.card_benchmark.evaluator_label_review` creates blinded review packets without gold labels, rationales, or expected dispositions. Locking requires two or more unique pseudonymous reviewers, complete labels for every frozen case, one medical-student role, one clinical/education authority role, and unanimous case-level consensus. Disagreements stop for adjudication. The locker writes a new hash-linked fixture and never overwrites original evidence.

`services.card_benchmark.evaluator_artifact_fixture` closes the gap between immutable Gemini runs and human truth. It accepts no inferred rights: a separate declaration must identify the exact source SHA-256, authorize evaluation use, approve usage rights, classify content as non-sensitive, and keep generated fixtures `inference-only`. Source, deck, and reconstructed-segment hashes must match the run, and every evidence quote must resolve uniquely before an unlabeled fixture is written. Reviewers then label blinded copies; only cross-role consensus creates a locked gold label. Source authorization alone never makes generated labels or cards training truth.

## Authorized benchmark evidence

`services.card_benchmark.authorized_source_registry` registers a multi-format benchmark pack without placing raw content in the registry. It validates exact manifest columns, path containment, supported formats, unique source IDs, complete gold-source coverage, content hashes, and obvious secret/PII patterns. Hidden evaluation artifacts are hash-inventoried separately and never supplied as generation inputs.

The owner-authorized Quizlet comparison pack currently contains ten sources across PDF, Markdown, and pasted/text input plus eight hidden evaluation artifacts. The psychiatric-nursing benchmark produced a 50-case unlabeled fixture with complete immutable run/provider/model/prompt provenance and a separate blinded packet containing no gold labels or rationales. These artifacts are permanent evaluation inputs, not human truth. Production semantic-verifier promotion remains blocked until independent medical-student and clinical/education reviewers label every case and resolve disagreements.

`services.card_benchmark.authorized_pack_preflight` verifies local source bytes and extracted-text hashes against the tracked registry, then runs the current PDF/text segmentation contract without reading hidden evaluation files or calling a provider. Current frozen preflight reports all 10 sources generation-ready. It retains table and multi-column warnings so later quality results can be attributed to ingestion versus authorship or verification.
