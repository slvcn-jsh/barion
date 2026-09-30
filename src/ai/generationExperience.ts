import type { GenerationJobSummary } from '@/domain/types';

export type StudentGenerationExperience = {
  title: string;
  body: string;
  notice?: string;
};

export const GENERATION_FAILURE_ALERT = {
  title: 'Deck update did not finish',
  body: 'No low-quality cards were substituted. Your source and existing cards remain safe. Open the source workspace for the next step.',
} as const;

export function describeStudentGeneration(
  job: GenerationJobSummary | undefined,
  cardCount: number,
  deckTitle: string,
  sourceReady = true,
): StudentGenerationExperience {
  const cards = `${cardCount} card${cardCount === 1 ? '' : 's'}`;
  const held = job?.heldCandidateCount
    ? ` ${job.heldCandidateCount} uncertain card${job.heldCandidateCount === 1 ? ' was' : 's were'} left out.`
    : '';

  if (job?.status === 'queued') {
    return {
      title: 'Waiting for Smart Generation',
      body: cardCount
        ? `${cards} from an earlier preparation remain available in ${deckTitle}.`
        : 'Your source is imported and safe. No basic cards were substituted.',
      notice: queuedNotice(job.nextAttemptAt),
    };
  }

  if (job?.generationMode === 'LOCAL_BASELINE') {
    return {
      title: 'Your study set is ready',
      body: `${cards} are organized in ${deckTitle}.${held}`,
      notice: 'Source-matched cards are ready now. Smart Enhancement is optional and can refine untouched auto-created cards later.',
    };
  }

  if (job?.generationMode === 'LOCAL_FALLBACK') {
    return {
      title: 'Smart regeneration required',
      body: cardCount
        ? `${cards} from an older basic-generation workflow remain in ${deckTitle}.`
        : 'This older generation did not use the current Smart Generation quality path.',
      notice: 'Regenerate from the source before relying on these cards for serious study.',
    };
  }

  if (job?.status === 'failed' || job?.generationMode === 'FAILED') {
    return failedExperience(job.failureReason, cardCount, cards, deckTitle);
  }

  if (!sourceReady && cardCount) {
    return {
      title: 'Deck needs reprocessing',
      body: `${cards} remain available in ${deckTitle}, but core source coverage did not pass the readiness gate.`,
      notice: 'Refresh from source. Barion will keep existing cards until a stronger Smart Generation result is ready.',
    };
  }

  return {
    title: 'Your study set is ready',
    body: `${cards} are organized in ${deckTitle}.${held}`,
  };
}

function failedExperience(
  reason: string | null | undefined,
  cardCount: number,
  cards: string,
  deckTitle: string,
): StudentGenerationExperience {
  const preserved = cardCount
    ? `${cards} from an earlier preparation remain available in ${deckTitle}.`
    : 'Your source remains safely imported. No low-quality cards were published.';

  switch (reason) {
    case 'configuration_error':
    case 'gateway_not_configured':
    case 'authentication_error':
      return {
        title: 'Smart Generation setup required',
        body: preserved,
        notice: 'Barion could not use its secure Smart Generation connection. Check app configuration, then retry.',
      };
    case 'request_too_large':
      return {
        title: 'Source is too large for one request',
        body: preserved,
        notice: 'Split the source into smaller files or sections, then import it again.',
      };
    case 'insufficient_evidence':
      return {
        title: 'Source needs clearer evidence',
        body: preserved,
        notice: 'Use a clearer text-based file or review extracted source sections before retrying.',
      };
    case 'invalid_provider_response':
      return {
        title: 'Smart Generation returned unusable cards',
        body: preserved,
        notice: 'Nothing unsafe was published. Retry once; if it repeats, keep the source and report the issue.',
      };
    default:
      return {
        title: 'Deck update did not finish',
        body: preserved,
        notice: 'Retry Smart Generation. Existing content will not be replaced unless a quality-checked result is ready.',
      };
  }
}

function queuedNotice(nextAttemptAt: string | null | undefined) {
  if (!nextAttemptAt) {
    return 'Barion will retry automatically when Smart Generation is available. You can also retry now.';
  }
  const retryAt = new Date(nextAttemptAt);
  if (Number.isNaN(retryAt.getTime())) {
    return 'Barion will retry automatically when Smart Generation is available. You can also retry now.';
  }
  return `Automatic retry scheduled for ${retryAt.toLocaleString()}. You can also retry now.`;
}
