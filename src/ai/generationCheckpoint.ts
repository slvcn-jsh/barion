import type { BatchGenerationSummary, CoverageState } from '@/ai/batchGeneration';
import type { CardGenerationProvenance, GroundedCardCandidate } from '@/ai/types';

export const GENERATION_CHECKPOINT_VERSION = 1;

const MAX_CHECKPOINT_CANDIDATES = 512;
const MAX_CHECKPOINT_BATCHES = 32;
const GENERATION_MODES = new Set([
  'REMOTE_AI',
  'LOCAL_BASELINE',
  'LOCAL_FALLBACK',
  'PARTIAL_REMOTE_WITH_FALLBACK',
  'FAILED',
]);
const PUBLICATION_DISPOSITIONS = new Set(['PUBLISH', 'SANITIZE', 'REVIEW', 'REJECT']);
const STOPPED_REASONS = new Set([
  'all_concepts_covered',
  'max_batches_reached',
  'no_concepts',
  'generation_failed',
]);

type SerializedCoverageState = Omit<CoverageState, 'coveredTargetIds'> & {
  coveredTargetIds: string[];
};

type SerializedGenerationCheckpoint = Omit<BatchGenerationSummary, 'coverage'> & {
  checkpointVersion: number;
  coverage: SerializedCoverageState;
};

export function serializeGenerationCheckpoint(summary: BatchGenerationSummary): string {
  const checkpoint: SerializedGenerationCheckpoint = {
    checkpointVersion: GENERATION_CHECKPOINT_VERSION,
    allBatchResults: summary.allBatchResults,
    allCandidates: summary.allCandidates,
    coverage: {
      ...summary.coverage,
      coveredTargetIds: [...summary.coverage.coveredTargetIds],
    },
    batchMetadata: summary.batchMetadata,
  };
  return JSON.stringify(checkpoint);
}

export function restoreGenerationCheckpoint(serialized: string): BatchGenerationSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error('Saved generation checkpoint is not valid JSON.', { cause: error });
  }
  if (!isRecord(parsed) || parsed.checkpointVersion !== GENERATION_CHECKPOINT_VERSION) {
    throw new Error('Saved generation checkpoint has an unsupported version.');
  }
  if (
    !Array.isArray(parsed.allBatchResults)
    || !Array.isArray(parsed.allCandidates)
    || parsed.allBatchResults.length > MAX_CHECKPOINT_BATCHES
    || parsed.allCandidates.length > MAX_CHECKPOINT_CANDIDATES
    || !parsed.allBatchResults.every(isBatchResult)
    || !parsed.allCandidates.every(isGroundedCardCandidate)
    || !isRecord(parsed.coverage)
    || !isCoverageState(parsed.coverage)
    || !isRecord(parsed.batchMetadata)
    || !isBatchMetadata(parsed.batchMetadata)
  ) {
    throw new Error('Saved generation checkpoint is incomplete.');
  }
  if (parsed.coverage.totalCandidates !== parsed.allCandidates.length) {
    throw new Error('Saved generation checkpoint candidate counts do not match.');
  }

  return {
    allBatchResults: parsed.allBatchResults as BatchGenerationSummary['allBatchResults'],
    allCandidates: parsed.allCandidates as BatchGenerationSummary['allCandidates'],
    coverage: {
      ...(parsed.coverage as Omit<CoverageState, 'coveredTargetIds'>),
      coveredTargetIds: new Set(parsed.coverage.coveredTargetIds as string[]),
    },
    batchMetadata: parsed.batchMetadata as BatchGenerationSummary['batchMetadata'],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGroundedCardCandidate(value: unknown): value is GroundedCardCandidate {
  if (!isRecord(value)) return false;
  if (!['segmentId', 'locator', 'cardType', 'learningObjective', 'question', 'answer', 'evidenceText']
      .every((key) => typeof value[key] === 'string')) return false;
  if (!String(value.segmentId).trim() || !String(value.question).trim() || !String(value.answer).trim()) return false;
  if (!isOptionalString(value.targetId) || !isOptionalString(value.qualityNotes)) return false;
  if (value.frontStyle !== undefined && !['term', 'question'].includes(String(value.frontStyle))) return false;
  if (value.qualityScore !== undefined && !isFiniteNumber(value.qualityScore)) return false;
  if (value.evidenceSpan !== undefined && !isRecord(value.evidenceSpan)) return false;
  if (value.evaluation === undefined) return true;
  if (!isRecord(value.evaluation)) return false;
  if (!PUBLICATION_DISPOSITIONS.has(String(value.evaluation.publicationDisposition))) return false;
  return Array.isArray(value.evaluation.reasonCodes)
    && value.evaluation.reasonCodes.every((reason) => typeof reason === 'string');
}

function isBatchResult(value: unknown) {
  if (!isRecord(value)
      || !isNonNegativeInteger(value.batchIndex)
      || !Array.isArray(value.candidates)
      || value.candidates.length > MAX_CHECKPOINT_CANDIDATES
      || !value.candidates.every(isGroundedCardCandidate)
      || !isStringArray(value.conceptsAttempted)
      || !isStringArray(value.conceptsCovered)
      || !isRecord(value.generationResult)
      || !Array.isArray(value.generationResult.candidates)
      || !value.generationResult.candidates.every(isGroundedCardCandidate)) return false;
  return isCardGenerationProvenance(value.generationResult.provenance);
}

function isCardGenerationProvenance(value: unknown): value is CardGenerationProvenance {
  if (!isRecord(value)) return false;
  if (!['requestId', 'providerId', 'modelId', 'promptId', 'promptVersion', 'generatedAt']
      .every((key) => typeof value[key] === 'string' && Boolean(String(value[key]).trim()))) return false;
  if (!GENERATION_MODES.has(String(value.generationMode))
      || typeof value.fallbackUsed !== 'boolean'
      || !isNonNegativeInteger(value.remoteCandidateCount)
      || !isNonNegativeNumber(value.durationMs)) return false;
  if (!['providerRequestId', 'attemptedProviderId', 'attemptedModelId', 'fallbackReason']
      .every((key) => isOptionalString(value[key]))) return false;
  if (value.usage === undefined) return true;
  return isRecord(value.usage)
    && isOptionalNonNegativeNumber(value.usage.inputTokens)
    && isOptionalNonNegativeNumber(value.usage.outputTokens);
}

function isCoverageState(value: Record<string, unknown>) {
  return Array.isArray(value.coveredTargetIds)
    && value.coveredTargetIds.length <= MAX_CHECKPOINT_CANDIDATES
    && value.coveredTargetIds.every((item) => typeof item === 'string')
    && ['batchesCompleted', 'totalCandidates', 'remoteCandidateCount', 'fallbackCandidateCount']
      .every((key) => isNonNegativeInteger(value[key]))
    && typeof value.remoteAIUsed === 'boolean'
    && typeof value.anyFallback === 'boolean';
}

function isBatchMetadata(value: Record<string, unknown>) {
  const countKeys = [
    'totalBatches',
    'batchesCompleted',
    'totalConcepts',
    'criticalConceptCount',
    'highConceptCount',
    'coveredConceptCount',
    'uncoveredCriticalCount',
    'uncoveredHighCount',
    'repairAttemptedTargetCount',
    'repairedTargetCount',
  ];
  return countKeys.every((key) => isNonNegativeInteger(value[key]))
    && typeof value.gapBatchUsed === 'boolean'
    && isStringArray(value.missingTargetIds)
    && Array.isArray(value.batchDiagnostics)
    && value.batchDiagnostics.length <= MAX_CHECKPOINT_BATCHES
    && value.batchDiagnostics.every(isBatchDiagnostic)
    && STOPPED_REASONS.has(String(value.stoppedReason));
}

function isBatchDiagnostic(value: unknown) {
  return isRecord(value)
    && ['batchIndex', 'attemptedTargetCount', 'coveredTargetCount', 'candidateCount', 'remoteCandidateCount']
      .every((key) => isNonNegativeInteger(value[key]))
    && typeof value.fallbackUsed === 'boolean'
    && isOptionalString(value.fallbackReason);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isOptionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown) {
  return isFiniteNumber(value) && Number(value) >= 0;
}

function isOptionalNonNegativeNumber(value: unknown) {
  return value === undefined || isNonNegativeNumber(value);
}

function isNonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0;
}
