import { asBarionAIError, BarionAIError } from '@/ai/errors';
import { buildGroundedCardRequest } from '@/ai/prompts';
import type {
  AITelemetryEvent,
  AITelemetrySink,
  CardGenerationInput,
  CardGenerationProvider,
  GroundedCardGenerationResult,
} from '@/ai/types';
import { parseGroundedCardResponse } from '@/ai/validation';

const LOCAL_PROVIDER_ID = 'local-extractive';
const LOCAL_MODEL_ID = 'barion-extractive-rules';
const LOCAL_PROMPT_ID = 'extractive-rules';
const LOCAL_PROMPT_VERSION = 'extractive-v1';

export async function generateGroundedCardsWithFallback(
  provider: CardGenerationProvider | null,
  input: CardGenerationInput,
  createLocalCandidates: () => GroundedCardGenerationResult['candidates'],
  telemetry?: AITelemetrySink,
  initialFallbackReason?: string,
): Promise<GroundedCardGenerationResult> {
  validateInput(input);
  if (provider) {
    try {
      return await generateGroundedCards(provider, input, telemetry);
    } catch (error) {
      return localResult(input.requestId, createLocalCandidates(), asBarionAIError(error).code);
    }
  }

  return localResult(input.requestId, createLocalCandidates(), initialFallbackReason);
}

export async function generateGroundedCards(
  provider: CardGenerationProvider,
  input: CardGenerationInput,
  telemetry?: AITelemetrySink,
): Promise<GroundedCardGenerationResult> {
  validateInput(input);
  const request = buildGroundedCardRequest(input);
  const startedAt = Date.now();

  try {
    const response = await provider.generate(request);
    const candidates = parseGroundedCardResponse(response.output, input.segments, input.maxCandidates);
    recordSafely(telemetry, {
      requestId: input.requestId,
      operation: 'card-generation',
      providerId: provider.id,
      modelId: provider.model,
      promptVersion: request.promptVersion,
      durationMs: Date.now() - startedAt,
      success: true,
      candidateCount: candidates.length,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
    });

    return {
      candidates,
      provenance: {
        requestId: input.requestId,
        providerRequestId: response.providerRequestId,
        providerId: response.providerId ?? provider.id,
        modelId: response.modelId ?? provider.model,
        promptId: request.promptId,
        promptVersion: request.promptVersion,
        generatedAt: new Date().toISOString(),
        usage: response.usage,
      },
    };
  } catch (error) {
    const aiError = asBarionAIError(error);
    recordSafely(telemetry, {
      requestId: input.requestId,
      operation: 'card-generation',
      providerId: provider.id,
      modelId: provider.model,
      promptVersion: request.promptVersion,
      durationMs: Date.now() - startedAt,
      success: false,
      errorCode: aiError.code,
    });
    throw aiError;
  }
}

function localResult(
  requestId: string,
  candidates: GroundedCardGenerationResult['candidates'],
  fallbackReason?: string,
): GroundedCardGenerationResult {
  return {
    candidates,
    provenance: {
      requestId,
      providerId: LOCAL_PROVIDER_ID,
      modelId: LOCAL_MODEL_ID,
      promptId: LOCAL_PROMPT_ID,
      promptVersion: LOCAL_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      fallbackReason,
    },
  };
}

function validateInput(input: CardGenerationInput) {
  if (!input.requestId.trim() || !input.sourceId.trim() || !input.sourceTitle.trim()) {
    throw new BarionAIError('configuration_error', 'Card generation identifiers and source title are required.');
  }
  if (!Number.isInteger(input.maxCandidates) || input.maxCandidates < 1 || input.maxCandidates > 100) {
    throw new BarionAIError(
      'configuration_error',
      'Card generation maxCandidates must be an integer between 1 and 100.',
    );
  }
  if (!input.segments.length) {
    throw new BarionAIError('insufficient_evidence', 'Card generation requires at least one source segment.');
  }
}

function recordSafely(sink: AITelemetrySink | undefined, event: AITelemetryEvent) {
  try {
    sink?.record(event);
  } catch {
    // Telemetry must never block generation or expose source content through fallback logging.
  }
}