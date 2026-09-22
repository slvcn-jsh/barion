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
  minCandidates: 4,
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
  it('falls back to config.accessToken when accessTokenProvider returns null', async () => {
    const fetchImplementation = jest.fn(async () => ({
      ok: true,
      json: async () => ({ output: { candidates: [] } }),
    })) as unknown as typeof fetch;
    const accessTokenProvider = jest.fn().mockResolvedValue(null);

    await createGatewayCardGenerationProvider(
      { ...config, accessToken: 'fallback-static-token' },
      fetchImplementation,
      accessTokenProvider,
    ).generate(request);

    expect((fetchImplementation as jest.Mock).mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer fallback-static-token',
    });
  });

  it('prefers configured static token over signed-in session token', async () => {
    const fetchImplementation = jest.fn(async () => ({
      ok: true,
      json: async () => ({ output: { candidates: [] } }),
    })) as unknown as typeof fetch;
    const accessTokenProvider = jest.fn().mockResolvedValue('signed-in-session-token');

    await createGatewayCardGenerationProvider(
      { ...config, accessToken: 'configured-static-token' },
      fetchImplementation,
      accessTokenProvider,
    ).generate(request);

    expect(accessTokenProvider).not.toHaveBeenCalled();
    expect((fetchImplementation as jest.Mock).mock.calls[0][1].headers.Authorization)
      .toBe('Bearer configured-static-token');
  });


  it('refreshes session once after 401 and retries with the new access token', async () => {
    const fetchImplementation = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ output: { candidates: [] } }) }) as unknown as typeof fetch;
    const accessTokenProvider = jest
      .fn()
      .mockResolvedValueOnce('expired-access-token')
      .mockResolvedValueOnce('refreshed-access-token');

    await createGatewayCardGenerationProvider(config, fetchImplementation, accessTokenProvider).generate(request);

    expect(accessTokenProvider).toHaveBeenNthCalledWith(1, false);
    expect(accessTokenProvider).toHaveBeenNthCalledWith(2, true);
    expect((fetchImplementation as jest.Mock).mock.calls[0][1].headers.Authorization)
      .toBe('Bearer expired-access-token');
    expect((fetchImplementation as jest.Mock).mock.calls[1][1].headers.Authorization)
      .toBe('Bearer refreshed-access-token');
  });

  it('does not loop when refreshed access token is rejected', async () => {
    const fetchImplementation = jest.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch;
    const accessTokenProvider = jest
      .fn()
      .mockResolvedValueOnce('expired-access-token')
      .mockResolvedValueOnce('rejected-access-token');

    await expect(createGatewayCardGenerationProvider(config, fetchImplementation, accessTokenProvider).generate(request))
      .rejects.toEqual(expect.objectContaining({ code: 'authentication_error', httpStatus: 401 }));
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(accessTokenProvider).toHaveBeenCalledTimes(2);
  });

  it.each([
    [401, 'authentication_error'],
    [413, 'request_too_large'],
    [429, 'rate_limited'],
    [503, 'model_unavailable'],
    [504, 'timeout_error'],
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

  it('aborts timed-out requests and returns recoverable timeout error', async () => {
    jest.useFakeTimers();
    try {
      const fetchImplementation = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;
      const promise = createGatewayCardGenerationProvider({ ...config, timeoutMs: 1_000 }, fetchImplementation)
        .generate(request);
      jest.advanceTimersByTime(1_000);

      await expect(promise).rejects.toEqual(expect.objectContaining({
        code: 'timeout_error',
        recoverable: true,
      } satisfies Partial<BarionAIError>));
    } finally {
      jest.useRealTimers();
    }
  });
});
