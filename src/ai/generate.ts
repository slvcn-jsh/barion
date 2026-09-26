import { localExtractiveEvaluation } from '@/ai/evaluation';
import { asBarionAIError, BarionAIError } from '@/ai/errors';
import { buildGroundedCardRequest } from '@/ai/prompts';
import { resolveSourceSpan } from '@/ai/sourceSpan';
import type {
  AITelemetryEvent,
  AITelemetrySink,
  CardGenerationInput,
  CardGenerationProvider,
  GroundedCardGenerationResult,
} from '@/ai/types';
import { parseGroundedCardResponse } from '@/ai/validation';

export const LOCAL_PROVIDER_ID = 'local-extractive';
export const LOCAL_MODEL_ID = 'barion-extractive-rules';
export const LOCAL_PROMPT_ID = 'extractive-rules';
export const LOCAL_PROMPT_VERSION = 'extractive-v1';

export async function generateGroundedCardsWithFallback(
  provider: CardGenerationProvider | null,
  input: CardGenerationInput,
  createLocalCandidates: () => GroundedCardGenerationResult['candidates'],
  telemetry?: AITelemetrySink,
  initialFallbackReason?: string,
): Promise<GroundedCardGenerationResult> {
  validateInput(input);
  const startedAt = Date.now();
  if (provider) {
    try {
      return await generateGroundedCards(provider, input, telemetry);
    } catch (error) {
      const failure = asBarionAIError(error);
      const result = localResult(
        input.requestId,
        await resolveLocalCandidates(createLocalCandidates(), input),
        Date.now() - startedAt,
        {
          reason: failure.code,
          attemptedProviderId: failure.providerId ?? provider.id,
          attemptedModelId: failure.modelId ?? provider.model,
          providerRequestId: failure.providerRequestId,
          remoteCandidateCount: failure.remoteCandidateCount,
          inputTokens: failure.inputTokens,
          outputTokens: failure.outputTokens,
        },
      );
      recordSafely(telemetry, fallbackTelemetry(result));
      return result;
    }
  }

  const result = localResult(
    input.requestId,
    await resolveLocalCandidates(createLocalCandidates(), input),
    Date.now() - startedAt,
    { reason: initialFallbackReason ?? 'gateway_not_configured' },
  );
  recordSafely(telemetry, fallbackTelemetry(result));
  return result;
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
    let candidates: GroundedCardGenerationResult['candidates'];
    try {
      candidates = await parseGroundedCardResponse(response.output, input.segments, input.maxCandidates);
    } catch (error) {
      const failure = asBarionAIError(error);
      throw new BarionAIError(failure.code, failure.message, {
        recoverable: failure.recoverable,
        providerId: response.providerId ?? provider.id,
        modelId: response.modelId ?? provider.model,
        httpStatus: failure.httpStatus,
        providerRequestId: response.providerRequestId,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
        remoteCandidateCount: countRemoteCandidates(response.output),
      });
    }
    recordSafely(telemetry, {
      requestId: input.requestId,
      operation: 'card-generation',
      providerId: provider.id,
      modelId: provider.model,
      promptVersion: request.promptVersion,
      durationMs: Date.now() - startedAt,
      success: true,
      generationMode: 'REMOTE_AI',
      fallbackUsed: false,
      candidateCount: candidates.length,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
    });

    return {
      candidates,
      provenance: {
        requestId: input.requestId,
        generationMode: 'REMOTE_AI',
        fallbackUsed: false,
        providerRequestId: response.providerRequestId,
        providerId: response.providerId ?? provider.id,
        modelId: response.modelId ?? provider.model,
        attemptedProviderId: provider.id,
        attemptedModelId: provider.model,
        promptId: request.promptId,
        promptVersion: request.promptVersion,
        generatedAt: new Date().toISOString(),
        remoteCandidateCount: candidates.length,
        durationMs: Date.now() - startedAt,
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
  durationMs: number,
  attempt: {
    reason?: string;
    attemptedProviderId?: string;
    attemptedModelId?: string;
    providerRequestId?: string;
    remoteCandidateCount?: number;
    inputTokens?: number;
    outputTokens?: number;
  } = {},
): GroundedCardGenerationResult {
  return {
    candidates,
    provenance: {
      requestId,
      generationMode: 'LOCAL_FALLBACK',
      fallbackUsed: true,
      providerRequestId: attempt.providerRequestId,
      providerId: LOCAL_PROVIDER_ID,
      modelId: LOCAL_MODEL_ID,
      attemptedProviderId: attempt.attemptedProviderId,
      attemptedModelId: attempt.attemptedModelId,
      promptId: LOCAL_PROMPT_ID,
      promptVersion: LOCAL_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      remoteCandidateCount: attempt.remoteCandidateCount ?? 0,
      durationMs,
      usage: attempt.inputTokens !== undefined || attempt.outputTokens !== undefined
        ? { inputTokens: attempt.inputTokens, outputTokens: attempt.outputTokens }
        : undefined,
      fallbackReason: attempt.reason,
    },
  };
}

function countRemoteCandidates(output: unknown) {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return 0;
  const candidates = (output as Record<string, unknown>).candidates;
  return Array.isArray(candidates) ? candidates.length : 0;
}

function fallbackTelemetry(result: GroundedCardGenerationResult): AITelemetryEvent {
  return {
    requestId: result.provenance.requestId,
    operation: 'card-generation',
    providerId: result.provenance.providerId,
    modelId: result.provenance.modelId,
    promptVersion: result.provenance.promptVersion,
    durationMs: result.provenance.durationMs,
    success: true,
    generationMode: result.provenance.generationMode,
    fallbackUsed: true,
    candidateCount: result.candidates.length,
    inputTokens: result.provenance.usage?.inputTokens,
    outputTokens: result.provenance.usage?.outputTokens,
    errorCode: result.provenance.fallbackReason,
  };
}

async function resolveLocalCandidates(
  candidates: GroundedCardGenerationResult['candidates'],
  input: CardGenerationInput,
) {
  const byId = new Map(input.segments.map((segment) => [segment.segmentId, segment]));
  return Promise.all(candidates.map(async (candidate) => {
    const segment = byId.get(candidate.segmentId);
    if (!segment) return candidate;
    const evidenceSpan = await resolveSourceSpan(segment.text, candidate.evidenceText);
    return { ...candidate, evidenceSpan, evaluation: localExtractiveEvaluation(evidenceSpan) };
  }));
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
