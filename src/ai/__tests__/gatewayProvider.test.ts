import { createGatewayCardGenerationProvider } from '@/ai/gatewayProvider';
import { BarionAIError } from '@/ai/errors';

const config = {
  gatewayUrl: 'https://ai.barion.example',
  model: 'medical-cards-v1',
  timeoutMs: 30_000,
};

const request = {
  requestId: 'request-1',
  promptId: 'grounded-card-generation',
  promptVersion: '1.0.0',
  systemPrompt: 'system',
  userPrompt: 'user',
  maxCandidates: 5,
};

describe('createGatewayCardGenerationProvider', () => {
  it('sends provider-independent request and parses request ID and usage', async () => {
    const fetchImplementation = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        requestId: 'provider-request-1',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        output: { candidates: [] },
        usage: { inputTokens: 12, outputTokens: 7, ignored: 1 },
      }),
    })) as unknown as typeof fetch;

    const result = await createGatewayCardGenerationProvider(config, fetchImplementation).generate(request);

    expect(fetchImplementation).toHaveBeenCalledWith(
      'https://ai.barion.example/v1/card-generation',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    );
    const body = JSON.parse((fetchImplementation as jest.Mock).mock.calls[0][1].body);
    expect(body).toEqual(expect.objectContaining({
      ...request,
      model: 'medical-cards-v1',
    }));
    expect(result).toEqual({
      output: { candidates: [] },
      providerRequestId: 'provider-request-1',
      providerId: 'gemini',
      modelId: 'gemini-2.5-flash',
      usage: { inputTokens: 12, outputTokens: 7 },
    });
  });

  it('sends configured gateway authorization without exposing a provider key', async () => {
    const fetchImplementation = jest.fn(async () => ({
      ok: true,
      json: async () => ({ output: { candidates: [] } }),
    })) as unknown as typeof fetch;

    await createGatewayCardGenerationProvider(
      { ...config, accessToken: 'short-lived-user-token' },
      fetchImplementation,
    ).generate(request);

    expect((fetchImplementation as jest.Mock).mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer short-lived-user-token',
    });
    expect((fetchImplementation as jest.Mock).mock.calls[0][1].body).not.toContain('short-lived-user-token');
  });

  it.each([
    [401, 'authentication_error'],
    [429, 'rate_limited'],
    [503, 'model_unavailable'],
  ])('maps HTTP %s to %s', async (status, code) => {
    const fetchImplementation = jest.fn(async () => ({ ok: false, status })) as unknown as typeof fetch;
    const promise = createGatewayCardGenerationProvider(config, fetchImplementation).generate(request);
    await expect(promise).rejects.toEqual(expect.objectContaining({ code, httpStatus: status }));
  });

  it('maps invalid JSON to invalid provider response', async () => {
    const fetchImplementation = jest.fn(async () => ({
      ok: true,
      json: async () => { throw new SyntaxError('bad JSON'); },
    })) as unknown as typeof fetch;

    await expect(createGatewayCardGenerationProvider(config, fetchImplementation).generate(request))
      .rejects.toEqual(expect.objectContaining({ code: 'invalid_provider_response' }));
  });

  it('aborts timed-out requests and returns recoverable network error', async () => {
    jest.useFakeTimers();
    try {
      const fetchImplementation = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
      const promise = createGatewayCardGenerationProvider({ ...config, timeoutMs: 1_000 }, fetchImplementation)
        .generate(request);
      jest.advanceTimersByTime(1_000);

      await expect(promise).rejects.toEqual(expect.objectContaining({
        code: 'network_error',
        recoverable: true,
      } satisfies Partial<BarionAIError>));
    } finally {
      jest.useRealTimers();
    }
  });
});
