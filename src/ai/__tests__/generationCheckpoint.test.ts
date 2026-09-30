import {
  GENERATION_CHECKPOINT_VERSION,
  restoreGenerationCheckpoint,
  serializeGenerationCheckpoint,
} from '@/ai/generationCheckpoint';
import type { BatchGenerationSummary } from '@/ai/batchGeneration';

const summary: BatchGenerationSummary = {
  allBatchResults: [],
  allCandidates: [],
  coverage: {
    coveredTargetIds: new Set(['target-1', 'target-2']),
    batchesCompleted: 1,
    totalCandidates: 0,
    remoteCandidateCount: 0,
    fallbackCandidateCount: 0,
    remoteAIUsed: true,
    anyFallback: false,
  },
  batchMetadata: {
    totalBatches: 1,
    batchesCompleted: 1,
    totalConcepts: 2,
    criticalConceptCount: 1,
    highConceptCount: 1,
    coveredConceptCount: 2,
    uncoveredCriticalCount: 0,
    uncoveredHighCount: 0,
    gapBatchUsed: false,
    repairAttemptedTargetCount: 0,
    repairedTargetCount: 0,
    missingTargetIds: [],
    batchDiagnostics: [],
    stoppedReason: 'all_concepts_covered',
  },
};

describe('generation checkpoint', () => {
  it('round-trips validated batch state including covered target identity', () => {
    const serialized = serializeGenerationCheckpoint(summary);
    const restored = restoreGenerationCheckpoint(serialized);

    expect(JSON.parse(serialized).checkpointVersion).toBe(GENERATION_CHECKPOINT_VERSION);
    expect([...restored.coverage.coveredTargetIds]).toEqual(['target-1', 'target-2']);
    expect(restored.batchMetadata).toEqual(summary.batchMetadata);
  });

  it.each([
    'not-json',
    '{}',
    JSON.stringify({ checkpointVersion: GENERATION_CHECKPOINT_VERSION }),
    JSON.stringify({
      checkpointVersion: GENERATION_CHECKPOINT_VERSION,
      allBatchResults: [],
      allCandidates: [],
      coverage: { coveredTargetIds: [1] },
      batchMetadata: {},
    }),
  ])('rejects malformed or incompatible checkpoint %s', (serialized) => {
    expect(() => restoreGenerationCheckpoint(serialized)).toThrow(/checkpoint/i);
  });

  it('rejects nested candidates that are unsafe to persist', () => {
    const malformed = JSON.parse(serializeGenerationCheckpoint(summary));
    malformed.allCandidates = [{ question: 'Missing required fields' }];
    malformed.coverage.totalCandidates = 1;

    expect(() => restoreGenerationCheckpoint(JSON.stringify(malformed))).toThrow(/checkpoint/i);
  });

  it('rejects inconsistent candidate accounting', () => {
    const inconsistent = JSON.parse(serializeGenerationCheckpoint(summary));
    inconsistent.coverage.totalCandidates = 1;

    expect(() => restoreGenerationCheckpoint(JSON.stringify(inconsistent))).toThrow(/candidate counts/i);
  });
});
