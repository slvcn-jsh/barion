import type { GenerationJobSummary } from '@/domain/types';

export type StudentGenerationExperience = {
  title: string;
  body: string;
  basicModeNotice?: string;
};

export const GENERATION_FAILURE_ALERT = {
  title: 'Deck update did not finish',
  body: 'Barion could not update this deck. Your existing cards remain available. Try again when Smart Generation is available.',
} as const;

export function describeStudentGeneration(
  job: GenerationJobSummary | undefined,
  cardCount: number,
  deckTitle: string,
): StudentGenerationExperience {
  const cards = `${cardCount} card${cardCount === 1 ? '' : 's'}`;
  const held = job?.heldCandidateCount
    ? ` ${job.heldCandidateCount} uncertain card${job.heldCandidateCount === 1 ? ' was' : 's were'} left out.`
    : '';

  if (job?.generationMode === 'LOCAL_FALLBACK') {
    return {
      title: 'Basic deck ready',
      body: `${cards} are organized in ${deckTitle}.${held}`,
      basicModeNotice: 'Created in basic mode because Smart Generation was unavailable. You can study now and try Smart Generation again when it is available.',
    };
  }

  if (job?.generationMode === 'FAILED') {
    return {
      title: 'Deck update did not finish',
      body: cardCount
        ? `${cards} from an earlier preparation remain available in ${deckTitle}.`
        : 'Barion could not prepare study cards from this material. Try again when the source and Smart Generation are available.',
    };
  }

  return {
    title: 'Your study set is ready',
    body: `${cards} are organized in ${deckTitle}.${held}`,
  };
}
