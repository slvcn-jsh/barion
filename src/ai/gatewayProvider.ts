import type { PublicGatewayConfig } from '@/ai/config';
import { BarionAIError } from '@/ai/errors';
import type {
  CardGenerationProvider,
  ProviderGenerationRequest,
  ProviderGenerationResult,
} from '@/ai/types';

export type GatewayAccessTokenProvider = (forceRefresh?: boolean) => Promise<string | null>;

export function createGatewayCardGenerationProvider(
  config: PublicGatewayConfig,
  fetchImplementation: typeof fetch = fetch,
  accessTokenProvider?: GatewayAccessTokenProvider,
): CardGenerationProvider {
  return {
    id: 'barion-gateway',
    model: config.model,
    async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);
      try {
        const body = JSON.stringify({ ...request, model: config.model });
        const configuredToken = config.accessToken?.trim() || null;
        const tokenFromProvider = !configuredToken && accessTokenProvider ? await accessTokenProvider(false) : null;
        let accessToken = configuredToken ?? tokenFromProvider;
        let response = await sendGatewayRequest(
          config.gatewayUrl,
          body,
          accessToken,
          abortController.signal,
          fetchImplementation,
        );
        if (response.status === 401 && accessTokenProvider && !configuredToken) {
          const refreshed = await accessTokenProvider(true);
          accessToken = refreshed;
          response = await sendGatewayRequest(
            config.gatewayUrl,
            body,
            accessToken,
            abortController.signal,
            fetchImplementation,
          );
        }
        if (!response.ok) throw await httpError(response, config.model);

        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw invalidResponse(config.model);
        }
        if (!isRecord(payload) || !('output' in payload)) {
          throw invalidResponse(config.model);
        }

        return {
          output: payload.output,
          providerRequestId: typeof payload.requestId === 'string' ? payload.requestId : undefined,
          providerId: typeof payload.provider === 'string' ? payload.provider : undefined,
          modelId: typeof payload.model === 'string' ? payload.model : undefined,
          usage: parseUsage(payload.usage),
        };
      } catch (error) {
        if (error instanceof BarionAIError) throw error;
        if (abortController.signal.aborted) {
          throw new BarionAIError('timeout_error', 'AI gateway request timed out.', {
            recoverable: true,
            providerId: 'barion-gateway',
            modelId: config.model,
          });
        }
        throw new BarionAIError('network_error', 'Unable to reach AI gateway.', {
          recoverable: true,
          providerId: 'barion-gateway',
          modelId: config.model,
        });
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function sendGatewayRequest(
  gatewayUrl: string,
  body: string,
  accessToken: string | null | undefined,
  signal: AbortSignal,
  fetchImplementation: typeof fetch,
) {
  return fetchImplementation(`${gatewayUrl}/v1/card-generation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body,
    signal,
  });
}

function invalidResponse(modelId: string) {
  return new BarionAIError(
    'invalid_provider_response',
    'AI gateway returned an invalid response envelope.',
    { providerId: 'barion-gateway', modelId },
  );
}

async function httpError(response: Response, modelId: string) {
  const status = response.status;
  const gatewayError = await readGatewayError(response);
  const gatewayCode = gatewayError?.code;
  const options = {
    recoverable: gatewayError?.recoverable ?? status >= 500,
    providerId: gatewayError?.provider ?? 'barion-gateway',
    modelId: gatewayError?.model ?? modelId,
    httpStatus: status,
    providerRequestId: gatewayError?.providerRequestId,
    inputTokens: gatewayError?.inputTokens,
    outputTokens: gatewayError?.outputTokens,
    remoteCandidateCount: gatewayError?.remoteCandidateCount,
  };
  if (gatewayCode === 'provider_unavailable') {
    return new BarionAIError('provider_unavailable', 'AI provider is temporarily unavailable.', {
      ...options, recoverable: true,
    });
  }
  if (gatewayCode === 'provider_timeout') {
    return new BarionAIError('timeout_error', 'AI generation timed out.', {
      ...options, recoverable: true,
    });
  }
  if (gatewayCode === 'provider_rate_limited' || gatewayCode === 'rate_limited') {
    return new BarionAIError('rate_limited', 'AI provider is busy. Try again later.', {
      ...options, recoverable: true,
    });
  }
  if (gatewayCode === 'invalid_provider_response') {
    return new BarionAIError('invalid_provider_response', 'AI provider returned unusable output.', options);
  }
  if (gatewayCode === 'insufficient_candidates') {
    return new BarionAIError('insufficient_evidence', 'AI output did not contain enough supported cards.', options);
  }
  if (gatewayCode === 'provider_authentication_error' || gatewayCode === 'authentication_error') {
    return new BarionAIError('authentication_error', 'AI authentication failed.', {
      ...options, recoverable: false,
    });
  }
  if (gatewayCode === 'model_not_allowed' || gatewayCode === 'invalid_request' || gatewayCode === 'configuration_error') {
    return new BarionAIError('configuration_error', 'AI gateway configuration rejected the request.', {
      ...options, recoverable: false,
    });
  }
  if (gatewayCode === 'request_too_large') {
    return new BarionAIError('request_too_large', 'AI gateway request is too large.', options);
  }
  if (status === 401 || status === 403) {
    return new BarionAIError('authentication_error', 'AI gateway rejected the request.', {
      ...options, recoverable: false,
    });
  }
  if (status === 413) {
    return new BarionAIError('request_too_large', 'AI gateway request is too large.', {
      ...options, recoverable: false,
    });
  }
  if (status === 429) {
    return new BarionAIError('rate_limited', 'AI gateway is busy. Try again later.', {
      ...options, recoverable: true,
    });
  }
  if (status === 504) {
    return new BarionAIError('timeout_error', 'AI generation timed out.', {
      ...options, recoverable: true,
    });
  }
  return new BarionAIError('model_unavailable', 'AI generation is temporarily unavailable.', {
    ...options,
  });
}

async function readGatewayError(response: Response) {
  try {
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
    const error = payload.error;
    return {
      code: typeof error.code === 'string' ? error.code : undefined,
      recoverable: typeof error.recoverable === 'boolean' ? error.recoverable : undefined,
      provider: typeof error.provider === 'string' ? error.provider : undefined,
      model: typeof error.model === 'string' ? error.model : undefined,
      providerRequestId: typeof error.providerRequestId === 'string' ? error.providerRequestId : undefined,
      inputTokens: nonNegativeInteger(error.inputTokens),
      outputTokens: nonNegativeInteger(error.outputTokens),
      remoteCandidateCount: nonNegativeInteger(error.remoteCandidateCount),
    };
  } catch {
    return undefined;
  }
}

function parseUsage(value: unknown) {
  if (!isRecord(value)) return undefined;
  const inputTokens = nonNegativeInteger(value.inputTokens);
  const outputTokens = nonNegativeInteger(value.outputTokens);
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return { inputTokens, outputTokens };
}

function nonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
