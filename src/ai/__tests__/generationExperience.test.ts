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

  it('explains local fallback without leaking technical failure details', () => {
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

    expect(message.title).toBe('Basic deck ready');
    expect(message.basicModeNotice).toContain('Smart Generation was unavailable');
    expect(JSON.stringify(message)).not.toMatch(/model_unavailable|gateway|gemini|LOCAL_FALLBACK|HTTP/i);
  });

  it('uses product-safe copy when generation fails', () => {
    expect(GENERATION_FAILURE_ALERT.title).toBe('Deck update did not finish');
    expect(GENERATION_FAILURE_ALERT.body).toContain('existing cards remain available');
    expect(JSON.stringify(GENERATION_FAILURE_ALERT)).not.toMatch(/HTTP|gateway|provider|model|timeout|auth/i);
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
    createdAt: '2026-09-22T00:00:00.000Z',
    ...overrides,
  };
}
