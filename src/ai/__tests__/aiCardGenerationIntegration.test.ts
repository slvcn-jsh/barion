/**
 * Integration test for AI Card Generation pipeline with Supabase Auth:
 *   - Session restore -> Gateway token provider
 *   - Gateway request -> 401 unauthorized -> Auth refresh -> Successful retry
 *   - Gateway failure / Auth failure -> Seamless local fallback with provenance
 */

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

const mockSession = {
  access_token: 'initial-jwt-token',
  refresh_token: 'valid-refresh-token',
  user: { id: 'user-42', email: 'medstudent@example.com' },
};

const mockRefreshedSession = {
  access_token: 'refreshed-jwt-token',
  refresh_token: 'next-refresh-token',
  user: { id: 'user-42', email: 'medstudent@example.com' },
};

const mockGetSession = jest.fn();
const mockRefreshSession = jest.fn();

const mockSupabaseClient = {
  auth: {
    getSession: mockGetSession,
    getUser: jest.fn(() => Promise.resolve({ data: { user: mockSession.user } })),
    signInWithPassword: jest.fn(),
    signUp: jest.fn(),
    resetPasswordForEmail: jest.fn(),
    signOut: jest.fn(),
    refreshSession: mockRefreshSession,
    onAuthStateChange: jest.fn(() => ({
      data: { subscription: { unsubscribe: jest.fn() } },
    })),
  },
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabaseClient,
}));

jest.mock('@/auth/supabaseClient', () => ({
  getSupabaseClient: () => mockSupabaseClient,
}));

import { createGatewayCardGenerationProvider } from '@/ai/gatewayProvider';
import { generateGroundedCardsWithFallback } from '@/ai/generate';
import type { CardGenerationInput, GroundedCardCandidate } from '@/ai/types';
import { createSupabaseAccessTokenProvider, restoreSession } from '@/auth/sessionProvider';

describe('AI Card Generation & Auth Integration', () => {
  const gatewayConfig = {
    gatewayUrl: 'https://ai-gateway.example.internal',
    model: 'medical-cards-v1',
    timeoutMs: 15_000,
  };

  const sampleSegment = {
    segmentId: 'seg-101',
    locator: 'Page 12',
    sectionPath: 'Cardiology > Arrhythmias',
    text: 'Amiodarone is a class III antiarrhythmic drug used for ventricular tachycardia. Common side effects include pulmonary fibrosis, thyroid dysfunction, and corneal microdeposits.',
  };

  const sampleInput: CardGenerationInput = {
    requestId: 'req-int-1',
    sourceId: 'source-pharmacology',
    sourceTitle: 'Clinical Pharmacology Notes',
    maxCandidates: 5,
    segments: [sampleSegment],
  };

  const localFallbackCandidate: GroundedCardCandidate = {
    segmentId: 'seg-101',
    locator: 'Page 12',
    cardType: 'basic',
    learningObjective: 'Recall common side effects of Amiodarone.',
    question: 'What are common side effects of Amiodarone?',
    answer: 'Pulmonary fibrosis, thyroid dysfunction, and corneal microdeposits.',
    evidenceText: 'Common side effects include pulmonary fibrosis, thyroid dysfunction, and corneal microdeposits.',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('restores session and performs gateway generation with authenticated Bearer token', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: mockSession } });

    const tokenProvider = createSupabaseAccessTokenProvider();

    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        requestId: 'gw-resp-1',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        output: {
          candidates: [
            {
              segmentId: 'seg-101',
              cardType: 'basic',
              learningObjective: 'Recall class of Amiodarone.',
              question: 'What class of antiarrhythmic is Amiodarone?',
              answer: 'Class III antiarrhythmic drug used for ventricular tachycardia.',
              evidenceText: 'Amiodarone is a class III antiarrhythmic drug used for ventricular tachycardia.',
            },
          ],
        },
        usage: { inputTokens: 50, outputTokens: 30 },
      }),
    }) as unknown as typeof fetch;

    const provider = createGatewayCardGenerationProvider(gatewayConfig, mockFetch, tokenProvider);

    const result = await generateGroundedCardsWithFallback(
      provider,
      sampleInput,
      () => [localFallbackCandidate],
    );

    expect(result.provenance.providerId).toBe('gemini');
    expect(result.provenance.modelId).toBe('gemini-2.5-flash');
    expect(result.provenance.fallbackReason).toBeUndefined();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].question).toBe('What class of antiarrhythmic is Amiodarone?');
    expect((mockFetch as jest.Mock).mock.calls[0][1].headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer initial-jwt-token',
      }),
    );
  });

  it('handles 401 by refreshing Supabase session and retrying gateway request successfully', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: mockSession } });
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: mockRefreshedSession },
      error: null,
    });

    const tokenProvider = createSupabaseAccessTokenProvider();

    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          requestId: 'gw-resp-retry-ok',
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          output: {
            candidates: [
              {
                segmentId: 'seg-101',
                cardType: 'basic',
                learningObjective: 'Recall adverse effects of Amiodarone.',
                question: 'Name three adverse effects of Amiodarone.',
                answer: 'Pulmonary fibrosis, thyroid dysfunction, and corneal microdeposits.',
                evidenceText:
                  'Common side effects include pulmonary fibrosis, thyroid dysfunction, and corneal microdeposits.',
              },
            ],
          },
          usage: { inputTokens: 55, outputTokens: 35 },
        }),
      }) as unknown as typeof fetch;

    const provider = createGatewayCardGenerationProvider(gatewayConfig, mockFetch, tokenProvider);

    const result = await generateGroundedCardsWithFallback(
      provider,
      sampleInput,
      () => [localFallbackCandidate],
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect((mockFetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe(
      'Bearer initial-jwt-token',
    );
    expect((mockFetch as jest.Mock).mock.calls[1][1].headers.Authorization).toBe(
      'Bearer refreshed-jwt-token',
    );
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);

    expect(result.provenance.providerId).toBe('gemini');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].question).toBe('Name three adverse effects of Amiodarone.');
  });

  it('gracefully falls back to local candidates when auth refresh fails', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: mockSession } });
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Refresh token expired' },
    });

    const tokenProvider = createSupabaseAccessTokenProvider();

    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as unknown as typeof fetch;

    const provider = createGatewayCardGenerationProvider(gatewayConfig, mockFetch, tokenProvider);

    const result = await generateGroundedCardsWithFallback(
      provider,
      sampleInput,
      () => [localFallbackCandidate],
    );

    expect(result.provenance.providerId).toBe('local-extractive');
    expect(result.provenance.fallbackReason).toBe('authentication_error');
    expect(result.candidates).toEqual([expect.objectContaining({
      ...localFallbackCandidate,
      evidenceSpan: expect.objectContaining({ status: 'exact' }),
    })]);
  });

  it('falls back to local candidates when gateway is down or unavailable (503)', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: mockSession } });
    const tokenProvider = createSupabaseAccessTokenProvider();

    const mockFetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
    }) as unknown as typeof fetch;

    const provider = createGatewayCardGenerationProvider(gatewayConfig, mockFetch, tokenProvider);

    const result = await generateGroundedCardsWithFallback(
      provider,
      sampleInput,
      () => [localFallbackCandidate],
    );

    expect(result.provenance.providerId).toBe('local-extractive');
    expect(result.provenance.fallbackReason).toBe('model_unavailable');
    expect(result.candidates).toEqual([expect.objectContaining({
      ...localFallbackCandidate,
      evidenceSpan: expect.objectContaining({ status: 'exact' }),
    })]);
  });
});
