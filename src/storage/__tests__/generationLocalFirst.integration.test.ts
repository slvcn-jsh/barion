import { BarionAIError } from '@/ai/errors';
import type { GroundedCardCandidate } from '@/ai/types';
import type { BatchGenerationSummary } from '@/ai/batchGeneration';
import { extractConceptTargets } from '@/ingestion/concepts';
import { serializeGenerationCheckpoint } from '@/ai/generationCheckpoint';

const mockGetDatabase = jest.fn();
const mockReadGatewayConfig = jest.fn();
const mockCreateGatewayProvider = jest.fn();
const mockGenerateLocalBaselineCards = jest.fn();
const mockRunBatchedGeneration = jest.fn();
let mockIdSequence = 0;

jest.mock('@/domain/ids', () => ({
  createId: (prefix: string) => `${prefix}-test-${++mockIdSequence}`,
  nowIso: () => '2026-09-28T00:00:00.000Z',
}));

jest.mock('@/storage/database', () => ({
  getDatabase: () => mockGetDatabase(),
}));

jest.mock('@/ai/config', () => ({
  readExpoPublicGatewayConfig: () => mockReadGatewayConfig(),
}));

jest.mock('@/ai/gatewayProvider', () => ({
  createGatewayCardGenerationProvider: (...args: unknown[]) => mockCreateGatewayProvider(...args),
}));

jest.mock('@/ai/generate', () => ({
  ...jest.requireActual('@/ai/generate'),
  generateLocalBaselineCards: (...args: unknown[]) => mockGenerateLocalBaselineCards(...args),
}));

jest.mock('@/ai/batchGeneration', () => ({
  ...jest.requireActual('@/ai/batchGeneration'),
  runBatchedGeneration: (...args: unknown[]) => mockRunBatchedGeneration(...args),
}));

jest.mock('@/auth/sessionProvider', () => ({
  createSupabaseAccessTokenProvider: () => async () => null,
}));

jest.mock('@/scheduler/fsrs', () => ({
  createInitialFsrsCard: () => '{}',
  schedulerVersion: 'test-scheduler',
}));

jest.mock('@/storage/repositories/shared', () => ({
  resolveRegeneratedCardTrash: jest.fn(async () => undefined),
  runWriteTransaction: async (_db: unknown, work: (db: unknown) => Promise<void>) => work(_db),
  upsertSearchIndex: jest.fn(async () => undefined),
  upsertSourceStudyGuide: jest.fn(async () => undefined),
}));

jest.mock('@/storage/repositories/sourceRepository', () => ({
  processSource: jest.fn(),
}));

import {
  enhanceDraftsForSource,
  generateDraftsForSource,
  queueSmartEnhancementForSource,
  resumeQueuedGenerationJobs,
} from '@/storage/repositories/generationRepository';

type CandidateRecord = {
  id: string;
  jobId: string;
  targetId: string | null;
  segmentId: string;
  cardType: string;
  learningObjective: string;
  qualityScore: number;
  qualityNotes: string;
  question: string;
  answer: string;
  evidenceText: string;
  verificationStatus: string;
  publicationDisposition: string;
  supportScore: number;
  status: string;
};

function createFakeDatabase(sourceCardCount = 0, candidatePersistenceFailures = 0) {
  const state = {
    activeCardCount: sourceCardCount,
    batchMetadata: null as Record<string, unknown> | null,
    candidateCheckpointJson: null as string | null,
    candidateInsertAttempts: 0,
    candidates: new Map<string, CandidateRecord>(),
    failureReason: null as string | null,
    generationJobInsertCount: 0,
    heldCandidateCount: 0,
    jobAttemptCount: 0,
    jobGenerationKey: null as string | null,
    jobPurpose: null as string | null,
    jobRequestId: null as string | null,
    jobStatus: null as string | null,
    latestJobId: null as string | null,
    queuedJobs: [] as Array<{ sourceId: string; purpose: 'local-baseline' | 'smart-enhancement' }>,
    remoteCandidateCount: 0,
    sourceStatus: 'ready',
    sourceError: null as string | null,
  };

  const db = {
    getAllAsync: jest.fn(async (sql: string) => {
      if (sql.includes("generation_jobs.status = 'queued'")) return state.queuedJobs;
      if (sql.includes('FROM source_segments')) {
        return [{
          id: 'segment-1',
          locator: 'Page 1',
          sectionPath: 'Definition',
          text: 'PCOS is an endocrine disorder.',
          startOffset: 0,
          endOffset: 30,
        }];
      }
      if (sql.includes('SELECT cards.id, cards.note_id AS noteId')) return [];
      return [];
    }),
    getFirstAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes('SELECT sources.title')) {
        return {
          title: 'PCOS Notes',
          sha256: 'source-sha',
          defaultDeckId: 'deck-1',
          sourceCardCount,
        };
      }
      if (sql.includes('SELECT sources.sha256')) {
        return {
          sha256: 'source-sha',
          defaultDeckId: 'deck-1',
          sourceCardCount: state.activeCardCount,
        };
      }
      if (sql.includes("status IN ('running', 'publishing')")) {
        return state.jobStatus === 'running' || state.jobStatus === 'publishing'
          ? { id: state.latestJobId, generationKey: state.jobGenerationKey }
          : null;
      }
      if (sql.includes('WHERE generation_key = ?')) {
        return state.jobGenerationKey === String(params[0]) && state.latestJobId
          ? {
              id: state.latestJobId,
              requestId: state.jobRequestId,
              status: state.jobStatus,
              attemptCount: state.jobAttemptCount,
              candidateCheckpointJson: state.candidateCheckpointJson,
            }
          : null;
      }
      if (sql.includes('COALESCE(attempt_count, 1)')) return { attemptCount: state.jobAttemptCount || 1 };
      if (sql.includes('ORDER BY created_at DESC, rowid DESC') && sql.includes('FROM generation_jobs')) {
        return state.latestJobId ? { id: state.latestJobId } : null;
      }
      if (sql.includes('FROM generated_candidates') && sql.includes('JOIN generation_jobs')) {
        const candidate = state.candidates.get(String(params[0]));
        return candidate ? {
          ...candidate,
          sourceId: 'source-1',
          jobDeckId: 'deck-1',
          defaultDeckId: 'deck-1',
        } : null;
      }
      if (sql.includes('COUNT(DISTINCT COALESCE(published_card_id, id))')) {
        return { count: [...state.candidates.values()].filter((item) => item.status === 'approved').length };
      }
      if (sql.includes('SELECT status, published_card_count AS publishedCardCount')) {
        return {
          status: state.jobStatus,
          publishedCardCount: [...state.candidates.values()].filter((item) => item.status === 'approved').length,
        };
      }
      if (sql.includes("COUNT(*) AS count FROM generated_candidates")) {
        return { count: [...state.candidates.values()].filter((item) => item.status === 'pending').length };
      }
      if (sql.includes('ORDER BY CASE WHEN cards.deleted_at IS NULL')) return null;
      if (sql.includes("cards.status = 'source_extracted'")) return null;
      if (sql.includes('FROM cards') && sql.includes('JOIN notes')) {
        return { count: state.activeCardCount };
      }
      return null;
    }),
    runAsync: jest.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes('INSERT INTO generation_jobs')) {
        const queuedInsert = sql.includes("VALUES (?, ?, ?, 'queued'");
        state.latestJobId = String(params[0]);
        state.jobStatus = queuedInsert ? 'queued' : String(params[3]);
        state.jobPurpose = queuedInsert ? 'smart-enhancement' : String(params[12]);
        state.jobGenerationKey = String(queuedInsert ? params[8] : params[13]);
        state.jobRequestId = String(queuedInsert ? params[9] : params[14]);
        state.jobAttemptCount = queuedInsert ? 0 : Number(params[22]);
        state.generationJobInsertCount += 1;
      } else if (sql.includes("SET status = 'running'")) {
        state.jobStatus = 'running';
        state.jobRequestId = String(params[6]);
        state.jobAttemptCount = Number(params[8]);
      } else if (sql.includes("SET status = 'publishing'") && sql.includes('Resuming validated cards')) {
        state.jobStatus = 'publishing';
      } else if (sql.includes("SET status = 'publishing'") && sql.includes('candidate_checkpoint_json = ?')) {
        state.jobStatus = 'publishing';
        state.remoteCandidateCount = Number(params[8]);
        state.batchMetadata = JSON.parse(String(params[9])) as Record<string, unknown>;
        state.candidateCheckpointJson = String(params[10]);
      } else if (sql.includes('SET status = ?, summary = ?') && params[0] === 'publishing') {
        state.jobStatus = 'publishing';
        state.batchMetadata = params[18]
          ? JSON.parse(String(params[18])) as Record<string, unknown>
          : null;
      } else if (sql.includes("SET status = 'completed'")) {
        state.jobStatus = 'completed';
        if (sql.includes('candidate_checkpoint_json = NULL')) {
          state.heldCandidateCount = Number(params[2]);
        }
        state.candidateCheckpointJson = null;
      } else if (sql.includes("SET status = 'queued'")) {
        state.jobStatus = 'queued';
      } else if (sql.includes('INSERT INTO generated_candidates')) {
        state.candidateInsertAttempts += 1;
        if (candidatePersistenceFailures > 0) {
          candidatePersistenceFailures -= 1;
          throw new Error('simulated publication failure');
        }
        state.candidates.set(String(params[0]), {
          id: String(params[0]),
          jobId: String(params[1]),
          targetId: params[2] === null ? null : String(params[2]),
          segmentId: String(params[3]),
          cardType: String(params[4]),
          learningObjective: String(params[5]),
          qualityScore: Number(params[6]),
          qualityNotes: String(params[7]),
          question: String(params[8]),
          answer: String(params[9]),
          evidenceText: String(params[10]),
          publicationDisposition: String(params[15]),
          verificationStatus: String(params[19]),
          supportScore: Number(params[20]),
          status: String(params[21]),
        });
      } else if (sql.includes("SET status = 'failed', generation_mode = 'FAILED'")) {
        state.jobStatus = 'failed';
        state.failureReason = String(params[3]);
        state.remoteCandidateCount = Number(params[7] ?? 0);
        state.batchMetadata = params[8]
          ? JSON.parse(String(params[8])) as Record<string, unknown>
          : null;
        if (Number(params[9]) === 1) state.candidateCheckpointJson = null;
      } else if (sql.includes("UPDATE generated_candidates SET status = 'approved'")) {
        const candidate = state.candidates.get(String(params[1]));
        if (candidate) candidate.status = 'approved';
      } else if (sql.includes('INSERT INTO cards')) {
        state.activeCardCount += 1;
      } else if (sql.includes('UPDATE sources') && sql.includes('SET status = ?')) {
        state.sourceStatus = String(params[0]);
        state.sourceError = params[1] === null ? null : String(params[1]);
      } else if (sql.includes("SET status = 'waiting-for-generation'")) {
        state.sourceStatus = 'waiting-for-generation';
        state.sourceError = null;
      }
      return { changes: 1 };
    }),
  };

  return { db, state };
}

const exactSourceSpan = {
  version: '1.0.0' as const,
  offsetEncoding: 'utf16-code-units' as const,
  boundaryConvention: 'half-open' as const,
  status: 'exact' as const,
  startOffset: 0,
  endOffset: 30,
  evidenceTextSha256: 'evidence-sha',
  sourceTextSha256: 'source-sha',
  matchCount: 1,
};

const localCandidate: GroundedCardCandidate = {
  targetId: 'target-1',
  segmentId: 'segment-1',
  locator: 'Page 1',
  cardType: 'definition',
  learningObjective: 'Recall PCOS.',
  qualityScore: 0.92,
  qualityNotes: '92% quality · deterministic source match.',
  question: 'What is PCOS?',
  answer: 'Answer: PCOS is an endocrine disorder.',
  evidenceText: 'PCOS is an endocrine disorder.',
  evidenceSpan: exactSourceSpan,
  evaluation: {
    contractVersion: '1.0.0',
    evaluationVersion: '1.0.0',
    policyVersion: '3.1.0',
    sourceSpan: exactSourceSpan,
    evidenceSpanVerified: true,
    sourceClaimSupported: 'supported',
    citationStatus: 'exact',
    medicalRisk: 'none',
    medicalVerificationStatus: 'verification_not_required',
    pedagogyStatus: 'acceptable',
    publicationDisposition: 'PUBLISH',
    reasonCodes: ['DETERMINISTIC_EXTRACTIVE_SOURCE_SUPPORT'],
  },
};

describe('local-first generation repository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIdSequence = 0;
  });

  it('publishes a local baseline without reading gateway configuration', async () => {
    const { db, state } = createFakeDatabase();
    mockGetDatabase.mockResolvedValue(db);
    mockGenerateLocalBaselineCards.mockResolvedValue({
      candidates: [localCandidate],
      provenance: {
        requestId: 'local-request',
        generationMode: 'LOCAL_BASELINE',
        fallbackUsed: false,
        providerId: 'local-extractive',
        modelId: 'barion-extractive-rules',
        promptId: 'extractive-rules',
        promptVersion: 'extractive-v1',
        generatedAt: '2026-09-28T00:00:00.000Z',
        remoteCandidateCount: 0,
        durationMs: 1,
      },
    });

    const published = await generateDraftsForSource('source-1');

    expect(published).toBe(1);
    expect(mockReadGatewayConfig).not.toHaveBeenCalled();
    expect(mockRunBatchedGeneration).not.toHaveBeenCalled();
    expect(state.activeCardCount).toBe(1);
    expect(state.sourceStatus).toBe('ready');
    expect([...state.candidates.values()][0]).toEqual(expect.objectContaining({
      status: 'approved',
      verificationStatus: 'extractive-source-match',
      publicationDisposition: 'PUBLISH',
    }));
  });

  it('keeps existing cards ready when Smart Enhancement is rate limited', async () => {
    const { db, state } = createFakeDatabase(2);
    mockGetDatabase.mockResolvedValue(db);
    mockReadGatewayConfig.mockReturnValue({ gatewayUrl: 'http://127.0.0.1:8790' });
    mockCreateGatewayProvider.mockReturnValue({ id: 'gemini', model: 'flash', generate: jest.fn() });
    mockRunBatchedGeneration.mockRejectedValue(new BarionAIError(
      'rate_limited',
      'Provider quota exceeded.',
      { recoverable: true, providerId: 'gemini', modelId: 'flash' },
    ));

    const published = await enhanceDraftsForSource('source-1');

    expect(published).toBe(2);
    expect(state.activeCardCount).toBe(2);
    expect(state.sourceStatus).toBe('ready');
    expect(state.sourceError).toBeNull();
  });

  it('preserves remote selection evidence when publication fails after generation', async () => {
    const { db, state } = createFakeDatabase(2, Number.POSITIVE_INFINITY);
    const remoteCandidates = Array.from({ length: 60 }, (_, index) => ({
      ...localCandidate,
      targetId: `target-${index + 1}`,
      question: `What is PCOS fact ${index + 1}?`,
      answer: `Answer: PCOS fact ${index + 1}.`,
    }));
    mockGetDatabase.mockResolvedValue(db);
    mockReadGatewayConfig.mockReturnValue({ gatewayUrl: 'http://127.0.0.1:8790' });
    mockCreateGatewayProvider.mockReturnValue({ id: 'gemini', model: 'flash', generate: jest.fn() });
    mockRunBatchedGeneration.mockResolvedValue({
      allCandidates: remoteCandidates,
      allBatchResults: [{
        generationResult: {
          candidates: remoteCandidates,
          provenance: {
            requestId: 'remote-request',
            providerRequestId: 'gemini-request-1',
            generationMode: 'REMOTE_AI',
            fallbackUsed: false,
            providerId: 'gemini',
            modelId: 'flash',
            promptId: 'grounded-card-generation',
            promptVersion: 'test',
            generatedAt: '2026-09-28T00:00:00.000Z',
            remoteCandidateCount: 60,
            durationMs: 500,
            usage: { inputTokens: 1_000, outputTokens: 2_000 },
          },
        },
      }],
      coverage: {
        coveredTargetIds: new Set(remoteCandidates.map((candidate) => candidate.targetId)),
        batchesCompleted: 1,
        totalCandidates: 60,
        remoteCandidateCount: 60,
        fallbackCandidateCount: 0,
        remoteAIUsed: true,
        anyFallback: false,
      },
      batchMetadata: {
        totalBatches: 1,
        batchesCompleted: 1,
        totalConcepts: 60,
        criticalConceptCount: 0,
        highConceptCount: 0,
        coveredConceptCount: 60,
        uncoveredCriticalCount: 0,
        uncoveredHighCount: 0,
        gapBatchUsed: false,
        repairAttemptedTargetCount: 0,
        repairedTargetCount: 0,
        missingTargetIds: [],
        batchDiagnostics: [],
        stoppedReason: 'all_concepts_covered',
      },
    });

    await expect(enhanceDraftsForSource('source-1')).rejects.toThrow('simulated publication failure');

    expect(mockRunBatchedGeneration).toHaveBeenCalledTimes(1);
    expect(state.remoteCandidateCount).toBe(60);
    expect(state.failureReason).toBe('internal_error');
    expect(state.batchMetadata).toEqual(expect.objectContaining({
      selection: expect.objectContaining({
        rawCandidateCount: 60,
        remoteCandidateCount: 60,
        publicationFailureCount: 2,
      }),
    }));
    expect(state.candidateInsertAttempts).toBe(2);
    expect(state.activeCardCount).toBe(2);
    expect(state.sourceStatus).toBe('ready');
  });

  it('retries remote publication once without making another provider request', async () => {
    const { db, state } = createFakeDatabase(2, 1);
    mockGetDatabase.mockResolvedValue(db);
    mockReadGatewayConfig.mockReturnValue({ gatewayUrl: 'http://127.0.0.1:8790' });
    mockCreateGatewayProvider.mockReturnValue({ id: 'gemini', model: 'flash', generate: jest.fn() });
    mockRunBatchedGeneration.mockResolvedValue(remoteBatch([localCandidate]));

    const published = await enhanceDraftsForSource('source-1');

    expect(published).toBe(1);
    expect(mockRunBatchedGeneration).toHaveBeenCalledTimes(1);
    expect(state.candidateInsertAttempts).toBe(2);
    expect(state.jobStatus).toBe('completed');
    expect(state.batchMetadata).toEqual(expect.objectContaining({
      selection: expect.objectContaining({ publicationFailureCount: 1 }),
    }));
    expect(state.sourceStatus).toBe('ready');
  });

  it('resumes a durably checkpointed candidate batch without another provider request', async () => {
    const { db, state } = createFakeDatabase(2);
    const checkpointed = remoteBatch([localCandidate]);
    checkpointed.allBatchResults[0].generationResult.provenance.providerId = 'checkpoint-provider';
    checkpointed.allBatchResults[0].generationResult.provenance.modelId = 'checkpoint-model';
    checkpointed.allBatchResults[0].generationResult.provenance.attemptedProviderId = 'checkpoint-attempt-provider';
    checkpointed.allBatchResults[0].generationResult.provenance.attemptedModelId = 'checkpoint-attempt-model';
    state.latestJobId = 'job-checkpointed';
    state.jobStatus = 'failed';
    state.jobPurpose = 'smart-enhancement';
    state.jobGenerationKey = 'source-1:source-sha:smart-enhancement:grounded-card-generation:1.4.0';
    state.jobRequestId = 'generation-request-checkpointed';
    state.jobAttemptCount = 3;
    state.candidateCheckpointJson = serializeGenerationCheckpoint(checkpointed);
    mockGetDatabase.mockResolvedValue(db);
    mockReadGatewayConfig.mockReturnValue({ gatewayUrl: 'http://127.0.0.1:8790' });
    mockCreateGatewayProvider.mockReturnValue({ id: 'current-provider', model: 'current-model', generate: jest.fn() });

    const published = await enhanceDraftsForSource('source-1');

    expect(published).toBe(1);
    expect(mockRunBatchedGeneration).not.toHaveBeenCalled();
    expect(state.jobStatus).toBe('completed');
    expect(state.candidateCheckpointJson).toBeNull();
    expect(state.activeCardCount).toBe(3);
    const checkpointWrite = db.runAsync.mock.calls.find(
      ([sql]) => sql.includes('candidate_checkpoint_json = ?'),
    );
    expect(checkpointWrite?.slice(2, 6)).toEqual([
      'checkpoint-provider',
      'checkpoint-model',
      'checkpoint-attempt-provider',
      'checkpoint-attempt-model',
    ]);
    const publicationUpdate = db.runAsync.mock.calls.find(
      ([sql, status]) => sql.includes('SET status = ?, summary = ?') && status === 'publishing',
    );
    expect(publicationUpdate?.slice(4, 10)).toEqual([
      'checkpoint-provider',
      'checkpoint-model',
      'checkpoint-attempt-provider',
      'checkpoint-attempt-model',
      'grounded-card-generation',
      '1.4.0',
    ]);
  });

  it('fails a corrupt checkpoint once and allows an explicit clean retry', async () => {
    const { db, state } = createFakeDatabase(2);
    state.latestJobId = 'job-corrupt';
    state.jobStatus = 'failed';
    state.jobPurpose = 'smart-enhancement';
    state.jobGenerationKey = 'source-1:source-sha:smart-enhancement:grounded-card-generation:1.4.0';
    state.jobRequestId = 'generation-request-corrupt';
    state.jobAttemptCount = 1;
    state.candidateCheckpointJson = '{"checkpointVersion":1,"allCandidates":"damaged"}';
    mockGetDatabase.mockResolvedValue(db);
    mockReadGatewayConfig.mockReturnValue({ gatewayUrl: 'http://127.0.0.1:8790' });
    mockCreateGatewayProvider.mockReturnValue({ id: 'gemini', model: 'flash', generate: jest.fn() });

    await expect(enhanceDraftsForSource('source-1')).rejects.toThrow('restored safely');

    expect(mockRunBatchedGeneration).not.toHaveBeenCalled();
    expect(state.jobStatus).toBe('failed');
    expect(state.failureReason).toBe('invalid_provider_response');
    expect(state.candidateCheckpointJson).toBeNull();
    expect(state.sourceStatus).toBe('ready');
  });

  it('persists REVIEW candidates as held and does not publish them automatically', async () => {
    const { db, state } = createFakeDatabase();
    const reviewCandidate: GroundedCardCandidate = {
      ...localCandidate,
      evaluation: {
        ...localCandidate.evaluation!,
        medicalRisk: 'high',
        medicalVerificationStatus: 'authority_unavailable',
        publicationDisposition: 'REVIEW',
        reasonCodes: ['HIGH_RISK_UNVERIFIED'],
      },
    };
    mockGetDatabase.mockResolvedValue(db);
    mockReadGatewayConfig.mockReturnValue({ gatewayUrl: 'http://127.0.0.1:8790' });
    mockCreateGatewayProvider.mockReturnValue({ id: 'gemini', model: 'flash', generate: jest.fn() });
    mockRunBatchedGeneration.mockResolvedValue(remoteBatch([reviewCandidate]));

    const published = await enhanceDraftsForSource('source-1');

    expect(published).toBe(0);
    expect([...state.candidates.values()]).toEqual([
      expect.objectContaining({ publicationDisposition: 'REVIEW', status: 'pending' }),
    ]);
    expect(state.heldCandidateCount).toBe(1);
    expect(state.sourceStatus).toBe('review-ready');
    expect(state.activeCardCount).toBe(0);
  });

  it('replaces only local cards whose concept targets have selected Smart replacements', async () => {
    const { db } = createFakeDatabase(2);
    const concepts = extractConceptTargets([{
      id: 'segment-1',
      locator: 'Page 1',
      sectionPath: 'Definition',
      text: 'PCOS is an endocrine disorder.',
      startOffset: 0,
      endOffset: 30,
    }]);
    expect(concepts.length).toBeGreaterThan(0);
    const replacement = { ...localCandidate, targetId: concepts[0].id };
    mockGetDatabase.mockResolvedValue(db);
    mockReadGatewayConfig.mockReturnValue({ gatewayUrl: 'http://127.0.0.1:8790' });
    mockCreateGatewayProvider.mockReturnValue({ id: 'gemini', model: 'flash', generate: jest.fn() });
    mockRunBatchedGeneration.mockResolvedValue(remoteBatch([replacement]));

    await enhanceDraftsForSource('source-1');

    const trashLookup = db.getAllAsync.mock.calls.find(
      ([sql]: [string]) => sql.includes('SELECT cards.id, cards.note_id AS noteId'),
    );
    expect(trashLookup).toBeDefined();
    expect(trashLookup?.[0]).toContain('replacement_candidates.target_id IN (?)');
    expect(trashLookup?.slice(1)).toEqual(['source-1', concepts[0].id]);
  });

  it('reuses a completed equivalent Smart Enhancement without another provider request', async () => {
    const { db, state } = createFakeDatabase(2);
    state.latestJobId = 'job-completed';
    state.jobStatus = 'completed';
    state.jobPurpose = 'smart-enhancement';
    state.jobGenerationKey = 'source-1:source-sha:smart-enhancement:grounded-card-generation:1.4.0';
    state.jobRequestId = 'generation-request-completed';
    state.jobAttemptCount = 1;
    mockGetDatabase.mockResolvedValue(db);
    mockReadGatewayConfig.mockReturnValue({ gatewayUrl: 'http://127.0.0.1:8790' });
    mockCreateGatewayProvider.mockReturnValue({ id: 'gemini', model: 'flash', generate: jest.fn() });

    const published = await enhanceDraftsForSource('source-1');

    expect(published).toBe(2);
    expect(mockRunBatchedGeneration).not.toHaveBeenCalled();
    expect(state.generationJobInsertCount).toBe(0);
    expect(state.latestJobId).toBe('job-completed');
  });

  it('queues one durable Smart Enhancement for an equivalent source and prompt', async () => {
    const { db, state } = createFakeDatabase(2);
    mockGetDatabase.mockResolvedValue(db);

    const first = await queueSmartEnhancementForSource('source-1');
    const duplicate = await queueSmartEnhancementForSource('source-1');

    expect(first).toBe(true);
    expect(duplicate).toBe(false);
    expect(state.generationJobInsertCount).toBe(1);
    expect(state.jobStatus).toBe('queued');
    expect(state.jobPurpose).toBe('smart-enhancement');
    expect(state.jobAttemptCount).toBe(0);
    expect(state.jobGenerationKey).toBe(
      'source-1:source-sha:smart-enhancement:grounded-card-generation:1.4.0',
    );
    expect(state.sourceStatus).toBe('waiting-for-generation');
  });

  it('resumes a queued Smart Enhancement in place with stable request identity', async () => {
    const { db, state } = createFakeDatabase(2);
    state.latestJobId = 'job-queued';
    state.jobStatus = 'queued';
    state.jobPurpose = 'smart-enhancement';
    state.jobGenerationKey = 'source-1:source-sha:smart-enhancement:grounded-card-generation:1.4.0';
    state.jobRequestId = 'generation-request-stable';
    state.jobAttemptCount = 1;
    mockGetDatabase.mockResolvedValue(db);
    mockReadGatewayConfig.mockReturnValue({ gatewayUrl: 'http://127.0.0.1:8790' });
    mockCreateGatewayProvider.mockReturnValue({ id: 'gemini', model: 'flash', generate: jest.fn() });
    mockRunBatchedGeneration.mockRejectedValue(new BarionAIError(
      'rate_limited',
      'Provider quota exceeded.',
      { recoverable: true },
    ));

    await enhanceDraftsForSource('source-1');

    expect(mockRunBatchedGeneration).toHaveBeenCalledTimes(1);
    expect(state.generationJobInsertCount).toBe(0);
    expect(state.latestJobId).toBe('job-queued');
    expect(state.jobRequestId).toBe('generation-request-stable');
    expect(state.jobAttemptCount).toBe(2);
    expect(state.jobStatus).toBe('queued');
  });

  it('terminates an exhausted queued Smart Enhancement without calling provider', async () => {
    const { db, state } = createFakeDatabase(2);
    state.latestJobId = 'job-exhausted';
    state.jobStatus = 'queued';
    state.jobPurpose = 'smart-enhancement';
    state.jobGenerationKey = 'source-1:source-sha:smart-enhancement:grounded-card-generation:1.4.0';
    state.jobRequestId = 'generation-request-exhausted';
    state.jobAttemptCount = 3;
    mockGetDatabase.mockResolvedValue(db);
    mockReadGatewayConfig.mockReturnValue({ gatewayUrl: 'http://127.0.0.1:8790' });
    mockCreateGatewayProvider.mockReturnValue({ id: 'gemini', model: 'flash', generate: jest.fn() });

    const published = await enhanceDraftsForSource('source-1');

    expect(published).toBe(2);
    expect(mockRunBatchedGeneration).not.toHaveBeenCalled();
    expect(state.failureReason).toBe('retry_exhausted');
    expect(state.jobStatus).toBe('failed');
    expect(state.sourceStatus).toBe('ready');
  });

  it('resumes interrupted local work through local baseline instead of Smart Enhancement', async () => {
    const { db, state } = createFakeDatabase();
    state.latestJobId = 'job-local-queued';
    state.jobStatus = 'queued';
    state.jobPurpose = 'local-baseline';
    state.jobGenerationKey = 'source-1:source-sha:local-baseline:extractive-rules:extractive-v1';
    state.jobRequestId = 'generation-request-local';
    state.jobAttemptCount = 1;
    state.queuedJobs = [{ sourceId: 'source-1', purpose: 'local-baseline' }];
    mockGetDatabase.mockResolvedValue(db);
    mockGenerateLocalBaselineCards.mockResolvedValue({
      candidates: [localCandidate],
      provenance: {
        requestId: 'generation-request-local',
        generationMode: 'LOCAL_BASELINE',
        fallbackUsed: false,
        providerId: 'local-extractive',
        modelId: 'barion-extractive-rules',
        promptId: 'extractive-rules',
        promptVersion: 'extractive-v1',
        generatedAt: '2026-09-28T00:00:00.000Z',
        remoteCandidateCount: 0,
        durationMs: 1,
      },
    });

    const completed = await resumeQueuedGenerationJobs();

    expect(completed).toBe(1);
    expect(mockGenerateLocalBaselineCards).toHaveBeenCalledTimes(1);
    expect(mockReadGatewayConfig).not.toHaveBeenCalled();
    expect(mockRunBatchedGeneration).not.toHaveBeenCalled();
    expect(state.latestJobId).toBe('job-local-queued');
    expect(state.jobStatus).toBe('completed');
  });
});

function remoteBatch(candidates: GroundedCardCandidate[]): BatchGenerationSummary {
  return {
    allCandidates: candidates,
    allBatchResults: [{
      batchIndex: 0,
      candidates,
      conceptsAttempted: candidates.map((candidate) => candidate.targetId ?? candidate.question),
      conceptsCovered: candidates.map((candidate) => candidate.targetId).filter((value): value is string => Boolean(value)),
      generationResult: {
        candidates,
        provenance: {
          requestId: 'remote-request',
          providerRequestId: 'gemini-request-1',
          generationMode: 'REMOTE_AI' as const,
          fallbackUsed: false,
          providerId: 'gemini',
          modelId: 'flash',
          promptId: 'grounded-card-generation',
          promptVersion: '1.4.0',
          generatedAt: '2026-09-28T00:00:00.000Z',
          remoteCandidateCount: candidates.length,
          durationMs: 500,
        },
      },
    }],
    coverage: {
      coveredTargetIds: new Set(
        candidates.map((candidate) => candidate.targetId).filter((value): value is string => Boolean(value)),
      ),
      batchesCompleted: 1,
      totalCandidates: candidates.length,
      remoteCandidateCount: candidates.length,
      fallbackCandidateCount: 0,
      remoteAIUsed: true,
      anyFallback: false,
    },
    batchMetadata: {
      totalBatches: 1,
      batchesCompleted: 1,
      totalConcepts: candidates.length,
      criticalConceptCount: 0,
      highConceptCount: 0,
      coveredConceptCount: candidates.length,
      uncoveredCriticalCount: 0,
      uncoveredHighCount: 0,
      gapBatchUsed: false,
      repairAttemptedTargetCount: 0,
      repairedTargetCount: 0,
      missingTargetIds: [],
      batchDiagnostics: [],
      stoppedReason: 'all_concepts_covered' as const,
    },
  };
}
