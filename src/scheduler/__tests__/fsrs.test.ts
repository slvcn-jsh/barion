import { applyFsrsReview, createInitialFsrsCard, previewFsrsOutcomes, replayFsrsReviews } from '@/scheduler/fsrs';

describe('FSRS scheduling', () => {
  const startedAt = new Date('2026-01-01T08:00:00.000Z');

  it('produces valid future outcomes for every rating', () => {
    const initial = createInitialFsrsCard(startedAt);
    const outcomes = previewFsrsOutcomes(initial, startedAt);

    for (const dueAt of Object.values(outcomes)) {
      expect(Number.isNaN(Date.parse(dueAt))).toBe(false);
      expect(Date.parse(dueAt)).toBeGreaterThan(startedAt.getTime());
    }
    expect(Date.parse(outcomes.easy)).toBeGreaterThan(Date.parse(outcomes.good));
  });

  it('replays review history to the same state as sequential scheduling', () => {
    const initial = createInitialFsrsCard(startedAt);
    const firstAt = new Date('2026-01-01T08:05:00.000Z');
    const secondAt = new Date('2026-01-04T08:05:00.000Z');
    const first = applyFsrsReview(initial, 'good', firstAt);
    const second = applyFsrsReview(first.cardJson, 'hard', secondAt);
    const replayed = replayFsrsReviews(initial, [
      { rating: 'good', reviewedAt: firstAt.toISOString() },
      { rating: 'hard', reviewedAt: secondAt.toISOString() },
    ]);

    expect(replayed.cardJson).toBe(second.cardJson);
    expect(replayed.dueAt).toBe(second.dueAt);
  });
});
