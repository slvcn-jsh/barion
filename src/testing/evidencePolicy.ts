import type { ReviewRating, TestConfidence } from '@/domain/types';

export type TestEvidenceDecision = {
  rating: ReviewRating;
  weakDelta: number;
  confidentMiss: boolean;
};

export function decideTestEvidence(isCorrect: boolean, confidence: TestConfidence): TestEvidenceDecision {
  const confidentMiss = !isCorrect && confidence !== 'unsure';
  return {
    rating: !isCorrect
      ? 'again'
      : confidence === 'unsure'
        ? 'hard'
        : confidence === 'easy'
          ? 'easy'
          : 'good',
    weakDelta: isCorrect ? (confidence === 'unsure' ? -0.25 : -0.75) : confidentMiss ? 4 : 2,
    confidentMiss,
  };
}
