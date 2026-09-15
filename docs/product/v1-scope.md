# V1 Scope

## In Scope

- Offline home dashboard.
- Local deck list and deck detail.
- Source-grounded seeded medical cards.
- Review screen with reveal and Again, Hard, Good, Easy grading.
- Skip that does not contaminate FSRS history.
- Append-only review events.
- Local source library import record.
- Source evidence display on cards.
- Manual deck creation.
- Manual card creation.
- Undo last rating.
- Source detail screen.
- Selectable-text PDF extraction in Barion Web.
- Plain-text and Markdown extraction on web, iOS, and Android.
- Optional stateless PDF extraction service for iOS and Android builds.
- Page/section-aware source segmentation.
- Concept-aware extractive cards with source evidence; a section can yield zero, one, or several cards.
- One automatically created study set per unique source.
- Duplicate-import and regeneration protection.
- Automatic publishing for exact-source cards, with uncertain or edited candidates held for attention.
- Clear import states, errors, and retry actions.
- Barion visual identity and Plus Jakarta Sans typography.
- Source and deck archive/restore.
- Recoverable source, deck, individual-card, and bulk-card removal.
- Reviewed-card warnings that preserve FSRS history in Trash.
- Automatic-card cleanup that preserves manual and edited cards.
- A dedicated Manage Library screen for archived and recently removed material.
- A local Study Profile with medical-study presets rather than unsupported learning-style labels.
- Configurable session length, daily new-card limit, daily review guardrail, feedback timing, and evidence detail.
- Source-, deck-, due-, all-, and weak-card test entry points.
- Best-answer and self-marked written-recall test items with evidence feedback.
- Practice-test answers that update FSRS and automatically form a weak-concept repair queue.
- Per-card pause and flag controls that preserve scheduling history.
- A higher automatic publishing threshold with visible card-quality and answer-to-evidence coverage metadata.

## Not Yet In Scope

- OCR for scanned/image-only PDFs.
- Generative AI card writing or semantic AI verification.
- Revision history for approved cards.
- Account sign-in.
- Cross-device sync.
- Faculty/shared decks.
- Audio transcription.
- Local LLM execution.
- Semantic short-answer grading.
- Generated clinical vignettes, matching, sequencing, and select-all test items.
- Full tag browser, move-to-deck, duplicate inspector, and review-history UI.
- Cross-source concept mastery analytics and workload forecasting.

## Definition Of Done For The Kernel

- App launches on web and mobile targets.
- Local database initializes safely.
- Seed cards appear without network access.
- Review grading updates due dates.
- Review undo restores local scheduling state.
- Manual decks/cards can be created and reviewed.
- Deck detail shows evidence links.
- Source import stores file metadata and a SHA-256 fingerprint locally.
- Source import keeps a durable local file URI where supported.
- Selectable-text PDFs imported on web become page-linked cards in an independent study set.
- Mobile PDFs can use the separately deployed Barion ingestion service.
- Exact extractive cards can publish automatically but remain labeled source-extracted, not medically verified.
- Re-importing or refreshing the same source does not add duplicate cards.
- Archived and trashed material is excluded from dashboard totals, search, and study queues.
- Restoring an item restores its cards, evidence links, and scheduling history.
- Expo SQLite web runs behind the required cross-origin-isolated development and hosted responses.
- Test mistakes become due immediately and are prioritized as weak concepts without bypassing append-only review history.
- Study Profile workload limits replace the old hard-coded 20-card queue.
- Borderline extractive drafts are held for attention instead of silently auto-publishing.
- TypeScript passes.
