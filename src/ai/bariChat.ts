import type { PublicGatewayConfig } from '@/ai/config';
import { resolvePublicGatewayConfig } from '@/ai/config';
import { BarionAIError } from '@/ai/errors';
import type { GatewayAccessTokenProvider } from '@/ai/gatewayProvider';
import type {
  BariChatRequestPayload,
  BariChatResponsePayload,
  BariChatSourceSegment,
  BariCitation,
} from '@/ai/types';
import type { EvidenceSnippet, SourceSegment, StudyCard } from '@/domain/types';

export type BariChatClientOptions = {
  config?: PublicGatewayConfig;
  fetchImplementation?: typeof fetch;
  accessTokenProvider?: GatewayAccessTokenProvider;
  allowFallback?: boolean;
};

export async function sendBariChatMessage(
  payload: BariChatRequestPayload,
  options: BariChatClientOptions = {},
): Promise<BariChatResponsePayload> {
  const config = options.config ?? resolvePublicGatewayConfig();
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const accessTokenProvider = options.accessTokenProvider;
  const allowFallback = options.allowFallback ?? true;

  if (config?.gatewayUrl) {
    try {
      const response = await requestGatewayChat(
        config,
        payload,
        fetchImplementation,
        accessTokenProvider,
      );
      return response;
    } catch (error) {
      if (!allowFallback) throw error;
      return generateLocalBariFallback(payload, error);
    }
  }

  if (allowFallback) {
    return generateLocalBariFallback(payload);
  }

  throw new BarionAIError('configuration_error', 'AI gateway URL is not configured.', {
    recoverable: false,
    providerId: 'barion-gateway',
    modelId: config?.model ?? 'unknown',
  });
}

async function requestGatewayChat(
  config: PublicGatewayConfig,
  payload: BariChatRequestPayload,
  fetchImplementation: typeof fetch,
  accessTokenProvider?: GatewayAccessTokenProvider,
): Promise<BariChatResponsePayload> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.timeoutMs);

  try {
    const body = JSON.stringify({
      conversationId: payload.conversationId,
      message: payload.message,
      mode: payload.mode ?? 'source-strict',
      sourceScope: payload.sourceScope ?? {},
      courseId: payload.courseId,
      deckId: payload.deckId,
      documentIds: payload.documentIds ?? [],
      evidence: payload.evidence ?? [],
    });

    const configuredToken = config.accessToken?.trim() || null;
    let accessToken = configuredToken || (accessTokenProvider ? await accessTokenProvider(false) : null);

    let response = await fetchImplementation(`${config.gatewayUrl}/v1/bari/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body,
      signal: abortController.signal,
    });

    if (response.status === 401 && accessTokenProvider && !configuredToken) {
      accessToken = await accessTokenProvider(true);
      response = await fetchImplementation(`${config.gatewayUrl}/v1/bari/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body,
        signal: abortController.signal,
      });
    }

    if (!response.ok) {
      throw await httpChatError(response, config.model);
    }

    const data: unknown = await response.json();
    if (!isRecord(data) || typeof data.message !== 'string') {
      throw new BarionAIError('invalid_provider_response', 'AI gateway returned invalid chat response.', {
        providerId: 'barion-gateway',
        modelId: config.model,
      });
    }

    const citations: BariCitation[] = Array.isArray(data.citations)
      ? data.citations.filter(isRecord).map((c) => ({
          segmentId: typeof c.segmentId === 'string' ? c.segmentId : undefined,
          locator: typeof c.locator === 'string' ? c.locator : undefined,
          sectionPath: typeof c.sectionPath === 'string' ? c.sectionPath : undefined,
          text: typeof c.text === 'string' ? c.text : undefined,
        }))
      : [];

    const evidence: BariChatSourceSegment[] = Array.isArray(data.evidence)
      ? data.evidence.filter(isRecord).map((e) => ({
          segmentId: String(e.segmentId || ''),
          locator: String(e.locator || ''),
          sectionPath: String(e.sectionPath || ''),
          text: String(e.text || ''),
        }))
      : [];

    const generationInfo = isRecord(data.generation)
      ? {
          provider: typeof data.generation.provider === 'string' ? data.generation.provider : undefined,
          model: typeof data.generation.model === 'string' ? data.generation.model : undefined,
          requestId: typeof data.generation.requestId === 'string' ? data.generation.requestId : 'unknown',
        }
      : { requestId: 'unknown' };

    return {
      message: data.message,
      citations,
      evidence,
      actions: Array.isArray(data.actions) ? data.actions.filter(isRecord) : [],
      warnings: Array.isArray(data.warnings) ? data.warnings.filter((w): w is string => typeof w === 'string') : [],
      generation: generationInfo,
    };
  } catch (error) {
    if (error instanceof BarionAIError) throw error;
    if (abortController.signal.aborted) {
      throw new BarionAIError('timeout_error', 'Bari chat request timed out.', {
        recoverable: true,
        providerId: 'barion-gateway',
        modelId: config.model,
      });
    }
    throw new BarionAIError('network_error', 'Unable to reach Bari AI gateway.', {
      recoverable: true,
      providerId: 'barion-gateway',
      modelId: config.model,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function httpChatError(response: Response, modelId: string): Promise<BarionAIError> {
  const status = response.status;
  if (status === 401 || status === 403) {
    return new BarionAIError('authentication_error', 'Bari chat authorization failed.', {
      recoverable: false,
      providerId: 'barion-gateway',
      modelId,
      httpStatus: status,
    });
  }
  if (status === 429) {
    return new BarionAIError('rate_limited', 'Bari is busy right now. Please wait a moment.', {
      recoverable: true,
      providerId: 'barion-gateway',
      modelId,
      httpStatus: status,
    });
  }
  return new BarionAIError('model_unavailable', 'Bari service is temporarily unavailable.', {
    recoverable: true,
    providerId: 'barion-gateway',
    modelId,
    httpStatus: status,
  });
}

export function generateLocalBariFallback(
  payload: BariChatRequestPayload,
  _error?: unknown,
): BariChatResponsePayload {
  const evidence = payload.evidence ?? [];
  const query = payload.message.toLowerCase();
  const queryTokens = query.split(/\s+/).filter((t) => t.length > 2);

  if (!evidence.length) {
    return {
      message:
        "I'm currently working in offline mode. I couldn't find enough support for that in your selected material. Open a study card with linked source notes to ask about specific concepts!",
      citations: [],
      evidence: [],
      actions: [],
      warnings: ['offline_fallback_no_evidence'],
      generation: {
        provider: 'local-fallback',
        model: 'deterministic-retrieval',
        requestId: `local-${Date.now()}`,
      },
    };
  }

  // Score segments by token match
  const scored = evidence.map((seg) => {
    const textLower = seg.text.toLowerCase();
    const matches = queryTokens.filter((token) => textLower.includes(token)).length;
    return { segment: seg, score: matches };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];

  if (!best || best.score === 0) {
    const primary = evidence[0];
    return {
      message: `I'm in offline mode. Here is the relevant note from ${primary.locator}:\n\n"${primary.text.slice(0, 300)}${primary.text.length > 300 ? '…' : ''}"\n\nLet me know if you want to review another topic!`,
      citations: [{ segmentId: primary.segmentId, locator: primary.locator, sectionPath: primary.sectionPath }],
      evidence: [primary],
      actions: [],
      warnings: ['offline_fallback_low_match'],
      generation: {
        provider: 'local-fallback',
        model: 'deterministic-retrieval',
        requestId: `local-${Date.now()}`,
      },
    };
  }

  const matched = best.segment;
  const citations: BariCitation[] = [{
    segmentId: matched.segmentId,
    locator: matched.locator,
    sectionPath: matched.sectionPath,
  }];

  return {
    message: `Based on your notes (${matched.locator}):\n\n"${matched.text.slice(0, 320)}${matched.text.length > 320 ? '…' : ''}"\n\nReview this key concept to reinforce your active recall!`,
    citations,
    evidence: [matched],
    actions: [],
    warnings: [],
    generation: {
      provider: 'local-fallback',
      model: 'deterministic-retrieval',
      requestId: `local-${Date.now()}`,
    },
  };
}

export function buildBariCardEvidence(
  card: StudyCard,
  snippet?: EvidenceSnippet,
): BariChatSourceSegment[] {
  const segments: BariChatSourceSegment[] = [];
  if (snippet && snippet.text) {
    segments.push({
      segmentId: `card-${card.id}-evidence`,
      locator: snippet.locator || snippet.sourceTitle || 'Card Source',
      sectionPath: snippet.sourceTitle || 'Card Evidence',
      text: snippet.text,
    });
  } else if (card.prompt || card.answer) {
    segments.push({
      segmentId: `card-${card.id}`,
      locator: 'Card Context',
      sectionPath: 'Current Card',
      text: `Question: ${card.prompt}\nAnswer: ${card.answer}`,
    });
  }
  return segments;
}

export function buildBariDeckEvidence(
  segments: SourceSegment[],
  limit = 10,
): BariChatSourceSegment[] {
  return segments.slice(0, limit).map((s) => ({
    segmentId: s.id,
    locator: s.locator || 'Source segment',
    sectionPath: s.sectionPath || 'Source',
    text: s.text,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
