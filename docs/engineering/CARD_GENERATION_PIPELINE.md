# Card Generation Pipeline

Date: 2026-09-30

## Execution map

```text
source picker
  -> sourceRepository.importSourceAsset
  -> persist imported file
  -> one source/deck/sync transaction
  -> sourceRepository.prepareSource
     -> read and normalize source
     -> persist source segments and study guide in one transaction
     -> source status: generating
  -> generationRepository.generateDraftsForSource
     -> in-memory same-source guard
     -> create generation job in one transaction
     -> build local extractive candidates
     -> score and select candidates outside transaction
     -> publication transaction
        -> persist study guide and candidate audit rows
        -> trash only untouched/unreviewed auto-created cards
        -> approve selected candidates
        -> create/update notes, cards, memory state, evidence, quality, search index
        -> finish generation job
        -> source status: ready
  -> source screen polls repository state
  -> local cards become study/browse/test input

Smart Enhancement
  -> source action or queued-job recovery
  -> generationRepository.enhanceDraftsForSource
  -> create generation job transaction
  -> batchGeneration.runBatchedGeneration
  -> gatewayProvider -> POST /v1/card-generation -> Gemini
  -> parse/schema validation/evaluation
  -> candidate scoring and selection outside transaction
  -> persist validated batch checkpoint in a short write transaction
  -> same short publication transaction described above
     -> clear checkpoint only after completed publication
  -> source screen observes completed job and ready source
```

Source screen displays persisted state. Import/retry paths run local baseline first, then create one durable automatic Smart Enhancement job. Startup resumes eligible queued work. Local study controls remain usable while source screen polls active enhancement state.

## Resolved 60 to 0 transition

Remote response reaches `runBatchedGeneration`, then `generationRepository` records these selection counts before persistence:

- raw and remote candidates
- publishable candidates
- selected candidates
- unsafe, low-quality, duplicate, and budget drops
- evaluation dispositions and reason codes

Selected candidates enter one publication transaction. Earlier evidence showed `remoteCandidateCount: 60`, `failureReason: null`, then `cannot start a transaction within a transaction`; loss occurred after provider response and before commit.

Fixed behavior:

- All multi-statement repository writes use one per-database FIFO coordinator.
- Connection-wide `isInTransactionSync()` is never treated as proof that a caller owns the active transaction.
- Smart Generation waits behind an overlapping local write while retaining its validated candidate batch in memory; Gemini is not called again.
- Validated remote batches are checkpointed before publication. Interrupted or failed equivalent jobs resume that batch without another provider request.
- Checkpoint recovery preserves original provider, model, prompt, request, and token provenance even if current configuration changes.
- Malformed checkpoints fail terminally, are discarded, and require an explicit clean retry; they cannot cycle forever or publish malformed cards.
- Publication failure persists known provider request ID, token usage, remote candidate count, and selection metadata in the terminal job transition.
- Existing local cards return to `ready` after publication failure.

Focused browser proof now drives Expo SDK 57 SQLite with six mocked Gemini batches totaling 60 valid candidates. Backup inspection confirms 60 candidate audit rows, a completed `REMOTE_AI` job, nonzero published cards, and no nested-transaction error.

## Transaction ownership

Business operation transaction owners:

| Operation | Owner | Called helpers start transaction? |
| --- | --- | --- |
| Initial source/deck persistence | `sourceRepository.importSourceAsset` | No |
| Extracted segments and guide | `sourceRepository.prepareSource` | No |
| Generation-job creation | `generationRepository.generateDraftsForSourceInternal` | No |
| Candidate publication and terminal state | `generationRepository.generateDraftsForSourceInternal` | `approveCandidateUsingDatabase(..., alreadyInTransaction=true)` does not |
| Manual candidate approval | `approveCandidateUsingDatabase` | Yes, only when caller does not own transaction |
| Candidate rejection/finalization | `generationRepository.rejectCandidate` | No |

`runWriteTransaction` is transaction boundary. Before consolidation, four implementations existed: shared repositories, study activity, match game, and backup restore. On web, Expo SDK 57 implements `db.withTransactionAsync` as `BEGIN -> task -> COMMIT` on shared connection. SDK documentation/source states transaction is non-exclusive and can be interrupted by other async queries; exclusive transactions are unsupported on web.

## Root-cause mechanism

```text
writer A: BEGIN -> async writes ----------------------> COMMIT
writer B:            BEGIN
                     -> SQLite: cannot start transaction within transaction
                     -> Expo catch issues ROLLBACK on shared connection
writer A: remaining writes now have lost transaction ownership
```

Required invariant: one active multi-statement transaction per web database connection. All repository transaction wrappers must use one coordinator. Network calls, parsing, evaluation, and merge planning stay outside transaction.

`isInTransactionSync()` exposes connection state, not async caller ownership. An unrelated writer can see `true` while another writer owns transaction. Bypassing coordinator on that signal interleaves writes inside wrong transaction, so coordinator never uses it as nested-call detection.

## State and UI status

- Smart Enhancement uses `waiting-for-generation` while local cards exist, so study and browse actions remain usable.
- Database partial unique index enforces one `running` or `publishing` job per source; in-memory guard coalesces same-runtime calls.
- Startup recovery converts interrupted jobs to durable `queued` state.
- Provider and publication failures preserve usable local cards and return source to `ready`.
- `REVIEW` candidates remain pending and non-studyable. Jobs persist their held count; sources with no study cards but held candidates terminate as `review-ready`.
- `SourceStatusPill` still uses stage estimates rather than measured progress; this is presentation, not transaction correctness.

## Safety invariants

- Local cards remain usable during Smart Enhancement.
- One source has at most one active generation job.
- Every remote candidate is counted as selected or rejected with reason.
- Publication either commits cards plus job/source state, or commits none.
- Publication waits for transaction ownership while retaining validated candidate batch; it does not call Gemini again.
- Process restart after checkpoint persistence resumes publication without calling Gemini.
- Transient publication failure receives one bounded in-process retry using same validated batch; failure count is persisted in selection metadata.
- Reviewed, manually edited, or user-created cards are never replaced automatically.
- Partial Smart Enhancement replaces only untouched auto cards for covered concept targets; uncovered local cards remain active.
- Every generation path ends in completed, queued/deferred, or failed state; UI never depends on permanent `generating`.

## Durable job identity and retry

- Schema version 26 adds `purpose` and stable `generation_key` to generation jobs.
- Schema version 27 adds nullable `candidate_checkpoint_json`; old databases add it in place, and backup rows preserve it as scalar local data.
- Key derives from source ID/hash, purpose, prompt ID, and prompt version.
- Partial unique index permits one equivalent queued/running/publishing job.
- Completed equivalent Smart Enhancement suppresses repeated paid requests.
- Queued jobs resume in place with same job/request identity and a three-attempt Smart ceiling.
- Interrupted local work resumes as local baseline, not remote enhancement.
- Publication retries are separate from provider retries; database failure never automatically calls Gemini again.

## Evaluator calibration gate

Project-authored calibration fixtures distinguish `ENTAILED`, `UNSUPPORTED`, `CONTRADICTED`, `AMBIGUOUS`, and `BAD_LEARNING_ITEM`. Current frozen result is 0.9 label accuracy and 0.9 disposition accuracy, with zero false acceptances and one false rejection. Explicit document-mechanics questions now fail with `LOW_EDUCATIONAL_VALUE`; concise medication, anatomy, and developmental answers remain publishable. Known false rejection is a legitimate endometrial-proliferation paraphrase.

Production evaluation metadata includes exact `validationCodes` separately from final policy `reasonCodes`. Current gateways emit both; TypeScript accepts older responses without `validationCodes` and preserves codes when present.

Semantic verification remains an offline experiment. One Gemini 3.8 Flash diagnostic corrected a lexical paraphrase false rejection but falsely accepted a candidate whose declared evidence was ambiguous because the same text appeared twice. Therefore semantic output cannot override deterministic contradiction, evidence-resolution ambiguity, or educational-value vetoes. Current experimental hybrid escalates only deterministic `UNSUPPORTED` outcomes and has no production publication authority.

Therefore AI-only user-facing generation remains deferred. Removing local studyable cards now would turn valid paraphrases into explicit failures. Existing lexical matcher is not promoted into a semantic publication gate, and no synonym patch is hardcoded. Next prerequisite is authorized human calibration evidence plus a source-bounded semantic verifier experiment.

Immutable generation runs can now become review candidates without treating model output as truth. `evaluator_artifact_fixture` re-extracts the original PDF, reproduces stable segments, verifies manifest source/deck/segment hashes, requires uniquely resolvable evidence, and emits unlabeled cases. It fails closed until source evaluation rights, license status, sensitivity classification, and inference-only use are declared. Human cross-role consensus remains required before calibration or semantic comparison can treat labels as evaluation evidence.
