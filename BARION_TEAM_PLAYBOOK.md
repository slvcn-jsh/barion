# Barion — Team Onboarding, Architecture, Decision Log, and Maintenance Playbook

Version: 0.1 (draft)
Last updated: 2026-09-25
Owner: Your team

Status: System-first docs (no code changes)

## 0) Purpose (why this doc exists)
This doc gets a new teammate from zero to productive fast. It also becomes the living place we update as we ship progress (R milestones) and when we prepare the hackathon story.

It is structured around invariants and “why” decisions. That keeps future changes coherent instead of turning into ad-hoc tweaks.

## 1) Barion in one paragraph (shared mental model)
Barion is an offline-first medical learning platform that combines:
- FSRS-based spaced repetition for correct, predictable scheduling
- Source-grounded study generation plus a “Bari Chat” assistant
- Hybrid retrieval (BM25 + embeddings, fused with RRF) and an offline deterministic fallback
- Learner-safe evidence UX (progressive disclosure of source excerpts; no internal trust/verification metadata shown to the student)

## 2) What we build (scope for this doc)
### In scope
- Deck lifecycle: create/persist/retrieve/update/archive (as supported)
- Card lifecycle: generated + edited cards, revision/history, review scheduling, undo semantics
- Source importing: upload PDF, upload notes, paste text; chunk/segment parsing and persistence
- Study loop: due-card selection, recall input, rating Again/Hard/Good/Easy, review persistence and state transitions
- Bari Chat: grounded answers with citations/excerpts and a themed Bari mascot UI
- AI gateway + RAG pipeline: hybrid retrieval, evidence selection, structured outputs, deterministic offline fallback

### Out of scope (explicitly for now)
- New product features during audits unless needed to fix correctness, integrity, security, performance, or offline reliability
- Major architecture rewrites without evidence

## 3) Barion vs Quizlet/Anki (the hackathon-ready “why Barion” story)
This section is for teammates and for Devpost. Keep it honest, testable, and evidence-based.

### Barion vs Anki (why we’re not just “another flashcard app”)
Anki is strong at scheduling offline. Barion keeps scheduling correctness but adds:
- source-grounded study generation and retrieval
- a hybrid retrieval pipeline that selects evidence from user/imported content
- learner-safe evidence UX that reduces hallucination risk by design

### Barion vs Quizlet (why our approach is different)
Quizlet is useful for flashcards. Barion emphasizes:
- offline-first behavior and deterministic fallback paths
- tighter correctness and integrity controls for medical learning contexts
- evidence provenance UX designed to keep students focused and reduce confident unsupported claims

### What’s actually unique (the claims we can defend)
- Grounding controls: the assistant is engineered to retrieve and cite imported excerpts; it is not allowed to silently present unsupported medical claims as if they came from sources.
- Offline reliability: system is designed to degrade gracefully when the AI gateway is unavailable.
- Scheduling correctness: FSRS rating transitions and scheduling are treated as correctness-critical subsystem.

## 4) Architecture overview (the real subsystem map)
Update this map once the team confirms exact entry points and routes.

### Frontend (Expo / React Native / TypeScript)
Responsibilities:
- UI rendering and user interaction
- local study state transitions
- calling backend AI gateway only for online AI-dependent operations
- reading/writing SQLite through repository/storage abstractions

Entry screens (fill exact paths once finalized):
- Home / Dashboard: minimalist deck overview + “Continue studying” due count
- Sources: 3 input methods (Upload PDF / Upload notes / Paste text)
- Study / Review: recall input + rating Again/Hard/Good/Easy
- Deck detail: deck + cards list + source provenance progressive disclosure
- Bari Chat modal/screen: chat UI + Bari mascot themed visuals

Key UI principles:
- minimal cognitive load in study flow
- evidence is progressive: student sees sources only when needed
- ratings are clear and mapped to FSRS semantics
- telemetry/internal panels removed for student safety and focus

### Backend (FastAPI AI gateway + services)
Responsibilities:
- hybrid RAG orchestration (BM25 + embeddings + RRF)
- prompt construction with evidence-only constraints
- Gemini provider gateway and structured output parsing
- deterministic behavior under partial failure (timeouts, bounded retries, structured error envelopes)

### Data layer (SQLite repository + storage)
Responsibilities:
- persist decks, cards, sources, segments, review events, revision history
- maintain invariants and referential integrity (foreign keys, constraints)
- provide query patterns optimized with indexes
- support undo and revision correctness

## 5) Core user flows (end-to-end trace + invariants)
Use this as a debugging checklist. Each section also names the invariants that must never break.

### 5.1 Deck lifecycle
Trace:
1) Create deck (UI)
2) Persist deck (repository, transaction)
3) Retrieve deck list (query + sort)
4) Display deck and allow selection
5) Update deck metadata
6) Delete/archive behavior (if supported)
7) Ensure cards and sources references remain valid

Invariants:
- No orphan cards: cards must reference a valid deck id (enforced by foreign keys).
- Update must not desync ordering/state in UI vs DB.
- Delete/archive must define dependent-record semantics (cascade vs restrict vs soft delete).

Common failure modes to watch:
- stale UI state after repository write
- missing indexes causing deck list lag at scale
- race conditions from double taps or screen re-mounts

### 5.2 Card lifecycle
Trace:
- manual card creation or AI-generated card creation
- persist card and associated segments/sources (if applicable)
- edit card fields
- persist revision/history record
- review flow changes scheduling state
- undo restores previous valid scheduling state
- deletion/archive semantics (if supported)

Invariants:
- Card belongs to a valid deck.
- Revision history is consistent: “current card state” reflects last applied revision.
- Undo returns exactly the previous valid state, not an approximate one.
- Generated cards must validate structure before persistence.

### 5.3 Study / review lifecycle (FSRS correctness)
Trace:
1) Determine due-card query
2) Present recall field and source provenance disclosure behavior
3) User rates Again/Hard/Good/Easy
4) Scheduling algorithm updates next due state
5) Review event persisted
6) UI transitions to next due card or empty state
7) Undo restores previous review state

FSRS correctness requirements (non-negotiable):
- rating mapping must match FSRS model semantics
- timestamps consistent (review time vs due time)
- concurrent taps must not apply multiple scheduling transitions for a single review

Performance expectations (measure when data scales):
- due selection time at 10/100/1000/10,000 cards
- transition time after rating
- stable behavior when reopening mid-session

### 5.4 Source importing lifecycle
Trace:
1) Choose import method (PDF / notes / paste text)
2) Store source blob or temporary file
3) Parse and chunk into segments
4) Persist segments and mapping to source identity
5) Build/refresh retrieval indexes as applicable (BM25/vector)
6) Associate segments with cards if card generation uses segments

Invariants:
- Segment identity stable: segments must map deterministically back to the original source.
- DB records and file storage must not silently diverge.
- Partial failures must rollback or leave a clearly consistent state.

### 5.5 Bari Chat lifecycle
Trace:
1) User asks a question
2) Query preprocessing (normalization/tokenization)
3) Candidate retrieval:
   - BM25 keyword matching
   - dense vector retrieval
   - hybrid ranking via Reciprocal Rank Fusion (RRF)
4) Evidence selection and prompt construction (grounding-first)
5) Online call to Gemini through AI gateway when required
6) Response validation (structured parsing; fail closed)
7) UI rendering:
   - learner-safe progressive disclosure of [Source] excerpts on demand
   - no leakage of internal claim IDs, verification metadata, or score/quality badges
8) Offline behavior:
   - deterministic offline extraction returning excerpt-only results

Invariants:
- UI must not present “supported vs unsupported” ambiguously.
- If evidence is insufficient, assistant must avoid confident unsupported answers.

## 6) Retrieval + grounding behavior (the “no hallucinated medical facts” contract)
### Hybrid retrieval
Inputs:
- user query
- indexed corpus derived from imported sources

Retrieval:
- BM25 sparse retrieval
- embeddings/vector similarity retrieval

Hybrid fusion:
- reciprocal rank fusion with explicit constants (document actual constants once locked in repo)

Evidence selection:
- select top evidence segments
- deduplicate overlapping segments
- allocate prompt budget deterministically

### Grounding & citations rules
- citations must correspond to actual retrieved segments
- UI shows only learner-safe excerpt info:
  - title
  - locator
  - excerpt (progressively revealed)
- no internal “claim id”, “quality score”, “verification metadata” shown to students

### Offline deterministic fallback
- offline fallback uses deterministic token/excerpt matching
- same input produces same extracted excerpts
- if nothing matches, degrade gracefully (no hallucinated citations)

## 7) AI gateway contract hardening (provider interactions)
Responsibilities:
- provider request construction with strict schema
- bounded timeouts and bounded retries (avoid duplicate submissions)
- structured response parsing with “fail closed” behavior
- error translation:
  - UI gets safe, learner-friendly messages
  - logs keep enough technical info for debugging (without secrets or raw medical content unless allowed)

Validation contract:
- gateway rejects malformed provider output
- gateway never outputs internal-only metadata to the student UI

Team checklist (when something breaks):
- confirm request/response schema parity between frontend expectations and backend responses
- confirm .env.example has documentation only, no secret values

## 8) Offline-first reliability (explicit behavior model)
Define per feature whether it is:
- fully offline
- partially offline (requires AI gateway)
- online-only

Typical offline-ready items:
- FSRS study loop
- local repository reads
- deterministic offline excerpt extraction (where wired)

Typical online-only items:
- Gemini Q&A beyond deterministic extraction

Offline scenarios to test and document:
- online → offline → online again
- launch while offline
- lose connection mid-request
- gateway failure while network exists
- AI quota exhausted
- source imported before going offline
- study session entirely offline
- app killed during DB write → app restarted

Graceful degradation rules:
- never crash the app
- never leave DB in partially mutated inconsistent state
- always show a safe error or an offline alternative

## 9) Database audit checklist (future you needs this)
This is a checklist, not a one-time report. Update when migrations land.

### Schema invariants
- foreign keys enabled
- correct cascade/restrict semantics
- review events durable and consistent with card scheduling
- revision/history never corrupts current card state
- conversation persistence matches chat UI expectations

### Index discipline
- every index supports a real access pattern
- composite indexes match filter columns + order-by columns
- avoid redundant indexes
- use query-plan checks when investigating performance

### Transactions
- define transaction boundaries for:
  - review application
  - undo restoration
  - card generation persistence
  - source segment persistence
- ensure rollback behavior on partial errors

### WAL/journaling
- document journaling mode usage and why it was chosen
- verify behavior under abrupt termination

## 10) Security and privacy review (medical + untrusted documents)
Treat imported documents as untrusted input.

Threats to defend against:
- prompt injection embedded in source text
- malicious or malformed PDF/notes content
- path traversal / unsafe file handling
- leakage of internal IDs, verification metadata, or debugging traces
- logging sensitive study content
- exposing API keys in mobile bundles

Hardening rules:
- never embed secrets in frontend artifacts
- use parameterized DB access
- keep prompt construction evidence-only with explicit system constraints
- validate structured outputs from AI gateway
- store imported content carefully; prevent divergence between DB and file storage

## 11) Development workflow (team rules for safe progress)
### Before you change code
- update this doc if the change affects architecture, invariants, or decision rationale
- add or adjust tests before relying on manual QA
- if the change is user-visible to students, update hackathon narrative notes too

### Required verification gates (minimum)
- TypeScript: node node_modules/typescript/bin/tsc --noEmit
- Frontend tests: npm test -- --runInBand
- Backend tests: run relevant pytest suites (gateway + evaluation + benchmarks)

### “Docs update” gate (mandatory for meaningful milestones)
After any meaningful milestone:
- add a Change log entry
- add new invariants discovered
- update scope if needed
- update hackathon narrative section if system got stronger

## 12) Change log (append only)
YYYY-MM-DD — Rxx — What changed — Verification evidence — Doc sections updated

## 13) Decision log (keep ‘why’ durable)
Use this template whenever the team debates architecture or a critical behavior rule.

Template:
- Decision: <what>
- Context: <constraints>
- Considered alternatives:
  - <alt A>
  - <alt B>
- Why we rejected:
  - <alt A reason>
  - <alt B reason>
- Why we chose:
  - <primary reasons>
- Risks:
  - <risk>
- How we validate:
  - <test/benchmark/invariant>

## 14) Hackathon readiness package (team-friendly deliverables)
### Devpost narrative structure (suggested)
- Project title + tagline
- Problem statement
- Solution overview
- Key features (5–8 bullets, each mapped to proof)
- Tech stack
- Target users
- Social impact

### Demo plan (2–3 minutes script outline)
1) Show “Continue studying” due count
2) Show study screen: recall input + Again/Hard/Good/Easy rating
3) Show source provenance progressive disclosure
4) Show Bari Chat answering with citations/excerpts
5) Show offline behavior fallback (as available on demo day)

### Why judges will care (map to scoring criteria)
- Technical Implementation (30%): hybrid RAG + structured gateway + scheduling correctness
- Creativity (20%): themed Bari mascot + learner-focused evidence UX
- Real-World Impact (20%): safer learning via grounding + offline-first reliability
- UX (15%): minimalist focused flow
- Presentation (15%): clear Devpost artifacts + demo video clarity

## 15) Appendix: Repo file map (fill in exact paths)
Front-end:
- app/index.tsx:
- app/sources.tsx:
- app/study.tsx:
- app/deck/[id].tsx:
- src/components/BariMascot:
- src/components/BariChatModal:
- src/components/SourceProvenance:
- src/storage/repository.ts:

Back-end:
- services/ai_gateway:
- RAG / retrieval modules:
- Gemini provider gateway module:
- pytest suites:
- embedding/BM25 indexing scripts:

## 16) Appendix: Open questions / TODOs (keep honest)
- TODO: confirm exact navigation routes and entry points
- TODO: lock in and document retrieval constants (top-k, RRF params, thresholds)
- TODO: confirm offline fallback behavior coverage (which endpoints support it)
- TODO: confirm undo semantics boundaries under app restart

## 17) Appendix: Team maintenance checklist (simple)
Before each milestone announcement:
- update Change log
- validate invariants checklist
- capture demo screenshots/videos plan
- run required verification gates

