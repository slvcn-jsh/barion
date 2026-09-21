# Card benchmark

Versioned source-fidelity, concept-coverage, source-constrained semantic matching, and structured expert comparative evaluation pipeline for Barion cards. Quizlet remains an input baseline, never ground truth.

## Safety and invariants

- Default paths live under git-ignored `tmp/card-benchmark/`.
- Gemini access is denied unless `--allow-remote` is explicit and production cache is absent.
- Provider settings load from `services/ai_gateway/.env`; existing shell environment variables take precedence.
- Direct benchmark generation needs `GEMINI_API_KEY`, `PRIMARY_GENERATION_PROVIDER`, `PRIMARY_GENERATION_MODEL`, and optional timeout/retry settings (`BARION_AI_PROVIDER_TIMEOUT_SECONDS`, `BARION_AI_PROVIDER_MAX_ATTEMPTS`, `BARION_AI_PROVIDER_RETRY_BASE_DELAY_SECONDS`, `BARION_AI_PROVIDER_RETRY_MAX_DELAY_SECONDS`). Gateway HTTP authentication variables are not required.
- Per-batch cache prevents accidental repeat billing and supports resume after partial failure. One benchmark request may make bounded transport attempts for transient 429/5xx failures; manifest `attemptCount` remains logical generation-request count. Recoverable provider failures are recorded with sanitized diagnostics while later eligible batches continue within the logical-request and token ceilings. A resume may explicitly raise request/token ceilings and append deterministic supplemental requests, but may not shrink budgets or change the cached request-plan prefix.
- Generation contract targets 56 merged cards and requires at least 45. Source segments are deterministically partitioned into coverage-balanced batches; optional supplemental requests revisit batches within hard ceilings. Reaching a request/token ceiling ends generation successfully only when at least 45 unique validated cards are cached. Each schema-valid grounded response is cached even when below its per-batch target, then exact normalized question/answer duplicates are removed before aggregate count enforcement.
- Gemini card generation uses low thinking and a 32,768-token per-request combined thinking/output limit. CLI additionally enforces request-count and reported input/output-token ceilings before continuing.
- Runs below 45 validated production cards remain reportable for diagnosis but receive a severe-underproduction warning and `quantityContractMet: false`.
- Every completed run lives in `--output/<runId>/`; an existing run directory is never overwritten.
- Manifest hash-links source bytes, extracted text, segments, normalized decks, evaluator config, dependency locks, git state, and all Phase-1 component versions.
- Source-only concept inventory is frozen before either card set is analyzed. Stable concept IDs derive from source identity, normalized proposition, source span, and inventory version—not list position.
- Structural extraction records prose, list items, headings, table rows/matrices, numeric criteria, unknown units, source spans, confidence, and layout warnings. Pages without selectable text remain diagnostic records.
- Importance and medical risk remain separate. Deterministic importance is heuristic, versioned, and confidence-marked—not objective medical truth.
- Canonical Phase-2 coverage is importance-weighted with versioned configurable weights. It reports sections, pages, thirds, deciles, zero regions, duplicate rate, concept diversity, coverage balance, and question-type diversity.
- Phase-2 coverage matching remains deterministic lexical recall with numeric agreement and optional segment alignment. Ambiguous layout remains uncertain.
- Phase-3 semantic matching adds explicit medical-term equivalences, proposition recall, contradiction vetoes, numeric agreement, versioned calibration fixtures, and source-constrained cross-system pairing. It is pair selection, not medical verification.
- Expert comparison uses seeded A/B orientation with origin removed. GPT-5.6 Sol High scores cards independently, compares qualified source-concept matches, and performs selective same-model verification. Self-check is never represented as independent reviewer evidence.
- Structural compliance applies only to production-contract fields. Expert pedagogy uses visible 0-4 dimension scores; source and safety gates remain authoritative.
- Deterministic claim evaluation separates citation quality from citation, segment, and document support. Ambiguous evidence remains `uncertain`; lexical overlap is diagnostic metadata only.
- Normal CLI execution runs versioned known-regression and semantic-calibration fixtures, then writes canonical claim-level JSONL and blind-review inputs.

## Inputs

Place these local files in `tmp/card-benchmark/`:

- `PDF_INPUT.pdf`
- `QUIZLET_OUTPUT.pdf`

Quizlet parser enforces cards 1-183, non-empty sides, two-column order, and cross-page continuations (including cards 10 and 159).

## Commands

```powershell
# Validate extraction, parsing, segmentation, planned generation, and cache compatibility. No network.
python -m services.card_benchmark --dry-run

# Run from existing cached production response. No network.
python -m services.card_benchmark

# Explicitly permit deterministic, resumable Gemini batches if cache is absent.
# Defaults: 4 batches, at most 6 calls, 100k reported input tokens, 20k reported output tokens.
# Failed batches are retried only by another explicit invocation; successful batches are reused.
python -m services.card_benchmark --allow-remote

# Override hard ceilings. Raising these values on resume preserves compatible cached batches
# and appends deterministic supplemental requests up to the new request ceiling.
python -m services.card_benchmark --allow-remote --generation-batches 4 `
  --max-generation-requests 6 --max-input-tokens 100000 --max-output-tokens 20000

# Tests
python -m pytest services/card_benchmark/tests -q

# Create immutable Phase 3 expert-evaluation child run from existing generation run
python -m services.card_benchmark.phase3_run --parent C:\\absolute\\path\\generation-run --output C:\\absolute\\path\\evaluation-runs
```

# Re-evaluate immutable Phase 3 cards with deterministic UTF-16 source spans; no generation call.
python -m services.card_benchmark.phase4_run `
  --parent C:\\absolute\\path\\runs\\2989a802173cfc05e313a135 `
  --output C:\\absolute\\path\\phase4-evaluation-runs


Custom paths:

```powershell
python -m services.card_benchmark `
  --source C:\absolute\path\source.pdf `
  --quizlet C:\absolute\path\quizlet.pdf `
  --production-cache C:\absolute\path\production.json `
  --output C:\absolute\path\runs
```

## Artifacts

- `<production-cache>.batches/manifest.json`: resumable batch plan, request/source hashes, model, hard budgets, attempts, token usage, provider request IDs, and per-batch status
- `manifest.json`: immutable run identity, hashes, versions, git/dependency state, timestamps, and merged-generation provenance
- `claims.jsonl`: canonical claim, grounding, citation, risk, validation-impact, and publication artifact
- `claims.csv`: human-readable claim export
- `regression_results.json`: fixture-by-fixture normal-pipeline results
- `production_cards.json`, `quizlet_cards.json`: normalized benchmark cards preserving raw input
- `metrics.json`: aggregate statuses, per-system coverage, semantic calibration, and blind-review readiness
- `report.md`: source-fidelity, concept-coverage, matching, and review workflow summary
- `structural_source.json`: structural units, exact offsets, confidence, and extraction warnings
- `concept_inventory.json`: frozen versioned concepts with source spans, importance, risk, type, and lineage
- `coverage_map.json`: Barion/Quizlet coverage maps, distributions, duplicates, and concept-to-card links
- `matches.json`: source-constrained semantic card pairs with component scores and matcher version
- `semantic_calibration.json`: versioned fixture outcomes, including false-positive/false-negative cases
- `blind_review.csv`: system-neutral paired review input
- `blind_review_protocol.json`: rubric, reviewer instructions, and predeclared acceptance gates
- `private/blind_review_key.json`: concealed A/B system identities; reveal only after reviews lock

Canonical comparative conclusions use all legitimate shared critical/high concepts plus representative medium concepts. Thirty pairs apply only when at least 30 qualified shared concepts exist. Source, numeric, contradiction, and safety gates override expert pedagogy. Selective SOL verification reports self-consistency, revision, and uncertainty—not independent-rater agreement.
