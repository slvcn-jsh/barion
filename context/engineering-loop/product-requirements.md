# Product Requirements: Source Deck Readiness

## User outcome

After upload or refresh, learner receives concise cards, can start a valid session immediately, and never needs to repair unsafe AI output.

## Functional requirements

1. Deck-scoped and module-scoped study queues bind filters correctly.
2. UI distinguishes total cards from cards available in scheduled session.
3. Empty study screen reports one exact cause and offers preview when active cards exist.
4. Multi-column PDF tables preserve row and column ownership.
5. Malformed fragments, navigation text, and source questions cannot become core targets.
6. Basic mode creates one useful anchor per supported core target.
7. Card budget applies to all selection paths.
8. Smart fallback retains actual failure category for internal diagnostics.
9. Ready state requires usable cards and valid source ownership.

## Acceptance gates

- Reviewer core targets: 14-16.
- Malformed card fronts: 0.
- Cross-method evidence mismatch: 0.
- Unsafe automatic publication: 0.
- Explicit first-study launch success: 100%.
- Reviewed and edited card preservation: 100%.
- Duplicate rate: below 5%.
- Smart-unavailable deck remains useful and studyable.

