export type AIErrorCode =
  | 'configuration_error'
  | 'network_error'
  | 'timeout_error'
  | 'authentication_error'
  | 'rate_limited'
  | 'request_too_large'
  | 'model_unavailable'
  | 'provider_unavailable'
  | 'invalid_provider_response'
  | 'insufficient_evidence'
  | 'internal_error';

export type AIErrorOptions = {
  recoverable?: boolean;
  providerId?: string;
  modelId?: string;
  httpStatus?: number;
  providerRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  remoteCandidateCount?: number;
};

export class BarionAIError extends Error {
  readonly code: AIErrorCode;
  readonly recoverable: boolean;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly httpStatus?: number;
  readonly providerRequestId?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly remoteCandidateCount?: number;

  constructor(code: AIErrorCode, message: string, options: AIErrorOptions = {}) {
    super(message);
    this.name = 'BarionAIError';
    this.code = code;
    this.recoverable = options.recoverable ?? false;
    this.providerId = options.providerId;
    this.modelId = options.modelId;
    this.httpStatus = options.httpStatus;
    this.providerRequestId = options.providerRequestId;
    this.inputTokens = options.inputTokens;
    this.outputTokens = options.outputTokens;
    this.remoteCandidateCount = options.remoteCandidateCount;
  }
}

export function asBarionAIError(error: unknown) {
  if (error instanceof BarionAIError) return error;
  return new BarionAIError('internal_error', 'Card generation failed.', { recoverable: true });
}
