import type { PublicGatewayConfig } from '@/ai/config';
import { BarionAIError } from '@/ai/errors';
import type {
  CardGenerationProvider,
  ProviderGenerationRequest,
  ProviderGenerationResult,
} from '@/ai/types';

export function createGatewayCardGenerationProvider(
  config: PublicGatewayConfig,
  fetchImplementation: typeof fetch = fetch,
): CardGenerationProvider {
  return {
    id: 'barion-gateway',
    model: config.model,
    async generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult> {
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);
      try {
        const response = await fetchImplementation(`${config.gatewayUrl}/v1/card-generation`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
          },
          body: JSON.stringify({ ...request, model: config.model }),
          signal: abortController.signal,
        });
        if (!response.ok) throw httpError(response.status, config.model);

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

function invalidResponse(modelId: string) {
  return new BarionAIError(
    'invalid_provider_response',
    'AI gateway returned an invalid response envelope.',
    { providerId: 'barion-gateway', modelId },
  );
}

function httpError(status: number, modelId: string) {
  if (status === 401 || status === 403) {
    return new BarionAIError('authentication_error', 'AI gateway rejected the request.', {
      providerId: 'barion-gateway', modelId, httpStatus: status,
    });
  }
  if (status === 413) {
    return new BarionAIError('request_too_large', 'AI gateway request is too large.', {
      providerId: 'barion-gateway', modelId, httpStatus: status,
    });
  }
  if (status === 429) {
    return new BarionAIError('rate_limited', 'AI gateway is busy. Try again later.', {
      recoverable: true, providerId: 'barion-gateway', modelId, httpStatus: status,
    });
  }
  if (status === 504) {
    return new BarionAIError('timeout_error', 'AI generation timed out.', {
      recoverable: true, providerId: 'barion-gateway', modelId, httpStatus: status,
    });
  }
  return new BarionAIError('model_unavailable', 'AI generation is temporarily unavailable.', {
    recoverable: status >= 500, providerId: 'barion-gateway', modelId, httpStatus: status,
  });
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