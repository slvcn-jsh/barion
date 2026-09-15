import {
  type Card as FsrsCard,
  FSRSVersion,
  Rating,
  createEmptyCard,
  fsrs,
} from 'ts-fsrs';

import type { ReviewRating } from '@/domain/types';

const scheduler = fsrs({
  enable_fuzz: false,
});

export const schedulerVersion = `ts-fsrs-${FSRSVersion}`;

export function createInitialFsrsCard(now = new Date()) {
  return serializeFsrsCard(createEmptyCard(now));
}

export function applyFsrsReview(fsrsCardJson: string, rating: ReviewRating, reviewedAt = new Date()) {
  const card = hydrateFsrsCard(fsrsCardJson);
  const result = scheduler.next(card, reviewedAt, toFsrsRating(rating));
  const retrievability = scheduler.get_retrievability(result.card, reviewedAt, false) ?? null;

  return {
    cardJson: serializeFsrsCard(result.card),
    dueAt: result.card.due.toISOString(),
    difficulty: result.card.difficulty ?? null,
    stability: result.card.stability ?? null,
    retrievability,
    log: result.log,
  };
}

export function replayFsrsReviews(
  initialFsrsCardJson: string,
  reviews: { rating: ReviewRating; reviewedAt: string }[],
) {
  let state: {
    cardJson: string;
    dueAt: string;
    difficulty: number | null;
    stability: number | null;
    retrievability: number | null;
    log: unknown;
  } = {
    cardJson: initialFsrsCardJson,
    dueAt: JSON.parse(initialFsrsCardJson).due as string,
    difficulty: null,
    stability: null,
    retrievability: null,
    log: null,
  };

  for (const review of reviews) {
    state = applyFsrsReview(state.cardJson, review.rating, new Date(review.reviewedAt));
  }

  return state;
}

export function previewFsrsOutcomes(fsrsCardJson: string, now = new Date()) {
  const card = hydrateFsrsCard(fsrsCardJson);
  const preview = scheduler.repeat(card, now);

  return {
    again: preview[Rating.Again].card.due.toISOString(),
    hard: preview[Rating.Hard].card.due.toISOString(),
    good: preview[Rating.Good].card.due.toISOString(),
    easy: preview[Rating.Easy].card.due.toISOString(),
  };
}

function toFsrsRating(rating: ReviewRating) {
  switch (rating) {
    case 'again':
      return Rating.Again;
    case 'hard':
      return Rating.Hard;
    case 'good':
      return Rating.Good;
    case 'easy':
      return Rating.Easy;
  }
}

function hydrateFsrsCard(value: string): FsrsCard {
  const raw = JSON.parse(value) as FsrsCard & {
    due: string;
    last_review?: string | null;
  };

  return {
    ...raw,
    due: new Date(raw.due),
    last_review: raw.last_review ? new Date(raw.last_review) : undefined,
  };
}

function serializeFsrsCard(card: FsrsCard) {
  return JSON.stringify({
    ...card,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : null,
  });
}
