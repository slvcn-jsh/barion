# Architecture Blueprint: Trustworthy Source-to-Study Pipeline

## Objective

Turn an uploaded source into a compact, source-owned, immediately studyable deck even when remote generation is unavailable.

## Terms

- **Layout block:** PDF text with page coordinates retained long enough to reconstruct reading order.
- **Structured segment:** One coherent source section or table row with explicit field labels.
- **Core target:** One high-value concept that should receive one anchor card.
- **Source-matched card:** Deterministic card whose answer and evidence are owned by one structured segment.
- **Smart-reviewed card:** Remote candidate that also passes grounding, safety, pedagogy, and selection gates.
- **Study availability:** Exact count and reason produced by queue rules, independent of deck size.

## Pipeline

`PDF layout -> structured segments -> core target inventory -> Smart/local candidates -> quality and safety selection -> cards and memory state -> study availability -> study UI`

## Decisions

1. Fix failures at owning layers: SQL binding in study repository, layout ownership in ingestion, quality in candidate creation/selection, readiness in source presentation.
2. Smart Generation improves wording. It does not own coverage or availability.
3. Basic mode uses structured source fields and measured quality. No fixed quality score.
4. One authoritative target inventory drives guide, candidates, coverage, selection, and readiness.
5. Explicit deck launch respects profile limits but always offers an all-card preview path.
6. Existing reviewed or edited cards remain preserved. Untouched generated cards remain recoverable through Trash.
7. Medical source fidelity and clinical currency remain separate trust dimensions.

## Boundaries

- No source-specific contraception parser in product logic.
- No provider-specific requirement for minimum deck coverage.
- No silent bypass of safety, source ownership, suspension, or deletion rules.
- No destructive reset of existing workspace data.

