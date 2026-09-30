import { describeStudentGeneration, GENERATION_FAILURE_ALERT } from '@/ai/generationExperience';
import type { GenerationJobSummary } from '@/domain/types';

describe('describeStudentGeneration', () => {
  it('keeps successful remote generation simple', () => {
    const message = describeStudentGeneration(job({
      generationMode: 'REMOTE_AI',
      fallbackUsed: false,
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
      remoteCandidateCount: 12,
      publishedCardCount: 10,
      heldCandidateCount: 2,
    }), 10, 'Cardiology');

    expect(message).toEqual({
      title: 'Your study set is ready',
      body: '10 cards are organized in Cardiology. 2 uncertain cards were left out.',
    });
    expect(JSON.stringify(message)).not.toMatch(/gemini|provider|request|REMOTE_AI/i);
  });

  it('marks legacy basic generation as requiring Smart regeneration', () => {
    const message = describeStudentGeneration(job({
      generationMode: 'LOCAL_FALLBACK',
      fallbackUsed: true,
      fallbackReason: 'model_unavailable',
      providerId: 'local-extractive',
      modelId: 'barion-extractive-rules',
      attemptedProviderId: 'barion-gateway',
      attemptedModelId: 'gemini-2.5-flash',
      remoteCandidateCount: 0,
      publishedCardCount: 6,
      heldCandidateCount: 0,
    }), 6, 'Pharmacology');

    expect(message.title).toBe('Smart regeneration required');
    expect(message.notice).toContain('Regenerate from the source');
    expect(JSON.stringify(message)).not.toMatch(/model_unavailable|gateway|gemini|LOCAL_FALLBACK|HTTP/i);
  });

  it('uses product-safe copy when generation fails', () => {
    expect(GENERATION_FAILURE_ALERT.title).toBe('Deck update did not finish');
    expect(GENERATION_FAILURE_ALERT.body).toContain('existing cards remain safe');
    expect(JSON.stringify(GENERATION_FAILURE_ALERT)).not.toMatch(/HTTP|gateway|provider|model|timeout|auth/i);
  });

  it('presents local baseline as ready while keeping Smart Enhancement optional', () => {
    const message = describeStudentGeneration(job({
      generationMode: 'LOCAL_BASELINE',
      fallbackUsed: false,
      providerId: 'local-extractive',
      modelId: 'barion-extractive-rules',
      publishedCardCount: 8,
    }), 8, 'Pharmacology');

    expect(message.title).toBe('Your study set is ready');
    expect(message.body).toContain('8 cards are organized in Pharmacology');
    expect(message.notice).toContain('Smart Enhancement is optional');
    expect(JSON.stringify(message)).not.toMatch(/provider|model|LOCAL_BASELINE/i);
  });

  it('explains queued Smart Generation without claiming cards are ready', () => {
    const message = describeStudentGeneration(job({
      status: 'queued',
      generationMode: null,
      failureReason: 'network_error',
      nextAttemptAt: '2026-09-22T00:05:00.000Z',
    }), 0, 'Neurology');

    expect(message.title).toBe('Waiting for Smart Generation');
    expect(message.body).toContain('No basic cards were substituted');
    expect(message.notice).toContain('Automatic retry scheduled');
  });

  it('gives actionable setup copy for terminal configuration failures', () => {
    const message = describeStudentGeneration(job({
      status: 'failed',
      generationMode: 'FAILED',
      failureReason: 'gateway_not_configured',
    }), 0, 'Neurology');

    expect(message.title).toBe('Smart Generation setup required');
    expect(message.body).toContain('No low-quality cards were published');
    expect(message.notice).toContain('Check app configuration');
  });

  it('keeps persisted failed-job details out of learner copy', () => {
    const message = describeStudentGeneration(job({
      status: 'failed',
      generationMode: 'FAILED',
      failureReason: 'provider_timeout',
      fallbackReason: 'gateway_unavailable',
      providerId: 'local-extractive',
      modelId: 'barion-extractive-rules',
    }), 4, 'Neurology');

    expect(message.title).toBe('Deck update did not finish');
    expect(message.body).toContain('4 cards from an earlier preparation remain available');
    expect(JSON.stringify(message)).not.toMatch(/provider_timeout|gateway_unavailable|FAILED|local-extractive/i);
  });
  it('explains when deck needs reprocessing because readiness gate failed', () => {
    const message = describeStudentGeneration(
      job({
        generationMode: 'REMOTE_AI',
        publishedCardCount: 5,
      }),
      5,
      'Cardiology',
      false,
    );

    expect(message.title).toBe('Deck needs reprocessing');
    expect(message.body).toContain('5 cards remain available in Cardiology, but core source coverage did not pass the readiness gate');
    expect(message.notice).toContain('Refresh from source');
  });
});

function job(overrides: Partial<GenerationJobSummary>): GenerationJobSummary {
  return {
    id: 'job-1',
    status: 'completed',
    summary: 'Complete',
    generationMode: 'REMOTE_AI',
    fallbackUsed: false,
    providerId: 'provider',
    modelId: 'model',
    promptId: 'prompt',
    promptVersion: '1',
    remoteCandidateCount: 0,
    publishedCardCount: 0,
    heldCandidateCount: 0,
    attemptCount: 1,
    createdAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}
