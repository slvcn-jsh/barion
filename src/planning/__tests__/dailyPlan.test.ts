import type { StudyCard } from '@/domain/types';
import { planReason, summarizePlanCards } from '@/planning/dailyPlan';

function card(id: string, state: 'weak' | 'due' | 'new'): StudyCard {
  return {
    id,
    deckId: 'deck',
    deckTitle: 'Set',
    prompt: id,
    answer: id,
    cardType: 'definition',
    status: 'verified',
    isStarred: false,
    dueAt: '2026-01-01T00:00:00.000Z',
    fsrsCardJson: '{}',
    weakScore: state === 'weak' ? 2 : 0,
    lastReviewedAt: state === 'new' ? null : '2025-12-01T00:00:00.000Z',
  };
}

describe('daily Autopilot plan', () => {
  it('classifies each card once with weakness taking priority', () => {
    const mix = summarizePlanCards([card('weak', 'weak'), card('due', 'due'), card('new', 'new')]);
    expect(mix).toEqual({ weakCount: 1, dueCount: 1, newCount: 1, estimatedMinutes: 3 });
    expect(planReason(mix, 3)).toMatch(/Weak concepts come first/);
  });

  it('represents an empty day honestly', () => {
    const mix = summarizePlanCards([]);
    expect(mix.estimatedMinutes).toBe(0);
    expect(planReason(mix, 0)).toMatch(/complete/);
  });
});
