import {
  describeGatewayCardQuality,
  evaluateGatewayCardQuality,
  shouldAutoPublishCandidate,
} from '@/ai/cardQuality';
import { readExpoPublicGatewayConfig } from '@/ai/config';
import { asBarionAIError, BarionAIError } from '@/ai/errors';
import {
  generateLocalBaselineCards,
  LOCAL_MODEL_ID,
  LOCAL_PROMPT_ID,
  LOCAL_PROMPT_VERSION,
  LOCAL_PROVIDER_ID,
} from '@/ai/generate';
import { createGatewayCardGenerationProvider } from '@/ai/gatewayProvider';
import { restoreGenerationCheckpoint, serializeGenerationCheckpoint } from '@/ai/generationCheckpoint';
import { createSupabaseAccessTokenProvider } from '@/auth/sessionProvider';
import { GROUNDED_CARD_PROMPT } from '@/ai/prompts';
import {
  runBatchedGeneration,
  type BatchGenerationSummary,
  type BatchMetadata,
} from '@/ai/batchGeneration';
import { isAutoStudyEligible, type PublicationDisposition } from '@/ai/publicationPolicy';
import type { GenerationMode, GroundedCardCandidate, GroundedCardGenerationResult } from '@/ai/types';
import { selectCandidatesForAutomaticStudy } from '@/ai/candidateSelection';
import { coveredTargetIds, resolveCandidateTargetId } from '@/ai/targetCoverage';
import { generationRetryDelayMs } from '@/ai/retryPolicy';
import { createId, nowIso } from '@/domain/ids';
import type { CandidateStatus, GeneratedCandidate, StudyCard } from '@/domain/types';
import {
  AUTO_PUBLISH_QUALITY_SCORE,
  createTargetedExtractiveDrafts,
} from '@/ingestion/drafts';
import { extractConceptTargets, selectSegmentsForConcept } from '@/ingestion/concepts';
import { type ParsedSegment } from '@/ingestion/types';
import { createInitialFsrsCard, schedulerVersion } from '@/scheduler/fsrs';
import { getDatabase } from '@/storage/database';
import { createStudyGuide } from '@/ingestion/studyGuide';
import {
  resolveRegeneratedCardTrash,
  runWriteTransaction,
  upsertSearchIndex,
  upsertSourceStudyGuide,
  type CountRow,
  type WritableDatabase,
} from './shared';

const SMART_PROVIDER_ID = 'barion-gateway';
const SMART_MODEL_UNCONFIGURED = 'smart-model-unconfigured';
const MAX_RESUMED_JOBS_PER_LAUNCH = 2;
const MAX_SMART_ENHANCEMENT_ATTEMPTS = 3;
const MAX_PUBLICATION_ATTEMPTS = 2;
let resumeQueuedJobsPromise: Promise<number> | null = null;

const inFlightGeneration = new Map<string, Promise<number>>();

type GenerationStrategy = 'local-baseline' | 'smart-enhancement';

export async function generateDraftsForSource(sourceId: string): Promise<number> {
  return runSourceGeneration(sourceId, 'local-baseline');
}

export async function generateLocalFirstStudySetForSource(sourceId: string): Promise<number> {
  const localCardCount = await generateDraftsForSource(sourceId);
  if (localCardCount <= 0) return localCardCount;

  const queued = await queueSmartEnhancementForSource(sourceId);
  if (queued) {
    void enhanceDraftsForSource(sourceId).catch((error) => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('barion.ai.automatic_enhancement_failed', error);
      }
    });
  }
  return localCardCount;
}

export async function enhanceDraftsForSource(sourceId: string): Promise<number> {
  return runSourceGeneration(sourceId, 'smart-enhancement');
}

export async function queueSmartEnhancementForSource(sourceId: string): Promise<boolean> {
  const db = await getDatabase();
  const source = await db.getFirstAsync<{
    sha256: string;
    defaultDeckId: string | null;
    sourceCardCount: number;
  }>(
    `SELECT sources.sha256, sources.default_deck_id AS defaultDeckId,
            (SELECT COUNT(*) FROM cards JOIN notes ON notes.id = cards.note_id
             WHERE notes.source_id = sources.id AND cards.deleted_at IS NULL) AS sourceCardCount
     FROM sources
     WHERE sources.id = ? AND sources.deleted_at IS NULL AND sources.archived_at IS NULL`,
    sourceId,
  );
  if (!source?.defaultDeckId || source.sha256 === 'built-in-curated-demo-v1' || source.sourceCardCount <= 0) {
    return false;
  }

  const generationKey = buildGenerationKey(
    sourceId,
    source.sha256,
    'smart-enhancement',
    GROUNDED_CARD_PROMPT.id,
    GROUNDED_CARD_PROMPT.version,
  );
  const queuedAt = nowIso();
  let queued = false;
  await runWriteTransaction(db, async (txn) => {
    const existing = await txn.getFirstAsync<{ status: string }>(
      `SELECT status
       FROM generation_jobs
       WHERE generation_key = ?
         AND status IN ('queued', 'running', 'publishing', 'completed')
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
      generationKey,
    );
    if (existing) return;

    const activeJob = await txn.getFirstAsync<{ id: string }>(
      `SELECT id
       FROM generation_jobs
       WHERE source_id = ? AND status IN ('running', 'publishing')
       LIMIT 1`,
      sourceId,
    );
    if (activeJob) return;

    await txn.runAsync(
      `INSERT INTO generation_jobs
       (id, source_id, deck_id, status, summary, generation_mode, provider_id, model_id,
        attempted_provider_id, attempted_model_id, prompt_id, prompt_version, purpose, generation_key,
        request_id, remote_candidate_count, published_card_count, held_candidate_count, duration_ms,
        fallback_reason, fallback_used, failure_reason, attempt_count, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', ?, NULL, ?, ?, NULL, NULL, ?, ?, 'smart-enhancement', ?, ?,
               0, 0, 0, 0, NULL, 0, NULL, 0, ?, ?, ?)`,
      createId('job'),
      sourceId,
      source.defaultDeckId,
      'Initial source-matched cards are ready. Smart Enhancement is queued.',
      SMART_PROVIDER_ID,
      SMART_MODEL_UNCONFIGURED,
      GROUNDED_CARD_PROMPT.id,
      GROUNDED_CARD_PROMPT.version,
      generationKey,
      createId('generation-request'),
      queuedAt,
      queuedAt,
      queuedAt,
    );
    await txn.runAsync(
      `UPDATE sources
       SET status = 'waiting-for-generation', ingestion_error = NULL
       WHERE id = ?`,
      sourceId,
    );
    queued = true;
  });
  return queued;
}

function runSourceGeneration(sourceId: string, strategy: GenerationStrategy): Promise<number> {
  const active = inFlightGeneration.get(sourceId);
  if (active) return active;

  const promise = generateDraftsForSourceInternal(sourceId, strategy).finally(() => {
    inFlightGeneration.delete(sourceId);
  });
  inFlightGeneration.set(sourceId, promise);
  return promise;
}

async function generateDraftsForSourceInternal(
  sourceId: string,
  strategy: GenerationStrategy,
): Promise<number> {
  const db = await getDatabase();
  const source = await db.getFirstAsync<{ title: string; sha256: string; defaultDeckId: string | null; sourceCardCount: number }>(
    `SELECT sources.title, sources.sha256, sources.default_deck_id AS defaultDeckId,
            (SELECT COUNT(*) FROM cards JOIN notes ON notes.id = cards.note_id
             WHERE notes.source_id = sources.id AND cards.deleted_at IS NULL) AS sourceCardCount
     FROM sources WHERE sources.id = ? AND sources.deleted_at IS NULL AND sources.archived_at IS NULL`,
    sourceId,
  );
  if (!source || !source.defaultDeckId) {
    throw new Error('Source not found.');
  }
  if (source.sha256 === 'built-in-curated-demo-v1') {
    return Number(source.sourceCardCount ?? 0);
  }

  const rows = await db.getAllAsync<ParsedSegment>(
    `SELECT
       id,
       locator,
       section_path AS sectionPath,
       text,
       COALESCE(start_offset, 0) AS startOffset,
       COALESCE(end_offset, length(text)) AS endOffset
     FROM source_segments
     WHERE source_id = ?
     ORDER BY created_at ASC`,
    sourceId,
  );

  if (!rows.length) {
    throw new Error('Extract this source before creating drafts.');
  }

  const studyGuide = createStudyGuide(rows, source.title);
  let requestId = createId('generation-request');
  const conceptTargets = extractConceptTargets(rows);
  const conceptAwareSegments = buildConceptFirstSegments(rows, conceptTargets);
  let jobId = createId('job');
  const startedAt = nowIso();
  const startedAtMs = Date.now();
  let gatewayConfigError: string | undefined;
  let provider = null;
  if (strategy === 'smart-enhancement') {
    try {
      const config = readExpoPublicGatewayConfig();
      provider = config
        ? createGatewayCardGenerationProvider(config, fetch, createSupabaseAccessTokenProvider())
        : null;
    } catch (error) {
      gatewayConfigError = asBarionAIError(error).code;
    }
  }

  const localBaseline = strategy === 'local-baseline';
  const initialProviderId = localBaseline ? LOCAL_PROVIDER_ID : provider?.id ?? SMART_PROVIDER_ID;
  const initialModelId = localBaseline ? LOCAL_MODEL_ID : provider?.model ?? SMART_MODEL_UNCONFIGURED;
  const initialPromptId = localBaseline ? LOCAL_PROMPT_ID : GROUNDED_CARD_PROMPT.id;
  const initialPromptVersion = localBaseline ? LOCAL_PROMPT_VERSION : GROUNDED_CARD_PROMPT.version;
  const initialFallbackReason = localBaseline
    ? null
    : gatewayConfigError ?? (provider ? null : 'gateway_not_configured');
  const generationKey = buildGenerationKey(
    sourceId,
    source.sha256,
    strategy,
    initialPromptId,
    initialPromptVersion,
  );
  let jobAttemptCount = 1;
  let skipGeneration = false;
  let retryExhausted = false;
  let candidateCheckpointJson: string | null = null;
  await runWriteTransaction(db, async (txn) => {
    const activeJob = await txn.getFirstAsync<{ id: string }>(
      `SELECT id
       FROM generation_jobs
       WHERE source_id = ? AND status IN ('running', 'publishing')
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
      sourceId,
    );
    if (activeJob) {
      skipGeneration = true;
      return;
    }
    const equivalentJob = await txn.getFirstAsync<{
      id: string;
      requestId: string | null;
      status: string;
      attemptCount: number;
      candidateCheckpointJson: string | null;
    }>(
      `SELECT id, request_id AS requestId, status,
              COALESCE(attempt_count, 0) AS attemptCount,
              candidate_checkpoint_json AS candidateCheckpointJson
       FROM generation_jobs
       WHERE generation_key = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT 1`,
      generationKey,
    );
    if (equivalentJob?.status === 'completed' && (strategy === 'smart-enhancement' || source.sourceCardCount > 0)) {
      skipGeneration = true;
      return;
    }
    if (
      !localBaseline
      && equivalentJob?.candidateCheckpointJson
      && ['queued', 'failed'].includes(equivalentJob.status)
    ) {
      jobId = equivalentJob.id;
      requestId = equivalentJob.requestId ?? requestId;
      jobAttemptCount = Math.max(1, Number(equivalentJob.attemptCount ?? 1));
      candidateCheckpointJson = equivalentJob.candidateCheckpointJson;
      await txn.runAsync(
        "UPDATE sources SET status = 'waiting-for-generation', ingestion_error = NULL WHERE id = ?",
        sourceId,
      );
      await txn.runAsync(
        `UPDATE generation_jobs
         SET status = 'publishing', summary = 'Resuming validated cards without another AI request.',
             failure_reason = NULL, next_attempt_at = NULL, updated_at = ?
         WHERE id = ? AND status IN ('queued', 'failed')`,
        startedAt,
        jobId,
      );
      return;
    }
    if (equivalentJob?.status === 'queued') {
      if (!localBaseline && equivalentJob.attemptCount >= MAX_SMART_ENHANCEMENT_ATTEMPTS) {
        jobId = equivalentJob.id;
        retryExhausted = true;
        return;
      }
      jobId = equivalentJob.id;
      requestId = equivalentJob.requestId ?? requestId;
      jobAttemptCount = Number(equivalentJob.attemptCount ?? 0) + 1;
      const resumedSourceStatus = source.sourceCardCount > 0 ? 'waiting-for-generation' : 'generating';
      await txn.runAsync(
        'UPDATE sources SET status = ?, ingestion_error = NULL WHERE id = ?',
        resumedSourceStatus,
        sourceId,
      );
      await txn.runAsync(
        `UPDATE generation_jobs
         SET status = 'running', summary = 'Preparing source-grounded study cards.',
             generation_mode = NULL, provider_id = ?, model_id = ?,
             attempted_provider_id = ?, attempted_model_id = ?, prompt_id = ?, prompt_version = ?,
             request_id = ?, provider_request_id = NULL, input_tokens = NULL, output_tokens = NULL,
             remote_candidate_count = 0, published_card_count = 0, held_candidate_count = 0,
             duration_ms = 0, fallback_reason = ?, fallback_used = 0, failure_reason = NULL,
             batch_metadata_json = NULL, attempt_count = ?, next_attempt_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'queued'`,
        initialProviderId,
        initialModelId,
        localBaseline ? null : provider?.id ?? null,
        localBaseline ? null : provider?.model ?? null,
        initialPromptId,
        initialPromptVersion,
        requestId,
        initialFallbackReason,
        jobAttemptCount,
        startedAt,
        jobId,
      );
      return;
    }
    await txn.runAsync(
      `UPDATE generation_jobs
       SET status = 'superseded', updated_at = ?
       WHERE source_id = ? AND status = 'queued'
         AND (generation_key IS NULL OR generation_key != ?)`,
      startedAt,
      sourceId,
      generationKey,
    );
    const initialSourceStatus = source.sourceCardCount > 0 ? 'waiting-for-generation' : 'generating';
    await txn.runAsync(
      "UPDATE sources SET status = ?, ingestion_error = NULL WHERE id = ?",
      initialSourceStatus,
      sourceId,
    );
    await txn.runAsync(
      `INSERT INTO generation_jobs
       (id, source_id, deck_id, status, summary, generation_mode, provider_id, model_id,
        attempted_provider_id, attempted_model_id, prompt_id, prompt_version, purpose, generation_key, request_id,
        remote_candidate_count, published_card_count, held_candidate_count, duration_ms,
        fallback_reason, fallback_used, failure_reason, attempt_count, next_attempt_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      jobId,
      sourceId,
      source.defaultDeckId,
      'running',
      'Preparing source-grounded study cards.',
      null,
      initialProviderId,
      initialModelId,
      localBaseline ? null : provider?.id ?? null,
      localBaseline ? null : provider?.model ?? null,
      initialPromptId,
      initialPromptVersion,
      strategy,
      generationKey,
      requestId,
      0,
      0,
      0,
      0,
      initialFallbackReason,
      0,
      null,
      jobAttemptCount,
      null,
      startedAt,
      startedAt,
    );
  });

  if (skipGeneration) {
    return Number(source.sourceCardCount ?? 0);
  }
  if (retryExhausted) {
    await markGenerationJobFailed(
      db,
      jobId,
      sourceId,
      'retry_exhausted',
      startedAtMs,
      nowIso(),
    );
    return Number(source.sourceCardCount ?? 0);
  }

  if (!localBaseline && !provider && !candidateCheckpointJson) {
    await markGenerationJobFailed(
      db,
      jobId,
      sourceId,
      initialFallbackReason ?? 'gateway_not_configured',
      startedAtMs,
      nowIso(),
    );
    return Number(source.sourceCardCount ?? 0);
  }

  let batchGenerationResult: BatchGenerationSummary;
  let checkpointRestoreFailed = false;
  try {
    batchGenerationResult = candidateCheckpointJson
      ? (() => {
          try {
            return restoreGenerationCheckpoint(candidateCheckpointJson);
          } catch {
            checkpointRestoreFailed = true;
            throw new BarionAIError(
              'invalid_provider_response',
              'Saved generation candidates could not be restored safely.',
              { recoverable: false },
            );
          }
        })()
      : localBaseline
      ? await buildLocalBaselineBatch(
          requestId,
          sourceId,
          source.title,
          rows,
          conceptTargets,
        )
      : await runBatchedGeneration(
          provider!,
          requestId,
          sourceId,
          source.title,
          conceptTargets,
          conceptAwareSegments,
          {
            onBatchComplete: async () => {
              // checkpointing happens in runBatchedGeneration in a non-persistent way for now.
            },
          },
        );
  } catch (error) {
    const failure = asBarionAIError(error);
    const completedAt = nowIso();
    if (!localBaseline && failure.recoverable && jobAttemptCount < MAX_SMART_ENHANCEMENT_ATTEMPTS) {
      await markGenerationJobQueued(db, jobId, sourceId, failure.code, startedAtMs, {
        providerRequestId: failure.providerRequestId,
        inputTokens: failure.inputTokens,
        outputTokens: failure.outputTokens,
        remoteCandidateCount: failure.remoteCandidateCount,
      });
      logGenerationDiagnostics({
        requestId,
        generationMode: 'FAILED',
        fallbackUsed: false,
        providerId: initialProviderId,
        modelId: initialModelId,
        attemptedProviderId: provider?.id ?? null,
        attemptedModelId: provider?.model ?? null,
        providerRequestId: failure.providerRequestId ?? null,
        fallbackReason: null,
        failureReason: failure.code,
        remoteCandidateCount: failure.remoteCandidateCount ?? 0,
        publishedCardCount: 0,
        heldCandidateCount: 0,
        durationMs: Date.now() - startedAtMs,
      });
      return Number(source.sourceCardCount ?? 0);
    }
    await markGenerationJobFailed(db, jobId, sourceId, failure.code, startedAtMs, completedAt, {
      providerRequestId: failure.providerRequestId,
      inputTokens: failure.inputTokens,
      outputTokens: failure.outputTokens,
      remoteCandidateCount: failure.remoteCandidateCount,
      discardCandidateCheckpoint: checkpointRestoreFailed,
    });
    logGenerationDiagnostics({
      requestId,
      generationMode: 'FAILED',
      fallbackUsed: false,
      providerId: initialProviderId,
      modelId: initialModelId,
      attemptedProviderId: provider?.id ?? null,
      attemptedModelId: provider?.model ?? null,
      providerRequestId: failure.providerRequestId ?? null,
      fallbackReason: null,
      failureReason: failure.code,
      remoteCandidateCount: failure.remoteCandidateCount ?? 0,
      publishedCardCount: 0,
      heldCandidateCount: 0,
      durationMs: Date.now() - startedAtMs,
    });
    throw error;
  }

  const generatedDrafts = batchGenerationResult.allCandidates;
  const batchProvenance = summarizeBatchProvenance(batchGenerationResult.allBatchResults, initialFallbackReason);
  const completedProviderId = batchProvenance.providerId ?? initialProviderId;
  const completedModelId = batchProvenance.modelId ?? initialModelId;
  const completedAttemptedProviderId = batchProvenance.attemptedProviderId
    ?? (localBaseline ? null : provider?.id ?? null);
  const completedAttemptedModelId = batchProvenance.attemptedModelId
    ?? (localBaseline ? null : provider?.model ?? null);
  const completedPromptId = batchProvenance.promptId ?? initialPromptId;
  const completedPromptVersion = batchProvenance.promptVersion ?? initialPromptVersion;
  const generationMode: GenerationMode = localBaseline ? 'LOCAL_BASELINE' : 'REMOTE_AI';
  const batchMetadata: BatchMetadata = batchGenerationResult.batchMetadata;
  const scoredDrafts = generatedDrafts.map((candidate) => ({
    candidate,
    qualityScore: candidate.qualityScore ?? evaluateGatewayCardQuality(candidate),
  }));
  const selection = selectCandidatesForAutomaticStudy(scoredDrafts, AUTO_PUBLISH_QUALITY_SCORE, conceptTargets);
  const selectedTargetIds = new Set(selection.selected.map(({ candidate }) => (
    resolveCandidateTargetId(candidate, conceptTargets)
  )).filter((targetId): targetId is string => Boolean(targetId)));
  const selectedTargetCoverageRate = conceptTargets.length
    ? selectedTargetIds.size / conceptTargets.length
    : selection.selected.length ? 1 : 0;
  const coreCoverageReady = selectedTargetCoverageRate >= 0.9;
  const dispositionCounts = { PUBLISH: 0, SANITIZE: 0, REVIEW: 0, REJECT: 0, UNEVALUATED: 0 };
  const reasonCodeCounts: Record<string, number> = {};
  for (const { candidate } of scoredDrafts) {
    const disposition = candidate.evaluation?.publicationDisposition ?? 'UNEVALUATED';
    dispositionCounts[disposition] += 1;
    for (const reasonCode of candidate.evaluation?.reasonCodes ?? []) {
      reasonCodeCounts[reasonCode] = (reasonCodeCounts[reasonCode] ?? 0) + 1;
    }
  }
  batchMetadata.selection = {
    rawCandidateCount: scoredDrafts.length,
    remoteCandidateCount: batchGenerationResult.coverage.remoteCandidateCount,
    fallbackCandidateCount: batchGenerationResult.coverage.fallbackCandidateCount,
    publishableCandidateCount: scoredDrafts.filter(({ candidate }) => (
      candidate.evaluation && isAutoStudyEligible(candidate.evaluation.publicationDisposition)
    )).length,
    selectedCandidateCount: selection.selected.length,
    targetCoverageRate: selectedTargetCoverageRate,
    dispositionCounts,
    droppedUnsafeCount: selection.dropped.filter(({ reason }) => reason === 'unsafe').length,
    droppedLowQualityCount: selection.dropped.filter(({ reason }) => reason === 'low-quality').length,
    droppedDuplicateCount: selection.dropped.filter(({ reason }) => reason === 'duplicate').length,
    droppedBudgetCount: selection.dropped.filter(({ reason }) => reason === 'budget').length,
    publicationFailureCount: 0,
    reasonCodeCounts,
  };
  if (!localBaseline && generatedDrafts.length) {
    const checkpoint = serializeGenerationCheckpoint(batchGenerationResult);
    await runWriteTransaction(db, async (txn) => {
      await txn.runAsync(
        `UPDATE generation_jobs
         SET status = 'publishing', summary = 'Validated cards are saved and ready to publish.',
             generation_mode = ?, provider_id = ?, model_id = ?,
             attempted_provider_id = ?, attempted_model_id = ?,
             provider_request_id = ?, input_tokens = ?, output_tokens = ?,
             remote_candidate_count = ?, batch_metadata_json = ?,
             candidate_checkpoint_json = ?, updated_at = ?
         WHERE id = ?`,
        generationMode,
        completedProviderId,
        completedModelId,
        completedAttemptedProviderId,
        completedAttemptedModelId,
        batchProvenance.providerRequestId,
        batchProvenance.inputTokens,
        batchProvenance.outputTokens,
        batchGenerationResult.coverage.remoteCandidateCount,
        JSON.stringify(batchMetadata),
        checkpoint,
        nowIso(),
        jobId,
      );
    });
  }
  const selectedCandidates = new Set(selection.selected.map(({ candidate }) => candidate));
  const dropReasons = new Map(selection.dropped.map(({ candidate, reason }) => [candidate, reason]));
  const now = nowIso();
  const candidateIds: string[] = [];
  let publishedCardCount = 0;
  let heldCandidateCount = 0;
  let publicationFailureCount = 0;

  try {
    while (true) {
      candidateIds.length = 0;
      publishedCardCount = 0;
      try {
        await runWriteTransaction(db, async (txn) => {
      const latestJob = await txn.getFirstAsync<{ id: string }>(
        `SELECT id
         FROM generation_jobs
         WHERE source_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
        sourceId,
      );
      if (latestJob?.id !== jobId) {
        throw new Error('A newer deck preparation replaced this request.');
      }

      await upsertSourceStudyGuide(txn, sourceId, studyGuide, now);
      await txn.runAsync(
        `UPDATE generation_jobs
         SET status = ?, summary = ?, generation_mode = ?, provider_id = ?, model_id = ?,
             attempted_provider_id = ?, attempted_model_id = ?, prompt_id = ?, prompt_version = ?,
             provider_request_id = ?, input_tokens = ?, output_tokens = ?, fallback_reason = ?, fallback_used = ?,
             remote_candidate_count = ?, published_card_count = 0, held_candidate_count = ?,
             duration_ms = ?, failure_reason = ?, batch_metadata_json = ?, updated_at = ?
         WHERE id = ?`,
        generatedDrafts.length ? 'publishing' : 'failed',
        generatedDrafts.length
          ? `Selecting the strongest source-grounded cards for automatic study.`
          : 'Barion could not create usable study cards from this material.',
        generatedDrafts.length ? generationMode : 'FAILED',
        completedProviderId,
        completedModelId,
        completedAttemptedProviderId,
        completedAttemptedModelId,
        completedPromptId,
        completedPromptVersion,
        batchProvenance.providerRequestId,
        batchProvenance.inputTokens,
        batchProvenance.outputTokens,
        batchGenerationResult.coverage.anyFallback ? batchProvenance.fallbackReason : null,
        batchGenerationResult.coverage.anyFallback ? 1 : 0,
        batchGenerationResult.coverage.remoteCandidateCount,
        0,
        Date.now() - startedAtMs,
        generatedDrafts.length ? null : 'no_usable_candidates',
        JSON.stringify(batchMetadata),
        now,
        jobId,
      );

      for (const { candidate: draft, qualityScore } of scoredDrafts) {
        const candidateId = createId('candidate');
        const localExtractive = generationMode === 'LOCAL_BASELINE';
        const baseQualityNotes = localExtractive
          ? draft.qualityNotes ?? `Automated check score ${Math.round(qualityScore * 100)}% · deterministic source-matched card.`
          : describeGatewayCardQuality(draft, qualityScore);
        const selected = selectedCandidates.has(draft)
          && draft.evaluation
          && isAutoStudyEligible(draft.evaluation.publicationDisposition)
          && shouldAutoPublishCandidate(qualityScore, localExtractive, AUTO_PUBLISH_QUALITY_SCORE);
        const dropReason = dropReasons.get(draft);
        const publicationDisposition = draft.evaluation?.publicationDisposition ?? 'REVIEW';
        const heldForReview = !selected && publicationDisposition === 'REVIEW';
        const qualityNotes = selected
          ? baseQualityNotes
          : heldForReview
            ? `${baseQualityNotes} Held for review: automatic publication requirements were not met.`
            : `${baseQualityNotes} Omitted automatically: ${dropReason ?? 'quality gate'}.`;
        if (selected) {
          candidateIds.push(candidateId);
        }
        const originalCandidate = draft.evaluation?.originalCandidate ?? {
          segmentId: draft.segmentId,
          locator: draft.locator,
          cardType: draft.cardType,
          question: draft.question,
          answer: draft.answer,
          learningObjective: draft.learningObjective,
          evidenceText: draft.evidenceText,
          evidenceSpan: draft.evidenceSpan,
        };
        const verificationStatus = candidateVerificationStatus(draft, localExtractive);
        const supportScore = candidateSupportScore(draft);
        await txn.runAsync(
          `INSERT INTO generated_candidates
           (id, job_id, target_id, segment_id, card_type, learning_objective, quality_score, quality_notes, question, answer, evidence_text, locator, evidence_span_json, evaluation_json, original_candidate_json, publication_disposition, evaluation_version, policy_version, sanitization_reason, verification_status, support_score, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          candidateId,
          jobId,
          draft.targetId ?? null,
          draft.segmentId,
          draft.cardType,
          draft.learningObjective,
          qualityScore,
          qualityNotes,
          draft.question,
          draft.answer,
          draft.evidenceText,
          draft.locator,
          draft.evidenceSpan ? JSON.stringify(draft.evidenceSpan) : null,
          draft.evaluation ? JSON.stringify(draft.evaluation) : null,
          JSON.stringify(originalCandidate),
          publicationDisposition,
          draft.evaluation?.evaluationVersion ?? 'legacy',
          draft.evaluation?.policyVersion ?? 'legacy',
          draft.evaluation?.sanitization?.reason ?? null,
          verificationStatus,
          supportScore,
          selected || heldForReview ? 'pending' : 'rejected',
          now,
        );
      }

      if (!generatedDrafts.length) {
        const existingCards = await txn.getFirstAsync<CountRow>(
          `SELECT COUNT(*) AS count
           FROM cards
           JOIN notes ON notes.id = cards.note_id
           WHERE notes.source_id = ? AND cards.deleted_at IS NULL`,
          sourceId,
        );
        const hasExistingCards = Number(existingCards?.count ?? 0) > 0;
        await txn.runAsync(
          `UPDATE sources SET status = ?, ingestion_error = ? WHERE id = ?`,
          hasExistingCards ? 'ready' : 'failed',
          hasExistingCards
            ? null
            : 'Barion could not create usable study cards from this material. Your existing cards remain available.',
          sourceId,
        );
        return;
      }

      if (candidateIds.length) {
        await trashUntouchedAutoCardsForRegeneration(
          txn,
          sourceId,
          source.title,
          localBaseline || !conceptTargets.length ? undefined : [...selectedTargetIds],
        );
      }
      for (const candidateId of candidateIds) {
        await approveCandidateUsingDatabase(
          txn,
          candidateId,
          source.defaultDeckId!,
          true,
          true,
          false,
        );
      }
      publishedCardCount = await generationCandidateCount(txn, jobId, 'approved');
      heldCandidateCount = await generationCandidateCount(txn, jobId, 'held');
      await resolveRegeneratedCardTrash(txn, sourceId);
      const activeCards = await txn.getFirstAsync<CountRow>(
        `SELECT COUNT(*) AS count
         FROM cards
         JOIN notes ON notes.id = cards.note_id
         WHERE notes.source_id = ? AND cards.deleted_at IS NULL`,
        sourceId,
      );
      const hasStudyCards = Number(activeCards?.count ?? 0) > 0;
      const omittedCount = generatedDrafts.length - candidateIds.length;
      const coverageNote = !coreCoverageReady && conceptTargets.length
        ? ` (${Math.round(selectedTargetCoverageRate * 100)}% core coverage)`
        : '';

      await txn.runAsync(
        `UPDATE generation_jobs
         SET status = 'completed', summary = ?, published_card_count = ?, held_candidate_count = ?,
              failure_reason = ?, candidate_checkpoint_json = NULL, updated_at = ?
         WHERE id = ?`,
        publishedCardCount
          ? `${publishedCardCount} strong cards are ready to study${coverageNote}${omittedCount ? `; ${omittedCount} unsafe or redundant candidates were omitted.` : '.'}`
          : 'No new candidate passed the automatic safety and quality gates.',
        publishedCardCount,
        heldCandidateCount,
        publishedCardCount ? null : 'no_publishable_candidates',
        nowIso(),
        jobId,
      );
      await txn.runAsync(
        `UPDATE sources SET status = ?, ingestion_error = ? WHERE id = ?`,
        hasStudyCards ? 'ready' : heldCandidateCount ? 'review-ready' : 'action-required',
        hasStudyCards
          ? null
          : heldCandidateCount
            ? 'No card was safe to publish automatically. Review the held candidates before studying.'
            : 'No trustworthy study cards could be created from this file. Try a clearer source.',
        sourceId,
      );
        });
        break;
      } catch (error) {
        const committedJob = await db.getFirstAsync<{ status: string; publishedCardCount: number }>(
          `SELECT status, published_card_count AS publishedCardCount
           FROM generation_jobs
           WHERE id = ?`,
          jobId,
        );
        if (committedJob?.status === 'completed') {
          publishedCardCount = Number(committedJob.publishedCardCount ?? 0);
          break;
        }
        publicationFailureCount += 1;
        if (batchMetadata.selection) {
          batchMetadata.selection.publicationFailureCount = publicationFailureCount;
        }
        if (
          publicationFailureCount >= MAX_PUBLICATION_ATTEMPTS
          || (error instanceof Error && error.message === 'A newer deck preparation replaced this request.')
        ) {
          throw error;
        }
      }
    }

    if (!generatedDrafts.length) {
      logGenerationDiagnostics({
        requestId,
        generationMode: 'FAILED',
        fallbackUsed: batchGenerationResult.coverage.anyFallback,
        providerId: completedProviderId,
        modelId: completedModelId,
        attemptedProviderId: completedAttemptedProviderId,
        attemptedModelId: completedAttemptedModelId,
        providerRequestId: batchProvenance.providerRequestId,
        fallbackReason: batchProvenance.fallbackReason,
        failureReason: 'no_usable_candidates',
        remoteCandidateCount: batchGenerationResult.coverage.remoteCandidateCount,
        publishedCardCount: 0,
        heldCandidateCount: 0,
        durationMs: Date.now() - startedAtMs,
        selection: batchMetadata.selection,
      });
      return 0;
    }

  } catch (error) {
    const failure = asBarionAIError(error);
    const completedAt = nowIso();
    await markGenerationJobFailed(db, jobId, sourceId, failure.code, startedAtMs, completedAt, {
      providerRequestId: batchProvenance.providerRequestId,
      inputTokens: batchProvenance.inputTokens,
      outputTokens: batchProvenance.outputTokens,
      remoteCandidateCount: batchGenerationResult.coverage.remoteCandidateCount,
      batchMetadata,
    });
    logGenerationDiagnostics({
      requestId,
      generationMode: 'FAILED',
      fallbackUsed: batchGenerationResult.coverage.anyFallback,
      providerId: completedProviderId,
      modelId: completedModelId,
      attemptedProviderId: completedAttemptedProviderId,
      attemptedModelId: completedAttemptedModelId,
      providerRequestId: batchProvenance.providerRequestId,
      fallbackReason: batchGenerationResult.coverage.anyFallback ? batchProvenance.fallbackReason : null,
      failureReason: failure.code,
      remoteCandidateCount: batchGenerationResult.coverage.remoteCandidateCount,
      publishedCardCount: await generationCandidateCount(db, jobId, 'approved'),
      heldCandidateCount: await generationCandidateCount(db, jobId, 'held'),
      durationMs: Date.now() - startedAtMs,
      selection: batchMetadata.selection,
    });
    throw error;
  }

  logGenerationDiagnostics({
    requestId,
    generationMode,
    fallbackUsed: batchGenerationResult.coverage.anyFallback,
    providerId: completedProviderId,
    modelId: completedModelId,
    attemptedProviderId: completedAttemptedProviderId,
    attemptedModelId: completedAttemptedModelId,
    providerRequestId: batchProvenance.providerRequestId,
    fallbackReason: batchGenerationResult.coverage.anyFallback ? batchProvenance.fallbackReason : null,
    failureReason: publishedCardCount || !batchGenerationResult.coverage.remoteCandidateCount
      ? null
      : 'no_publishable_candidates',
    remoteCandidateCount: batchGenerationResult.coverage.remoteCandidateCount,
    publishedCardCount,
    heldCandidateCount,
    durationMs: Date.now() - startedAtMs,
    selection: batchMetadata.selection,
  });

  return publishedCardCount;
}

async function buildLocalBaselineBatch(
  requestId: string,
  sourceId: string,
  sourceTitle: string,
  segments: ParsedSegment[],
  conceptTargets: ReturnType<typeof extractConceptTargets>,
): Promise<BatchGenerationSummary> {
  const generationResult = await generateLocalBaselineCards(
    {
      requestId,
      sourceId,
      sourceTitle,
      maxCandidates: 56,
      conceptTargets,
      segments: segments.map((segment) => ({
        segmentId: segment.id,
        locator: segment.locator,
        sectionPath: segment.sectionPath,
        text: segment.text,
      })),
    },
    () => createTargetedExtractiveDrafts(segments, conceptTargets),
  );
  const coveredIds = coveredTargetIds(
    generationResult.candidates,
    conceptTargets,
    (candidate) => candidate.evaluation?.publicationDisposition === 'PUBLISH',
  );
  const covered = new Set(coveredIds);
  const missingTargetIds = conceptTargets
    .filter((concept) => !covered.has(concept.id))
    .map((concept) => concept.id);
  const conceptsCovered = conceptTargets
    .filter((concept) => covered.has(concept.id))
    .map((concept) => concept.term);

  return {
    allBatchResults: [{
      batchIndex: 0,
      candidates: generationResult.candidates,
      generationResult,
      conceptsAttempted: conceptTargets.map((concept) => concept.term),
      conceptsCovered,
    }],
    allCandidates: generationResult.candidates,
    coverage: {
      coveredTargetIds: covered,
      batchesCompleted: 1,
      totalCandidates: generationResult.candidates.length,
      remoteCandidateCount: 0,
      fallbackCandidateCount: 0,
      remoteAIUsed: false,
      anyFallback: false,
    },
    batchMetadata: {
      totalBatches: 1,
      batchesCompleted: 1,
      totalConcepts: conceptTargets.length,
      criticalConceptCount: conceptTargets.filter((concept) => concept.importance === 'critical').length,
      highConceptCount: conceptTargets.filter((concept) => concept.importance === 'high').length,
      coveredConceptCount: covered.size,
      uncoveredCriticalCount: conceptTargets.filter((concept) => (
        concept.importance === 'critical' && !covered.has(concept.id)
      )).length,
      uncoveredHighCount: conceptTargets.filter((concept) => (
        concept.importance === 'high' && !covered.has(concept.id)
      )).length,
      gapBatchUsed: false,
      repairAttemptedTargetCount: 0,
      repairedTargetCount: 0,
      missingTargetIds,
      batchDiagnostics: [{
        batchIndex: 0,
        attemptedTargetCount: conceptTargets.length,
        coveredTargetCount: covered.size,
        candidateCount: generationResult.candidates.length,
        remoteCandidateCount: 0,
        fallbackUsed: false,
      }],
      stoppedReason: conceptTargets.length === 0
        ? 'no_concepts'
        : missingTargetIds.length === 0
          ? 'all_concepts_covered'
          : 'max_batches_reached',
    },
  };
}

type GenerationDiagnostic = {
  requestId: string;
  generationMode: GenerationMode;
  fallbackUsed: boolean;
  providerId: string;
  modelId: string;
  attemptedProviderId: string | null;
  attemptedModelId: string | null;
  providerRequestId: string | null;
  fallbackReason: string | null;
  failureReason: string | null;
  remoteCandidateCount: number;
  publishedCardCount: number;
  heldCandidateCount: number;
  durationMs: number;
  selection?: BatchMetadata['selection'];
};

type GenerationFailureEvidence = {
  providerRequestId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  remoteCandidateCount?: number;
  batchMetadata?: BatchMetadata;
  discardCandidateCheckpoint?: boolean;
};

function logGenerationDiagnostics(diagnostic: GenerationDiagnostic) {
  if (process.env.NODE_ENV !== 'development') return;
  console.info('barion.ai.generation', diagnostic);
}

async function generationCandidateCount(
  db: WritableDatabase,
  jobId: string,
  kind: 'approved' | 'held',
) {
  const countExpression = kind === 'approved'
    ? "COUNT(DISTINCT COALESCE(published_card_id, id))"
    : 'COUNT(*)';
  const statusClause = kind === 'approved' ? "status = 'approved'" : "status = 'pending'";
  const result = await db.getFirstAsync<CountRow>(
    `SELECT ${countExpression} AS count FROM generated_candidates WHERE job_id = ? AND ${statusClause}`,
    jobId,
  );
  return Number(result?.count ?? 0);
}

async function markGenerationJobFailed(
  db: WritableDatabase,
  jobId: string,
  sourceId: string,
  failureReason: string,
  startedAtMs: number,
  completedAt: string,
  evidence: GenerationFailureEvidence = {},
) {
  const publishedCardCount = await generationCandidateCount(db, jobId, 'approved');
  const heldCandidateCount = await generationCandidateCount(db, jobId, 'held');
  const activeCards = await sourceActiveCardCount(db, sourceId);
  const durationMs = Math.max(0, Date.now() - startedAtMs);

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      `UPDATE generation_jobs
       SET status = 'failed', generation_mode = 'FAILED',
           summary = 'Deck preparation did not finish. Existing cards remain available.',
           published_card_count = ?, held_candidate_count = ?, duration_ms = ?,
           failure_reason = ?, provider_request_id = COALESCE(?, provider_request_id),
           input_tokens = COALESCE(?, input_tokens), output_tokens = COALESCE(?, output_tokens),
           remote_candidate_count = COALESCE(?, remote_candidate_count),
           batch_metadata_json = COALESCE(?, batch_metadata_json),
           candidate_checkpoint_json = CASE WHEN ? = 1 THEN NULL ELSE candidate_checkpoint_json END,
           updated_at = ?
       WHERE id = ?`,
      publishedCardCount,
      heldCandidateCount,
      durationMs,
      failureReason,
      evidence.providerRequestId ?? null,
      evidence.inputTokens ?? null,
      evidence.outputTokens ?? null,
      evidence.remoteCandidateCount ?? null,
      evidence.batchMetadata ? JSON.stringify(evidence.batchMetadata) : null,
      evidence.discardCandidateCheckpoint ? 1 : 0,
      completedAt,
      jobId,
    );
    await txn.runAsync(
      `UPDATE sources
       SET status = ?,
           ingestion_error = ?
       WHERE id = ?
         AND ? = (
           SELECT latest_generation_jobs.id
           FROM generation_jobs AS latest_generation_jobs
           WHERE latest_generation_jobs.source_id = ?
           ORDER BY latest_generation_jobs.created_at DESC, latest_generation_jobs.rowid DESC
           LIMIT 1
         )`,
      activeCards ? 'ready' : 'failed',
      activeCards ? null : generationFailureMessage(failureReason),
      sourceId,
      jobId,
      sourceId,
    );
  });
}

async function markGenerationJobQueued(
  db: WritableDatabase,
  jobId: string,
  sourceId: string,
  failureReason: string,
  startedAtMs: number,
  evidence: GenerationFailureEvidence = {},
) {
  const queuedAt = nowIso();
  const attemptRow = await db.getFirstAsync<{ attemptCount: number }>(
    'SELECT COALESCE(attempt_count, 1) AS attemptCount FROM generation_jobs WHERE id = ?',
    jobId,
  );
  const attemptCount = Math.max(1, Number(attemptRow?.attemptCount ?? 1));
  const nextAttemptAt = new Date(Date.now() + generationRetryDelayMs(attemptCount)).toISOString();
  const activeCards = await sourceActiveCardCount(db, sourceId);
  const durationMs = Math.max(0, Date.now() - startedAtMs);

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      `UPDATE generation_jobs
       SET status = 'queued', generation_mode = NULL,
           summary = 'Waiting for Smart Generation. Source and existing cards are safe.',
           published_card_count = 0, held_candidate_count = 0, duration_ms = ?,
           fallback_reason = NULL, fallback_used = 0, failure_reason = ?,
           provider_request_id = COALESCE(?, provider_request_id),
           input_tokens = COALESCE(?, input_tokens), output_tokens = COALESCE(?, output_tokens),
           remote_candidate_count = COALESCE(?, remote_candidate_count),
           batch_metadata_json = COALESCE(?, batch_metadata_json),
           next_attempt_at = ?, updated_at = ?
       WHERE id = ?`,
      durationMs,
      failureReason,
      evidence.providerRequestId ?? null,
      evidence.inputTokens ?? null,
      evidence.outputTokens ?? null,
      evidence.remoteCandidateCount ?? null,
      evidence.batchMetadata ? JSON.stringify(evidence.batchMetadata) : null,
      nextAttemptAt,
      queuedAt,
      jobId,
    );
    await txn.runAsync(
      `UPDATE sources
       SET status = ?,
           ingestion_error = ?
       WHERE id = ?
         AND ? = (
           SELECT latest_generation_jobs.id
           FROM generation_jobs AS latest_generation_jobs
           WHERE latest_generation_jobs.source_id = ?
           ORDER BY latest_generation_jobs.created_at DESC, latest_generation_jobs.rowid DESC
           LIMIT 1
         )`,
      activeCards ? 'ready' : 'waiting-for-generation',
      activeCards ? null : 'High-quality generation is temporarily unavailable. This source is safely queued for Smart Generation.',
      sourceId,
      jobId,
      sourceId,
    );
  });
}

async function sourceActiveCardCount(db: WritableDatabase, sourceId: string) {
  const row = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count
     FROM cards
     JOIN notes ON notes.id = cards.note_id
     WHERE notes.source_id = ? AND cards.deleted_at IS NULL`,
    sourceId,
  );
  return Number(row?.count ?? 0);
}

function generationFailureMessage(failureReason: string) {
  switch (failureReason) {
    case 'configuration_error':
    case 'gateway_not_configured':
    case 'authentication_error':
      return 'Smart Generation setup needs attention. Your source and existing cards are safe.';
    case 'request_too_large':
      return 'This source is too large for one Smart Generation request. Split it into smaller files or sections.';
    case 'insufficient_evidence':
      return 'The extracted source did not contain enough clear evidence for trustworthy cards.';
    case 'invalid_provider_response':
      return 'Smart Generation returned unusable output. No low-quality cards were published.';
    default:
      return 'Deck preparation did not finish. Your source and existing cards are safe. Try again.';
  }
}

export function resumeQueuedGenerationJobs() {
  if (resumeQueuedJobsPromise) return resumeQueuedJobsPromise;
  resumeQueuedJobsPromise = resumeQueuedGenerationJobsOnce().finally(() => {
    resumeQueuedJobsPromise = null;
  });
  return resumeQueuedJobsPromise;
}

async function resumeQueuedGenerationJobsOnce() {
  const db = await getDatabase();
  const now = nowIso();
  const queued = await db.getAllAsync<{ sourceId: string; purpose: GenerationStrategy }>(
    `SELECT generation_jobs.source_id AS sourceId,
            generation_jobs.purpose AS purpose
     FROM generation_jobs
     JOIN sources ON sources.id = generation_jobs.source_id
     WHERE generation_jobs.status = 'queued'
       AND generation_jobs.source_id IS NOT NULL
       AND (generation_jobs.next_attempt_at IS NULL OR generation_jobs.next_attempt_at <= ?)
       AND sources.deleted_at IS NULL
       AND sources.archived_at IS NULL
       AND generation_jobs.id = (
         SELECT latest_generation_jobs.id
         FROM generation_jobs AS latest_generation_jobs
         WHERE latest_generation_jobs.source_id = generation_jobs.source_id
         ORDER BY latest_generation_jobs.created_at DESC, latest_generation_jobs.rowid DESC
         LIMIT 1
       )
     ORDER BY generation_jobs.created_at ASC
     LIMIT ?`,
    now,
    MAX_RESUMED_JOBS_PER_LAUNCH,
  );

  let completed = 0;
  for (const item of queued) {
    try {
      if (item.purpose === 'local-baseline') {
        await generateDraftsForSource(item.sourceId);
      } else {
        await enhanceDraftsForSource(item.sourceId);
      }
      completed += 1;
    } catch {
      // generateDraftsForSource persists terminal state and safe learner copy.
    }
  }
  return completed;
}

function buildGenerationKey(
  sourceId: string,
  sourceHash: string,
  purpose: GenerationStrategy,
  promptId: string,
  promptVersion: string,
) {
  return [sourceId, sourceHash, purpose, promptId, promptVersion].join(':');
}

function candidateVerificationStatus(draft: GroundedCardCandidate, localExtractive: boolean) {
  if (!draft.evidenceSpan || !['exact', 'normalized', 'context-disambiguated'].includes(draft.evidenceSpan.status)) {
    return 'needs-source-review';
  }
  if (localExtractive) return 'extractive-source-match';
  return draft.evaluation?.medicalVerificationStatus ?? 'gateway-evidence-span-verified';
}

function candidateSupportScore(draft: GroundedCardCandidate) {
  if (draft.evaluation?.sourceClaimSupported === 'supported') return 1;
  if (draft.evaluation?.sourceClaimSupported === 'uncertain') return 0.5;
  return 0;
}

export async function approveCandidate(candidateId: string, deckId?: string, automated = false) {
  const db = await getDatabase();
  return approveCandidateUsingDatabase(db, candidateId, deckId, automated);
}

async function approveCandidateUsingDatabase(
  db: WritableDatabase,
  candidateId: string,
  deckId?: string,
  automated = false,
  alreadyInTransaction = false,
  finalizeReview = true,
) {
  const candidate = await db.getFirstAsync<{
    id: string;
    jobId: string;
    segmentId: string | null;
    cardType: string;
    learningObjective: string;
    qualityScore: number;
    qualityNotes: string;
    sourceId: string;
    jobDeckId: string | null;
    defaultDeckId: string | null;
    question: string;
    answer: string;
    evidenceText: string;
    verificationStatus: string;
    publicationDisposition: string;
    supportScore: number;
    status: CandidateStatus;
  }>(
    `SELECT
       generated_candidates.id,
       generated_candidates.job_id AS jobId,
       generated_candidates.segment_id AS segmentId,
       generated_candidates.card_type AS cardType,
       generated_candidates.learning_objective AS learningObjective,
       generated_candidates.quality_score AS qualityScore,
       generated_candidates.quality_notes AS qualityNotes,
       generation_jobs.source_id AS sourceId,
       generation_jobs.deck_id AS jobDeckId,
       sources.default_deck_id AS defaultDeckId,
       generated_candidates.question,
       generated_candidates.answer,
       generated_candidates.evidence_text AS evidenceText,
       generated_candidates.verification_status AS verificationStatus,
       generated_candidates.publication_disposition AS publicationDisposition,
       generated_candidates.support_score AS supportScore,
       generated_candidates.status
     FROM generated_candidates
     JOIN generation_jobs ON generation_jobs.id = generated_candidates.job_id
     JOIN sources ON sources.id = generation_jobs.source_id
     WHERE generated_candidates.id = ?`,
    candidateId,
  );

  if (!candidate || candidate.status !== 'pending') {
    throw new Error('This draft is no longer available for approval.');
  }
  if (automated && !isAutoStudyEligible(candidate.publicationDisposition as PublicationDisposition)) {
    throw new Error('Only PUBLISH candidates may enter study automatically.');
  }
  if (candidate.publicationDisposition === 'REJECT') {
    throw new Error('Rejected candidates cannot enter a study deck.');
  }
  if (!candidate.segmentId || !candidate.sourceId) {
    throw new Error('This draft has no source segment and cannot become a study card.');
  }

  const targetDeckId = deckId || candidate.jobDeckId || candidate.defaultDeckId;
  if (!targetDeckId) {
    throw new Error('This source does not have a study set yet.');
  }

  const now = nowIso();
  const noteId = createId('note');
  const cardId = createId('card');
  let resolvedCardId = cardId;
  const fsrsCardJson = createInitialFsrsCard(new Date(now));
  const policyPublished = isAutoStudyEligible(candidate.publicationDisposition as PublicationDisposition);
  const approvedCardStatus = policyPublished
    ? candidate.verificationStatus === 'extractive-source-match' && automated ? 'source_extracted' : 'verified'
    : 'needs_review';
  const approvedEvidenceStatus = policyPublished
    ? candidate.verificationStatus === 'extractive-source-match'
      ? automated ? 'auto-published-extractive' : 'user-approved-extractive'
      : 'policy-published'
    : 'user-approved-held-candidate';

  const persistCandidate = async (txn: WritableDatabase) => {
    const existingCard = await txn.getFirstAsync<{ id: string; noteId: string; deletedAt: string | null }>(
      `SELECT cards.id, cards.note_id AS noteId, cards.deleted_at AS deletedAt
       FROM cards
       JOIN notes ON notes.id = cards.note_id
       WHERE notes.source_id = ?
         AND trim(cards.prompt) = trim(?)
         AND trim(cards.answer) = trim(?)
       ORDER BY CASE WHEN cards.deleted_at IS NULL THEN 0 ELSE 1 END, cards.created_at ASC
       LIMIT 1`,
      candidate.sourceId,
      candidate.question,
      candidate.answer,
    );

    if (existingCard) {
      resolvedCardId = existingCard.id;
      if (existingCard.deletedAt) {
        await txn.runAsync(
          `UPDATE notes
           SET deck_id = ?, title = ?, body = ?, deleted_at = NULL, updated_at = ?
           WHERE id = ?`,
          targetDeckId,
          candidate.question,
          candidate.answer,
          now,
          existingCard.noteId,
        );
        await txn.runAsync(
          `UPDATE cards
           SET deck_id = ?, card_type = ?, status = ?, deleted_at = NULL, updated_at = ?
           WHERE id = ?`,
          targetDeckId,
          candidate.cardType || 'source-review',
          approvedCardStatus,
          now,
          existingCard.id,
        );
        await upsertSearchIndex(txn, existingCard.id);
      }
      await upsertCardQuality(txn, resolvedCardId, candidate, now);
      await txn.runAsync(
        "UPDATE generated_candidates SET status = 'approved', published_card_id = ? WHERE id = ?",
        resolvedCardId,
        candidateId,
      );
      if (finalizeReview) {
        await finalizeCandidateReview(txn, candidate.jobId, candidate.sourceId, now);
      }
      return;
    }

    const replaceableCard = await txn.getFirstAsync<{ id: string; noteId: string; evidenceId: string | null }>(
      `SELECT
         cards.id,
         cards.note_id AS noteId,
         card_evidence.id AS evidenceId
       FROM cards
       JOIN notes ON notes.id = cards.note_id
       JOIN card_evidence ON card_evidence.card_id = cards.id
       WHERE notes.source_id = ?
         AND card_evidence.segment_id = ?
         AND cards.status = 'source_extracted'
         AND cards.deleted_at IS NULL
         AND (
           cards.card_type = 'source-review'
           OR cards.prompt LIKE 'What is a key takeaway%'
           OR cards.prompt LIKE 'What should you remember from%'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM review_events
           WHERE review_events.card_id = cards.id
             AND review_events.reverted_at IS NULL
         )
       ORDER BY cards.created_at ASC
       LIMIT 1`,
      candidate.sourceId,
      candidate.segmentId,
    );

    if (replaceableCard) {
      resolvedCardId = replaceableCard.id;
      await txn.runAsync(
        `UPDATE notes
         SET deck_id = ?,
             title = ?,
             body = ?,
             source_id = ?,
             updated_at = ?
         WHERE id = ?`,
        targetDeckId,
        candidate.question,
        candidate.answer,
        candidate.sourceId,
        now,
        replaceableCard.noteId,
      );
      await txn.runAsync(
        `UPDATE cards
         SET deck_id = ?,
             card_type = ?,
             prompt = ?,
             answer = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`,
        targetDeckId,
        candidate.cardType || 'source-review',
        candidate.question,
        candidate.answer,
        approvedCardStatus,
        now,
        replaceableCard.id,
      );
      await txn.runAsync(
        `UPDATE card_evidence
         SET evidence_text = ?,
             support_score = ?,
             verification_status = ?
         WHERE id = ?`,
        candidate.evidenceText,
        Number(candidate.supportScore ?? 0),
        approvedEvidenceStatus,
        replaceableCard.evidenceId,
      );
      await upsertCardQuality(txn, resolvedCardId, candidate, now);
      await txn.runAsync(
        "UPDATE generated_candidates SET status = 'approved', published_card_id = ? WHERE id = ?",
        resolvedCardId,
        candidateId,
      );
      await txn.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', now, targetDeckId);
      await upsertSearchIndex(txn, replaceableCard.id);
      if (finalizeReview) {
        await finalizeCandidateReview(txn, candidate.jobId, candidate.sourceId, now);
      }
      return;
    }

    await txn.runAsync(
      `INSERT INTO notes (id, deck_id, title, body, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      noteId,
      targetDeckId,
      candidate.question,
      candidate.answer,
      candidate.sourceId,
      now,
      now,
    );
    await txn.runAsync(
      `INSERT INTO cards
       (id, deck_id, note_id, card_type, prompt, answer, status, is_starred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cardId,
      targetDeckId,
      noteId,
      candidate.cardType || 'source-review',
      candidate.question,
      candidate.answer,
      approvedCardStatus,
      0,
      now,
      now,
    );
    await txn.runAsync(
      `INSERT INTO memory_states
       (card_id, initial_fsrs_card_json, fsrs_card_json, difficulty, stability, retrievability, due_at, last_reviewed_at, scheduler_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cardId,
      fsrsCardJson,
      fsrsCardJson,
      null,
      null,
      null,
      now,
      null,
      schedulerVersion,
    );
    await txn.runAsync(
      `INSERT INTO card_evidence
       (id, card_id, segment_id, evidence_text, support_score, verification_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      createId('ev'),
      cardId,
      candidate.segmentId,
      candidate.evidenceText,
      Number(candidate.supportScore ?? 0),
      approvedEvidenceStatus,
      now,
    );
    await upsertCardQuality(txn, cardId, candidate, now);
    await txn.runAsync(
      "UPDATE generated_candidates SET status = 'approved', published_card_id = ? WHERE id = ?",
      resolvedCardId,
      candidateId,
    );
    await txn.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', now, targetDeckId);
    await upsertSearchIndex(txn, cardId);
    if (finalizeReview) {
      await finalizeCandidateReview(txn, candidate.jobId, candidate.sourceId, now);
    }
  };

  if (alreadyInTransaction) {
    await persistCandidate(db);
  } else {
    await runWriteTransaction(db, persistCandidate);
  }

  return resolvedCardId;
}

export async function updateCandidateDraft(candidateId: string, question: string, answer: string) {
  const nextQuestion = question.trim();
  const nextAnswer = answer.trim();

  if (!nextQuestion || !nextAnswer) {
    throw new Error('A draft needs both a question and an answer.');
  }

  const db = await getDatabase();
  const result = await db.runAsync(
    `UPDATE generated_candidates
     SET question = ?,
          answer = ?,
          evaluation_json = NULL,
          publication_disposition = 'REVIEW',
          evaluation_version = 'user-edited',
          policy_version = 'manual-review-required',
          sanitization_reason = NULL,
          verification_status = 'user-edited',
         support_score = 0,
         quality_score = 0,
         quality_notes = 'Edited draft: review source evidence before publishing.'
     WHERE id = ? AND status = 'pending'`,
    nextQuestion,
    nextAnswer,
    candidateId,
  );

  if (!result.changes) {
    throw new Error('This draft is no longer available for editing.');
  }
}

export async function rejectCandidate(candidateId: string) {
  const db = await getDatabase();
  const candidate = await db.getFirstAsync<{ jobId: string; sourceId: string; status: CandidateStatus }>(
    `SELECT
       generated_candidates.job_id AS jobId,
       generation_jobs.source_id AS sourceId,
       generated_candidates.status
     FROM generated_candidates
     JOIN generation_jobs ON generation_jobs.id = generated_candidates.job_id
     WHERE generated_candidates.id = ?`,
    candidateId,
  );

  if (!candidate || candidate.status !== 'pending') {
    return false;
  }

  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync("UPDATE generated_candidates SET status = 'rejected' WHERE id = ?", candidateId);
    await finalizeCandidateReview(txn, candidate.jobId, candidate.sourceId, now);
  });
  return true;
}


async function finalizeCandidateReview(
  db: WritableDatabase,
  jobId: string,
  sourceId: string,
  updatedAt: string,
) {
  const counts = await db.getFirstAsync<{
    pendingCount: number;
    publishedCardCount: number;
    heldCandidateCount: number;
  }>(
    `SELECT
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pendingCount,
       COUNT(DISTINCT CASE
         WHEN status = 'approved' THEN COALESCE(published_card_id, id)
         ELSE NULL
       END) AS publishedCardCount,
       SUM(CASE WHEN status <> 'approved' THEN 1 ELSE 0 END) AS heldCandidateCount
     FROM generated_candidates
     WHERE job_id = ?`,
    jobId,
  );
  const pendingCount = Number(counts?.pendingCount ?? 0);
  const publishedCardCount = Number(counts?.publishedCardCount ?? 0);
  const heldCandidateCount = Number(counts?.heldCandidateCount ?? 0);

  if (pendingCount === 0) {
    await db.runAsync(
      `UPDATE generation_jobs
       SET status = 'completed', summary = 'All source drafts have been reviewed.',
           published_card_count = ?, held_candidate_count = ?, updated_at = ?
       WHERE id = ?`,
      publishedCardCount,
      heldCandidateCount,
      updatedAt,
      jobId,
    );
    await db.runAsync(
      `UPDATE sources
       SET status = 'ready'
       WHERE id = ?
         AND ? = (
           SELECT latest_generation_jobs.id
           FROM generation_jobs AS latest_generation_jobs
           WHERE latest_generation_jobs.source_id = ?
           ORDER BY latest_generation_jobs.created_at DESC, latest_generation_jobs.rowid DESC
           LIMIT 1
         )`,
      sourceId,
      jobId,
      sourceId,
    );
  } else {
    await db.runAsync(
      `UPDATE generation_jobs
       SET published_card_count = ?, held_candidate_count = ?, updated_at = ?
       WHERE id = ?`,
      publishedCardCount,
      heldCandidateCount,
      updatedAt,
      jobId,
    );
  }
}

async function upsertCardQuality(
  db: WritableDatabase,
  cardId: string,
  candidate: { learningObjective: string; qualityScore: number; qualityNotes: string },
  checkedAt: string,
) {
  await db.runAsync(
    `INSERT INTO card_quality (card_id, learning_objective, quality_score, quality_notes, checked_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(card_id) DO UPDATE SET
       learning_objective = excluded.learning_objective,
       quality_score = excluded.quality_score,
       quality_notes = excluded.quality_notes,
       checked_at = excluded.checked_at`,
    cardId,
    candidate.learningObjective || '',
    Number(candidate.qualityScore ?? 0),
    candidate.qualityNotes || '',
    checkedAt,
  );
}

function buildConceptFirstSegments(
  rows: ParsedSegment[],
  conceptTargets: ReturnType<typeof extractConceptTargets>,
): ParsedSegment[] {
  if (!conceptTargets.length) return rows;
  const seen = new Set<string>();
  const ordered: ParsedSegment[] = [];
  for (const concept of conceptTargets) {
    const relevant = selectSegmentsForConcept(concept, rows, 3);
    for (const seg of relevant) {
      if (!seen.has(seg.id)) {
        seen.add(seg.id);
        ordered.push(seg);
      }
    }
  }
  for (const row of rows) {
    if (!seen.has(row.id)) ordered.push(row);
  }
  return ordered;
}

function summarizeBatchProvenance(
  results: Array<{ generationResult: GroundedCardGenerationResult }>,
  initialFallbackReason?: string | null,
) {
  const provenances = results.map((result) => result.generationResult.provenance);
  const primary = provenances.find((item) => item.generationMode === 'REMOTE_AI') ?? provenances[0];
  return {
    providerId: primary?.providerId ?? null,
    modelId: primary?.modelId ?? null,
    attemptedProviderId: primary?.attemptedProviderId ?? null,
    attemptedModelId: primary?.attemptedModelId ?? null,
    promptId: primary?.promptId ?? null,
    promptVersion: primary?.promptVersion ?? null,
    providerRequestId: provenances.find((item) => item.providerRequestId)?.providerRequestId ?? null,
    fallbackReason: provenances.find((item) => item.fallbackReason)?.fallbackReason
      ?? initialFallbackReason
      ?? null,
    inputTokens: sumOptional(provenances.map((item) => item.usage?.inputTokens)),
    outputTokens: sumOptional(provenances.map((item) => item.usage?.outputTokens)),
  };
}

function sumOptional(values: Array<number | undefined>) {
  const numbers = values.filter((value): value is number => typeof value === 'number');
  return numbers.length ? numbers.reduce((total, value) => total + value, 0) : null;
}

async function trashUntouchedAutoCardsForRegeneration(
  db: WritableDatabase,
  sourceId: string,
  sourceTitle: string,
  replacementTargetIds?: string[],
) {
  if (replacementTargetIds && replacementTargetIds.length === 0) return 0;
  const targetPlaceholders = replacementTargetIds?.map(() => '?').join(',');
  const targetReplacementClause = targetPlaceholders
    ? `AND EXISTS (
         SELECT 1 FROM generated_candidates replacement_candidates
         WHERE replacement_candidates.published_card_id = cards.id
           AND replacement_candidates.target_id IN (${targetPlaceholders})
       )`
    : '';
  const rows = await db.getAllAsync<{ id: string; noteId: string }>(
    `SELECT cards.id, cards.note_id AS noteId
     FROM cards
     JOIN notes ON notes.id = cards.note_id
     WHERE notes.source_id = ?
       AND cards.deleted_at IS NULL
       AND (
         cards.status = 'source_extracted'
         OR EXISTS (
           SELECT 1 FROM generated_candidates
           WHERE generated_candidates.published_card_id = cards.id
         )
       )
       ${targetReplacementClause}
       AND cards.updated_at = cards.created_at
       AND notes.updated_at = notes.created_at
       AND NOT EXISTS (
         SELECT 1 FROM review_events
         WHERE review_events.card_id = cards.id
           AND review_events.reverted_at IS NULL
       )`,
    sourceId,
    ...(replacementTargetIds ?? []),
  );
  if (!rows.length) return 0;

  const cardIds = rows.map((row) => row.id);
  const noteIds = [...new Set(rows.map((row) => row.noteId))];
  const cardPlaceholders = cardIds.map(() => '?').join(',');
  const notePlaceholders = noteIds.map(() => '?').join(',');
  const deletedAt = nowIso();
  const trashId = createId('trash');

  await db.runAsync(
    `UPDATE cards SET deleted_at = ?
     WHERE deleted_at IS NULL AND id IN (${cardPlaceholders})`,
    [deletedAt, ...cardIds],
  );
  await db.runAsync(
    `UPDATE notes SET deleted_at = ?
     WHERE deleted_at IS NULL AND id IN (${notePlaceholders})`,
    [deletedAt, ...noteIds],
  );
  try {
    await db.runAsync(`DELETE FROM cards_fts WHERE card_id IN (${cardPlaceholders})`, cardIds);
  } catch {
    // FTS is optional; normal card queries already exclude deleted rows.
  }
  await db.runAsync(
    `INSERT INTO library_trash
     (id, entity_type, entity_id, title, item_count, reviewed_card_count, deleted_at, metadata_json, restored_at)
     VALUES (?, 'source-cards', ?, ?, ?, 0, ?, ?, NULL)`,
    trashId,
    sourceId,
    `Superseded auto-created cards from ${sourceTitle}`,
    cardIds.length,
    deletedAt,
    JSON.stringify({ sourceId, cardIds, noteIds }),
  );
  return cardIds.length;
}
