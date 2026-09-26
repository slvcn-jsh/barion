import type { SourceSpan } from '@/ai/sourceSpan';
import type { ProductionEvaluation } from '@/ai/evaluation';

export type SourceContext = {
  segmentId: string;
  locator: string;
  sectionPath: string;
  text: string;
};

export type CardGenerationInput = {
  requestId: string;
  sourceId: string;
  sourceTitle: string;
  segments: SourceContext[];
  maxCandidates: number;
  conceptTargets?: Array<{
    term: string;
    detail: string;
    importance: 'critical' | 'high' | 'standard';
    emphasis: 'safety' | 'treatment' | 'clinical' | 'mechanism' | 'definition' | 'overview';
    segmentIds: string[];
    locator: string;
  }>;
};

export type ProviderGenerationRequest = {
  requestId: string;
  promptId: string;
  promptVersion: string;
  systemPrompt: string;
  userPrompt: string;
  minCandidates: number;
  maxCandidates: number;
};

export type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
};

export type ProviderGenerationResult = {
  output: unknown;
  providerRequestId?: string;
  providerId?: string;
  modelId?: string;
  usage?: ProviderUsage;
};

export interface CardGenerationProvider {
  readonly id: string;
  readonly model: string;
  generate(request: ProviderGenerationRequest): Promise<ProviderGenerationResult>;
}

export type GroundedCardCandidate = {
  segmentId: string;
  locator: string;
  cardType: string;
  learningObjective: string;
  question: string;
  answer: string;
  evidenceText: string;
  evidenceSpan?: SourceSpan;
  evaluation?: ProductionEvaluation;
};

export type CardGenerationProvenance = {
  requestId: string;
  generationMode: GenerationMode;
  fallbackUsed: boolean;
  providerRequestId?: string;
  providerId: string;
  modelId: string;
  attemptedProviderId?: string;
  attemptedModelId?: string;
  promptId: string;
  promptVersion: string;
  generatedAt: string;
  remoteCandidateCount: number;
  durationMs: number;
  usage?: ProviderUsage;
  fallbackReason?: string;
};

export type GroundedCardGenerationResult = {
  candidates: GroundedCardCandidate[];
  provenance: CardGenerationProvenance;
};

export type AITelemetryEvent = {
  requestId: string;
  operation: 'card-generation';
  providerId: string;
  modelId: string;
  promptVersion: string;
  durationMs: number;
  success: boolean;
  generationMode?: GenerationMode;
  fallbackUsed?: boolean;
  candidateCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: string;
};

export interface AITelemetrySink {
  record(event: AITelemetryEvent): void;
}

export type GenerationMode =
  | 'REMOTE_AI'
  | 'LOCAL_FALLBACK'
  | 'PARTIAL_REMOTE_WITH_FALLBACK'
  | 'FAILED';

export type BariChatSourceSegment = {
  segmentId: string;
  locator: string;
  sectionPath: string;
  text: string;
};

export type BariCitation = {
  segmentId?: string;
  locator?: string;
  sectionPath?: string;
  text?: string;
};

export type BariChatRequestPayload = {
  conversationId?: string;
  message: string;
  mode?: 'source-strict' | 'explain';
  sourceScope?: Record<string, unknown>;
  courseId?: string;
  deckId?: string;
  documentIds?: string[];
  evidence?: BariChatSourceSegment[];
};

export type BariGenerationInfo = {
  provider?: string;
  model?: string;
  requestId: string;
};

export type BariChatResponsePayload = {
  message: string;
  citations: BariCitation[];
  evidence: BariChatSourceSegment[];
  actions?: Array<Record<string, unknown>>;
  warnings?: string[];
  generation: BariGenerationInfo;
};
