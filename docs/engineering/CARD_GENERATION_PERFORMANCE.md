# Card Generation Reliability and Performance

Date: 2026-09-30

## Local result

Source-to-study persistence passes focused Expo web proof for a 60-candidate remote result.

| Check | Result |
| --- | --- |
| Local baseline available before Smart Generation | Pass |
| Existing cards survive HTTP 429 | Pass |
| 60 remote candidates survive selection and persistence | Pass |
| Nested transaction error | Not reproduced after coordinator fix |
| Candidate audit rows for remote job | 60 |
| Remote provider calls during persistence | 0 additional calls |
| Focused 60-candidate browser test | 6.8 seconds total test time |
| Post-click local performance gate | Under 30 seconds |

Test uses real Expo SDK 57 SQLite web worker and mocked gateway responses. Timing includes browser interaction and backup export, varies by machine, and does not represent Gemini network latency.

## Paid Gemini canary

Bounded local canary on 2026-09-29 used service-owned credentials and the configured `gemini-3.8-flash` primary through the real gateway.

| Check | Result |
| --- | --- |
| Representative card requests | 5/5 HTTP 200 |
| Returned HTTP 503 | 0 |
| Model fallback | 0 |
| Card latency P50 | 3.533 seconds |
| Card latency nearest-rank P95 / observed max | 8.398 seconds |
| Validated candidates | 30 |
| Automatic disposition | 23 PUBLISH / 2 REVIEW / 5 REJECT |
| Exact evidence spans | 30/30 |
| Source sections covered | All supplied sections in all five fixtures |
| Bari Chat requests | 3/3 HTTP 200 |
| Bari Chat latency P50 / max | 2.549 / 2.716 seconds |
| Unsupported chat question | Explicitly declined from supplied evidence |

Live Expo web flow produced seven local cards in 2.337 seconds while Gemini remained in flight. Smart Enhancement reached persisted `ready` state in 6.766 seconds, retained seven active cards while replacing five covered targets with AI cards, and made no duplicate request after navigation plus reload. Gateway telemetry recorded the browser request on primary Gemini attempt 1 with `retryCount=0` and `fallbackUsed=false`.

This sample proves current local behavior, not permanent or deployed availability. Thirteen paid card requests and three paid chat requests returned HTTP 200 during the investigation, but one harness run lost its local timing output after the request completed. Sustained production SLOs still require deployed canaries.

## Performance design

- File persistence, parsing, Gemini requests, response validation, scoring, and candidate selection run outside write transaction.
- Publication holds one transaction only for database state changes required for atomic replacement.
- FIFO coordinator serializes multi-statement writes per database connection. No polling or busy retry loop.
- Candidate budget caps automatically published cards at 18 while retaining all candidates as auditable accepted/rejected rows.
- Validated remote output is serialized once before publication. Restart recovery reads local checkpoint and spends zero additional provider calls.
- Existing untouched auto-created cards are replaced only after validated remote candidates are ready to publish.
- Smart Enhancement retires untouched auto-created cards only for concept targets that have selected remote replacements. Local cards for uncovered targets remain available, preventing coverage regression.

## Reliability proof

Regression coverage now checks:

- Connection reports active transaction while second writer arrives; second writer must remain queued.
- Queue continues after predecessor rollback.
- Publication failure after 60 remote candidates preserves `remote_candidate_count`, provider evidence, and selection metadata.
- One transient publication failure retries the retained validated batch without another provider request.
- A second publication failure becomes terminal and records `publicationFailureCount: 2`.
- Process restart resumes a validated checkpoint without a provider request and preserves original model/provider provenance.
- Corrupt checkpoint data fails once, clears checkpoint, preserves existing cards, and permits only a later explicit clean generation retry.
- `REVIEW` candidates remain held, non-studyable, and accurately counted in terminal job state.
- Existing local cards remain `ready` after publication failure.
- Browser backup contains completed remote job and all 60 candidate rows.

## Remaining evidence gap

Current paid canaries cover local Windows web only. Production still needs deployed sustained measurements for provider availability, fallback rate, TTFAIC, publication duration, cost, quota behavior, and native devices.

Evaluator calibration remains release-critical: 10 frozen project-authored cases currently score 0.9 label accuracy and 0.9 disposition accuracy, with zero false acceptances and one false rejection. Deterministic document-mechanics rejection fixed the known unsafe acceptance without changing semantic grounding. Remaining false rejection still blocks removal of local studyable cards and claims that remote output is fully ready-to-study medical material. Latency optimization and additional paid generation should not outrun verifier correctness.

Semantic-verifier diagnostic: one 10-case Gemini 3.8 Flash structured batch took 3.187 seconds with 1,007 input and 560 output tokens. Raw semantic accuracy remained 0.9 because fixing one paraphrase introduced one ambiguity false acceptance. Reusing that response through progressive hybrid logic produced 1.0 diagnostic accuracy without another paid call. Sample size and review provenance are insufficient for latency, quality, or production-promotion claims.

Persisted 50-card Gemini benchmark output was inspected as a possible larger calibration source. Its source/deck/segment lineage is hash-verifiable and Phase 4 resolved all 50 evidence spans exactly, but source metadata contains no title/author/license/consent/evaluation authorization. No content was promoted into a fixture. New tooling can perform deterministic conversion after an owner supplies explicit non-sensitive, rights-approved, inference-only evaluation governance.
