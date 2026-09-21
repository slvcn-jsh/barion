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
  providerRequestId?: string;
  providerId: string;
  modelId: string;
  promptId: string;
  promptVersion: string;
  generatedAt: string;
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
  candidateCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: string;
};

export interface AITelemetrySink {
  record(event: AITelemetryEvent): void;
}