import type { StudyCard } from '@/domain/types';

export type PlanMix = {
  weakCount: number;
  dueCount: number;
  newCount: number;
  estimatedMinutes: number;
};

export function summarizePlanCards(cards: StudyCard[]): PlanMix {
  let weakCount = 0;
  let newCount = 0;
  let dueCount = 0;
  for (const card of cards) {
    if ((card.weakScore ?? 0) > 0) weakCount += 1;
    else if (!card.lastReviewedAt) newCount += 1;
    else dueCount += 1;
  }
  return {
    weakCount,
    dueCount,
    newCount,
    estimatedMinutes: cards.length ? Math.max(1, Math.ceil(cards.length * 0.75)) : 0,
  };
}

export function planReason(mix: PlanMix, totalCount: number) {
  if (!totalCount) {
    return 'Today’s scheduled work is complete. Barion will bring concepts back when retrieval is useful.';
  }
  if (mix.weakCount) {
    return 'Weak concepts come first, followed by due reviews and a guarded number of new cards.';
  }
  return 'Due reviews come first, with new material added only inside your daily guardrails.';
}
