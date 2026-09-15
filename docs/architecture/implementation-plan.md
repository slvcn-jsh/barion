# Barion Implementation Plan

## Product Target

Barion is an offline-first medical learning platform. The local study loop works without an account or server. Each unique source automatically owns a study set. Exact extractive cards can publish automatically; uncertain, edited, or future model-generated content requires review.

## Build Order

1. Local study kernel: decks, cards, FSRS scheduling, review events, search, progress.
2. Source engine: source files, source versions, segments, evidence links.
3. Generation pipeline: parse, segment, retrieve, generate, verify, approve.
4. Medical layer: drug, disease, anatomy, lab, vignette, and confusion-pair templates.
5. Sync: optional account, devices, operation log, backend reconciliation.
6. Advanced AI: practice tests, short-answer grading, audio notes, local model adapters.

## Non-Negotiable Rules

- SQLite is authoritative while studying.
- Review events are append-only.
- Memory states are recalculated cache.
- AI output is never auto-trusted; deterministic source extraction is labeled separately from medical verification.
- Every source-derived card must keep provenance.
- Unsupported output is rejected or sent to review.
- Manual studying works even when AI and sync are unavailable.

## Current Vertical Slice

- Expo Router mobile shell.
- Expo SQLite schema.
- Seeded source-grounded pharmacology deck.
- FSRS review loop via `ts-fsrs`.
- Local search with FTS5 fallback.
- Manual deck and card creation.
- Source library import with durable local file persistence where supported.
- Browser PDF extraction through PDF.js, with page locators and size/page guardrails.
- Native text/Markdown extraction and an optional stateless PyMuPDF service for mobile PDFs.
- Concept-aware extraction that can create zero, one, or several cards per storage segment.
- Automatic source-owned deck creation and source-scoped study sessions.
- SHA-256 duplicate import detection and idempotent refresh publishing.
- Exact duplicate cleanup that preserves the copy with the most review history.
- Exception-only review with evidence preview, editing, approval, and rejection.
- Source detail workspace with visible pipeline, progress, actionable errors, and retry.
- Transaction-safe review recording and undo-last-rating support.
- Barion brand palette, logo treatment, splash screen, and Plus Jakarta Sans typography.
- Soft-delete manifests for sources, decks, and card batches, with complete local restoration.
- Archive controls and visibility-safe dashboard, search, source, deck, and review queries.
- Cross-origin-isolated local web launcher for Expo SQLite WASM plus a friendly database-lock recovery screen.
- A saved Study Profile for approach, challenge, evidence detail, feedback timing, session size, and daily workload guardrails.
- Profile-aware review sessions with configurable length, new-card limits, review caps, compact/expanded evidence, and concise-answer mode.
- Source/deck/library Test Mode with deterministic best-answer items and safe self-marked written recall.
- Confidence-aware test results that write practice-test review events, update FSRS, and prioritize missed concepts in a repair queue.
- Persisted test sessions/responses and per-card weak, flagged, and paused learning state.
- A stricter card-quality gate using medical importance, active-recall structure, duplication checks, and answer-to-evidence token coverage.
- Diagnostic-reasoning and ordered-algorithm extractive templates alongside definitions, mechanisms, findings, risks, comparisons, safety, treatment, and cloze recall.
- Batched card-evidence hydration to avoid one database query per visible card.

## Current Learning Milestone

The first learner-control and adaptive-testing slice is implemented:

```text
study profile
-> workload-limited FSRS review
-> evidence-aware card quality gate
-> configurable test mode
-> confidence-based scheduling
-> weak-concept repair queue
```

The next slice should deepen, not duplicate, that foundation:

1. Semantic medical verification and model-generated cards behind an explicit review boundary.
2. Richer test item families: select-all, matching, sequencing, and source-supported clinical vignettes.
3. A card browser with tags, move-to-deck, duplicate review, scheduling history, and saved filters.
4. Mastery analytics, workload forecast, and weak-concept grouping across sources.
5. Regeneration batches with an inspectable revision history for reviewed cards.

Barion must never invent a clinical vignette or semantic explanation and label it exact-source. Until a verifier exists, deterministic extraction may auto-publish only when it clears the local quality threshold; all borderline drafts stay in Source Review.

## Recently Hardened

- Database migrations now use `PRAGMA user_version`.
- Review writes update `review_events` and `memory_states` inside a transaction.
- Search has indexed local cards and updates for manually added cards.
- Imported sources are copied into app document storage when the platform allows it.
- Draft edits deliberately lower automatic support confidence and remain visibly review-marked.
- Automatically published cards are labeled source-extracted rather than medically verified.
- PDF limits are enforced before processing: 30 MB and 160 pages per focused source.
- Browser extraction does not upload a PDF; native service use is explicit and configurable.
- Manual content and approved source drafts use the same local-first study path.
- Removal never physically cascades through reviewed content; Trash records exact restoration manifests.
- Regenerating recently removed source cards reactivates the originals instead of duplicating them.
