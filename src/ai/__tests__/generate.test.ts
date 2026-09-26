import { generateGroundedCards, generateGroundedCardsWithFallback } from '@/ai/generate';
import type { AITelemetryEvent, CardGenerationProvider } from '@/ai/types';

const provider: CardGenerationProvider = {
  id: 'test-provider',
  model: 'test-model',
  async generate(request) {
    return {
      providerRequestId: 'provider-request-1',
      providerId: 'upstream-provider',
      modelId: 'upstream-model',
      usage: { inputTokens: 20, outputTokens: 10 },
      output: {
        candidates: [{
          segmentId: 'segment-1',
          cardType: 'definition',
          learningObjective: 'Recall the source definition.',
          question: 'What is PCOS?',
          answer: 'An endocrine disorder.',
          evidenceText: 'PCOS is an endocrine disorder.',
        }],
      },
    };
  },
};

describe('generateGroundedCards', () => {
  it('uses provider-independent contract and emits content-free telemetry', async () => {
    const events: AITelemetryEvent[] = [];
    const result = await generateGroundedCards(provider, {
      requestId: 'request-1',
      sourceId: 'source-1',
      sourceTitle: 'Notes',
      maxCandidates: 2,
      segments: [{
        segmentId: 'segment-1',
        locator: 'Page 1',
        sectionPath: 'Definition',
        text: 'PCOS is an endocrine disorder.',
      }],
    }, { record: (event) => events.push(event) });

    expect(result.provenance).toEqual(expect.objectContaining({
      generationMode: 'REMOTE_AI',
      fallbackUsed: false,
      providerId: 'upstream-provider',
      modelId: 'upstream-model',
      promptId: 'grounded-card-generation',
      promptVersion: '1.2.0',
      providerRequestId: 'provider-request-1',
      remoteCandidateCount: 1,
    }));
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({ success: true, candidateCount: 1 }));
    expect(JSON.stringify(events[0])).not.toContain('PCOS');
    expect(JSON.stringify(events[0])).not.toContain('endocrine');
  });

  it('does not let telemetry failure block generation', async () => {
    await expect(generateGroundedCards(provider, {
      requestId: 'request-2',
      sourceId: 'source-1',
      sourceTitle: 'Notes',
      maxCandidates: 1,
      segments: [{
        segmentId: 'segment-1', locator: 'Page 1', sectionPath: '',
        text: 'PCOS is an endocrine disorder.',
      }],
    }, { record: () => { throw new Error('offline'); } })).resolves.toBeDefined();
  });

  it('falls back locally when provider output is malformed and records reason', async () => {
    const malformedProvider: CardGenerationProvider = {
      ...provider,
      async generate() {
        return {
          providerRequestId: 'malformed-request-1',
          providerId: 'upstream-provider',
          modelId: 'upstream-model',
          usage: { inputTokens: 11, outputTokens: 7 },
          output: { candidates: [{ evidenceText: 'invented' }] },
        };
      },
    };
    const localCandidates = [{
      segmentId: 'segment-1',
      locator: 'Page 1',
      cardType: 'definition',
      learningObjective: 'Recall the source definition.',
      question: 'What is PCOS?',
      answer: 'An endocrine disorder.',
      evidenceText: 'PCOS is an endocrine disorder.',
    }];

    const result = await generateGroundedCardsWithFallback(malformedProvider, {
      requestId: 'request-3',
      sourceId: 'source-1',
      sourceTitle: 'Notes',
      maxCandidates: 1,
      segments: [{
        segmentId: 'segment-1', locator: 'Page 1', sectionPath: '',
        text: 'PCOS is an endocrine disorder.',
      }],
    }, () => localCandidates);

    expect(result.candidates).toEqual([expect.objectContaining({
      ...localCandidates[0],
      evidenceSpan: expect.objectContaining({ status: 'exact', startOffset: 0, endOffset: 30 }),
    })]);
    expect(result.provenance).toEqual(expect.objectContaining({
      generationMode: 'LOCAL_FALLBACK',
      fallbackUsed: true,
      providerId: 'local-extractive',
      modelId: 'barion-extractive-rules',
      attemptedProviderId: 'upstream-provider',
      attemptedModelId: 'upstream-model',
      providerRequestId: 'malformed-request-1',
      promptVersion: 'extractive-v1',
      fallbackReason: 'invalid_provider_response',
      remoteCandidateCount: 1,
      usage: { inputTokens: 11, outputTokens: 7 },
    }));
  });

  it('uses local generation directly when gateway is not configured', async () => {
    const result = await generateGroundedCardsWithFallback(null, {
      requestId: 'request-4', sourceId: 'source-1', sourceTitle: 'Notes', maxCandidates: 1,
      segments: [{ segmentId: 'segment-1', locator: 'Page 1', sectionPath: '', text: 'Source text.' }],
    }, () => []);

    expect(result.provenance.providerId).toBe('local-extractive');
    expect(result.provenance.generationMode).toBe('LOCAL_FALLBACK');
    expect(result.provenance.fallbackUsed).toBe(true);
    expect(result.provenance.fallbackReason).toBe('gateway_not_configured');
  });
});
