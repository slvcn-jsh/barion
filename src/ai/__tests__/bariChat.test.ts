import {
  buildBariCardEvidence,
  buildBariDeckEvidence,
  generateLocalBariFallback,
  sendBariChatMessage,
} from '@/ai/bariChat';
import type { PublicGatewayConfig } from '@/ai/config';
import type { StudyCard } from '@/domain/types';

describe('Bari Chat Client', () => {
  const baseConfig: PublicGatewayConfig = {
    gatewayUrl: 'http://gateway.test',
    model: 'gemini-2.5-flash',
    timeoutMs: 1000,
    accessToken: 'test-token',
  };

  const sampleCard: StudyCard = {
    id: 'card-1',
    deckId: 'deck-1',
    deckTitle: 'Cardiology 101',
    prompt: 'What is the first-line treatment for acute heart failure with pulmonary edema?',
    answer: 'Answer: IV Furosemide\nWhy it matters: Rapidly decreases preload\nStudy note: Loop diuretic',
    cardType: 'treatment-reasoning',
    status: 'verified',
    isStarred: false,
    dueAt: '2026-09-24',
    fsrsCardJson: '{}',
  };

  it('successfully queries gateway endpoint with structured response', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        message: 'Furosemide is indicated for acute pulmonary edema (Slide 4).',
        citations: [{ segmentId: 'seg-1', locator: 'Slide 4', sectionPath: 'Cardiology' }],
        evidence: [{ segmentId: 'seg-1', locator: 'Slide 4', sectionPath: 'Cardiology', text: 'IV Furosemide...' }],
        generation: { provider: 'gemini', model: 'gemini-2.5-flash', requestId: 'req-123' },
      }),
    });

    const res = await sendBariChatMessage(
      {
        message: 'Why furosemide?',
        evidence: [{ segmentId: 'seg-1', locator: 'Slide 4', sectionPath: 'Cardiology', text: 'IV Furosemide' }],
      },
      { config: baseConfig, fetchImplementation: mockFetch },
    );

    expect(mockFetch).toHaveBeenCalledWith(
      'http://gateway.test/v1/bari/chat',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(res.message).toContain('Furosemide is indicated');
    expect(res.citations).toHaveLength(1);
    expect(res.generation.requestId).toBe('req-123');
  });

  it('retries once on 401 with refreshed access token', async () => {
    const tokenProvider = jest
      .fn()
      .mockResolvedValueOnce('old-token')
      .mockResolvedValueOnce('refreshed-token');

    let callCount = 0;
    const mockFetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ ok: false, status: 401, json: async () => ({}) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          message: 'Authorized response',
          citations: [],
          evidence: [],
          generation: { requestId: 'req-auth' },
        }),
      });
    });

    const configWithoutFixedToken: PublicGatewayConfig = {
      ...baseConfig,
      accessToken: undefined,
    };

    const res = await sendBariChatMessage(
      { message: 'Explain this' },
      {
        config: configWithoutFixedToken,
        fetchImplementation: mockFetch,
        accessTokenProvider: tokenProvider,
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(tokenProvider).toHaveBeenCalledWith(true);
    expect(res.message).toBe('Authorized response');
  });

  it('falls back to local evidence matching when gateway is unreachable', async () => {
    const mockFetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const res = await sendBariChatMessage(
      {
        message: 'What about furosemide?',
        evidence: [
          { segmentId: 'seg-1', locator: 'Lecture 1, Slide 5', sectionPath: 'Pharm', text: 'Furosemide is a loop diuretic that inhibits NKCC2 in the thick ascending limb.' },
        ],
      },
      { config: baseConfig, fetchImplementation: mockFetch, allowFallback: true },
    );

    expect(res.message).toContain('Furosemide is a loop diuretic');
    expect(res.citations[0]?.locator).toBe('Lecture 1, Slide 5');
    expect(res.generation.provider).toBe('local-fallback');
  });

  it('generates clear fallback message when no evidence is available', () => {
    const fallback = generateLocalBariFallback({ message: 'Explain kidneys' });
    expect(fallback.message).toContain('offline mode');
    expect(fallback.citations).toEqual([]);
    expect(fallback.warnings).toContain('offline_fallback_no_evidence');
  });

  it('builds card evidence from snippet or card prompt/answer', () => {
    const snippetEvidence = buildBariCardEvidence(sampleCard, {
      sourceTitle: 'Pharm Guide',
      locator: 'p. 14',
      text: 'Loop diuretics promote diuresis.',
      supportScore: 1,
      verificationStatus: 'exact-source',
    });
    expect(snippetEvidence[0].locator).toBe('p. 14');
    expect(snippetEvidence[0].text).toBe('Loop diuretics promote diuresis.');

    const plainEvidence = buildBariCardEvidence(sampleCard);
    expect(plainEvidence[0].text).toContain('Question: What is the first-line treatment');
  });

  it('builds deck evidence up to limit', () => {
    const segments = [
      { id: 's1', sourceId: 'src-1', locator: 'p. 1', sectionPath: 'Intro', text: 'Text 1', createdAt: '2026-01-01' },
      { id: 's2', sourceId: 'src-1', locator: 'p. 2', sectionPath: 'Detail', text: 'Text 2', createdAt: '2026-01-01' },
    ];
    const deckEvidence = buildBariDeckEvidence(segments, 1);
    expect(deckEvidence).toHaveLength(1);
    expect(deckEvidence[0].segmentId).toBe('s1');
  });

  it('selects best matching segment based on query keywords in offline fallback', () => {
    const evidence = [
      { segmentId: 'seg-1', locator: 'Page 1', sectionPath: 'Beta Blockers', text: 'Metoprolol is a selective beta-1 blocker used in heart failure.' },
      { segmentId: 'seg-2', locator: 'Page 2', sectionPath: 'ACE Inhibitors', text: 'Lisinopril is an ACE inhibitor used in hypertension and heart failure.' },
      { segmentId: 'seg-3', locator: 'Page 3', sectionPath: 'Diuretics', text: 'Spironolactone is an aldosterone antagonist used in heart failure.' },
    ];

    const fallback = generateLocalBariFallback({
      message: 'What is lisinopril and how does it work?',
      evidence,
    });

    expect(fallback.citations[0].locator).toBe('Page 2');
    expect(fallback.message).toContain('Lisinopril is an ACE inhibitor');
  });

  it('handles empty query string and punctuation in offline fallback without crash', () => {
    const evidence = [
      { segmentId: 'seg-1', locator: 'Page 1', sectionPath: 'General', text: 'Aspirin inhibits COX-1 irreversibly.' },
    ];

    const fallback = generateLocalBariFallback({
      message: '??? !!!',
      evidence,
    });

    expect(fallback.citations).toHaveLength(1);
    expect(fallback.citations[0].locator).toBe('Page 1');
    expect(fallback.warnings).toContain('offline_fallback_low_match');
  });
});
