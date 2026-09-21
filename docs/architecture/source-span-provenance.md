# Source-span provenance contract

## Scope

Phase 4 synchronizes Python gateway/benchmark and React Native contracts. Existing batching, retry, continuation, diagnostics, budgets, and immutable Phase 3 artifacts remain unchanged.

## Prior contracts

- Generation request: `requestId`, prompt identity/version, prompts, candidate bounds, model. Source segments live in JSON `userPrompt` as `segmentId`, `locator`, `sectionPath`, `text`.
- Provider candidate: `segmentId`, `cardType`, `learningObjective`, `question`, `answer`, `evidenceText`.
- Gateway response: request/provider/model envelope, generated candidates, optional token usage.
- Mobile candidate: gateway fields plus trusted locator. Validation previously required direct `String.includes` evidence membership.
- Local candidate: same mobile shape, created extractively from persisted source segments.
- Storage: segment text and segment offsets; generated candidates stored evidence text, locator, verification status, and score. No canonical evidence-span metadata.
- Benchmark source reference: segment, locator, evidence text, optional unversioned offsets. Historical Phase 3 offsets are null.

## Version 1

`source-span/1.0.0` fields:

- `offsetEncoding`: `utf16-code-units`
- `boundaryConvention`: `half-open`
- `startOffset`, `endOffset`: zero-based `[start, end)` boundaries
- `evidenceTextSha256`, `sourceTextSha256`: lowercase SHA-256 over UTF-8 bytes
- `status`: `exact`, `normalized`, `context-disambiguated`, `ambiguous`, `not-found`, `invalid`, or `stale-source`
- `matchCount`: deterministic candidate-match count

UTF-16 code units match JavaScript string indexing. Python explicitly converts Unicode code-point positions to UTF-16 units. Hashes remain byte-defined and cross-language.

## Trust and compatibility

Provider offsets are never accepted as authority. Gateway and mobile resolve evidence against trusted source-segment text and derive offsets/hashes. Exact matching runs first; NFKC plus whitespace normalization runs second; optional trusted surrounding context may disambiguate multiple matches. Multiple unresolved matches never choose first occurrence.

Gateway candidate span is optional at parse boundary for legacy compatibility. Python gateway derives it before serialization. Mobile ignores any supplied provider span and derives its own. Existing database rows keep nullable `evidence_span_json`; review UI labels them legacy/unresolved. New local and remote candidates persist derived metadata. Unresolved or stale spans require source review.

Shared conformance fixture: `services/source_span_contract.json`.
