import type { ConceptTarget } from '@/ingestion/concepts';
import { selectSegmentsForConcept } from '@/ingestion/concepts';
import type { ParsedSegment } from '@/ingestion/types';
import type { CardGenerationInput, GroundedCardCandidate, GroundedCardGenerationResult, CardGenerationProvider } from '@/ai/types';
import { generateGroundedCards } from '@/ai/generate';
import { isAutoStudyEligible } from '@/ai/publicationPolicy';
import { coveredTargetIds } from '@/ai/targetCoverage';
import { evaluateGatewayCardQuality } from '@/ai/cardQuality';
import { AUTO_PUBLISH_QUALITY_SCORE } from '@/ingestion/drafts';

export const BATCH_SIZE = 16;
export const MAX_BATCHES = 8;
const SEGMENTS_PER_CONCEPT = 3;

export type BatchPlan = {
  batches: ConceptBatch[];
  totalConcepts: number;
  criticalConceptCount: number;
  highConceptCount: number;
};

export type ConceptBatch = {
  batchIndex: number;
  concepts: ConceptTarget[];
  segmentIds: string[];
};

export type BatchResult = {
  batchIndex: number;
  candidates: GroundedCardCandidate[];
  generationResult: GroundedCardGenerationResult;
  conceptsAttempted: string[];
  conceptsCovered: string[];
};

export type CoverageState = {
  coveredTargetIds: Set<string>;
  batchesCompleted: number;
  totalCandidates: number;
  remoteCandidateCount: number;
  fallbackCandidateCount: number;
  remoteAIUsed: boolean;
  anyFallback: boolean;
};

export type BatchMetadata = {
  totalBatches: number;
  batchesCompleted: number;
  totalConcepts: number;
  criticalConceptCount: number;
  highConceptCount: number;
  coveredConceptCount: number;
  uncoveredCriticalCount: number;
  uncoveredHighCount: number;
  gapBatchUsed: boolean;
  repairAttemptedTargetCount: number;
  repairedTargetCount: number;
  missingTargetIds: string[];
  batchDiagnostics: Array<{
    batchIndex: number;
    attemptedTargetCount: number;
    coveredTargetCount: number;
    candidateCount: number;
    remoteCandidateCount: number;
    fallbackUsed: boolean;
    fallbackReason?: string;
  }>;
  stoppedReason: 'all_concepts_covered' | 'max_batches_reached' | 'no_concepts' | 'generation_failed';
  selection?: {
    rawCandidateCount: number;
    remoteCandidateCount: number;
    fallbackCandidateCount: number;
    publishableCandidateCount: number;
    selectedCandidateCount: number;
    targetCoverageRate: number;
    dispositionCounts: Record<'PUBLISH' | 'SANITIZE' | 'REVIEW' | 'REJECT' | 'UNEVALUATED', number>;
    droppedUnsafeCount: number;
    droppedLowQualityCount: number;
    droppedDuplicateCount: number;
    droppedBudgetCount: number;
    publicationFailureCount: number;
    reasonCodeCounts: Record<string, number>;
  };
};

export type BatchGenerationSummary = {
  allBatchResults: BatchResult[];
  allCandidates: GroundedCardCandidate[];
  coverage: CoverageState;
  batchMetadata: BatchMetadata;
};

export function planConceptBatches(
  concepts: ConceptTarget[],
  batchSize: number = BATCH_SIZE,
  maxBatches: number = MAX_BATCHES,
): BatchPlan {
  const criticalConceptCount = concepts.filter((c) => c.importance === 'critical').length;
  const highConceptCount = concepts.filter((c) => c.importance === 'high').length;
  const prioritized = [
    ...concepts.filter((c) => c.importance === 'critical'),
    ...concepts.filter((c) => c.importance === 'high'),
    ...concepts.filter((c) => c.importance === 'standard'),
  ];
  const batches: ConceptBatch[] = [];
  for (let i = 0; i < prioritized.length && batches.length < maxBatches; i += batchSize) {
    const batch = prioritized.slice(i, i + batchSize);
    const segmentIdSet = new Set<string>();
    for (const concept of batch) {
      for (const id of concept.segmentIds) segmentIdSet.add(id);
    }
    batches.push({ batchIndex: batches.length, concepts: batch, segmentIds: [...segmentIdSet] });
  }
  return { batches, totalConcepts: concepts.length, criticalConceptCount, highConceptCount };
}

export function selectBatchSegments(
  batch: ConceptBatch,
  allSegments: ParsedSegment[],
): ParsedSegment[] {
  const seen = new Set<string>();
  const result: ParsedSegment[] = [];
  const segmentsByConcept = batch.concepts.map((concept) => (
    selectSegmentsForConcept(concept, allSegments, SEGMENTS_PER_CONCEPT)
  ));
  for (let rank = 0; rank < SEGMENTS_PER_CONCEPT; rank += 1) {
    for (const relevant of segmentsByConcept) {
      const seg = relevant[rank];
      if (seg) {
        if (!seen.has(seg.id)) { seen.add(seg.id); result.push(seg); }
      }
    }
  }
  return result;
}

export function computeCoveredTargets(
  candidates: GroundedCardCandidate[],
  concepts: ConceptTarget[],
): string[] {
  return coveredTargetIds(
    candidates,
    concepts,
    (candidate) => Boolean(
      candidate.evaluation
      && isAutoStudyEligible(candidate.evaluation.publicationDisposition)
      && candidateQuality(candidate) >= AUTO_PUBLISH_QUALITY_SCORE
    ),
  );
}

function candidateQuality(candidate: GroundedCardCandidate) {
  return typeof candidate.qualityScore === 'number'
    ? candidate.qualityScore
    : evaluateGatewayCardQuality(candidate);
}

export function isCompletionCriteria(
  coverage: CoverageState,
  plan: BatchPlan,
  maxBatches: number = MAX_BATCHES,
): boolean {
  if (coverage.batchesCompleted >= maxBatches) return true;
  const allConcepts = plan.batches.flatMap((b) => b.concepts);
  return allConcepts.length > 0 && allConcepts.every((concept) => coverage.coveredTargetIds.has(concept.id));
}

export function buildGapBatch(
  concepts: ConceptTarget[],
  coverage: CoverageState,
  allSegments: ParsedSegment[],
  existingBatchCount: number,
): ConceptBatch | null {
  const uncovered = concepts.filter((concept) => !coverage.coveredTargetIds.has(concept.id));
  if (!uncovered.length) return null;
  const segmentIdSet = new Set<string>();
  for (const concept of uncovered) {
    const segs = selectSegmentsForConcept(concept, allSegments, SEGMENTS_PER_CONCEPT);
    for (const seg of segs) segmentIdSet.add(seg.id);
  }
  return { batchIndex: existingBatchCount, concepts: uncovered, segmentIds: [...segmentIdSet] };
}

export async function runBatchedGeneration(
  provider: CardGenerationProvider,
  requestId: string,
  sourceId: string,
  sourceTitle: string,
  concepts: ConceptTarget[],
  allSegments: ParsedSegment[],
  options: {
    batchSize?: number;
    maxBatches?: number;
    onBatchComplete?: (result: BatchResult) => Promise<void>;
  } = {},
): Promise<BatchGenerationSummary> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxBatches = options.maxBatches ?? MAX_BATCHES;
  if (!concepts.length) {
    const smartResult = await generateGroundedCards(
      provider,
      { requestId, sourceId, sourceTitle, maxCandidates: 18, segments: allSegments.map((s) => ({ segmentId: s.id, locator: s.locator, sectionPath: s.sectionPath, text: s.text })) },
    );
    return {
      allBatchResults: [{
        batchIndex: 0,
        candidates: smartResult.candidates,
        generationResult: smartResult,
        conceptsAttempted: [],
        conceptsCovered: [],
      }],
      allCandidates: smartResult.candidates,
      coverage: { coveredTargetIds: new Set(), batchesCompleted: 0, totalCandidates: smartResult.candidates.length, remoteCandidateCount: smartResult.provenance.remoteCandidateCount, fallbackCandidateCount: 0, remoteAIUsed: true, anyFallback: false },
      batchMetadata: { totalBatches: 0, batchesCompleted: 0, totalConcepts: 0, criticalConceptCount: 0, highConceptCount: 0, coveredConceptCount: 0, uncoveredCriticalCount: 0, uncoveredHighCount: 0, gapBatchUsed: false, repairAttemptedTargetCount: 0, repairedTargetCount: 0, missingTargetIds: [], batchDiagnostics: [], stoppedReason: 'no_concepts' },
    };
  }
  const plan = planConceptBatches(concepts, batchSize, maxBatches);
  const coverage: CoverageState = { coveredTargetIds: new Set(), batchesCompleted: 0, totalCandidates: 0, remoteCandidateCount: 0, fallbackCandidateCount: 0, remoteAIUsed: false, anyFallback: false };
  const allBatchResults: BatchResult[] = [];
  const allCandidates: GroundedCardCandidate[] = [];
  for (const batch of plan.batches) {
    if (isCompletionCriteria(coverage, plan, maxBatches)) break;
    const batchSegments = selectBatchSegments(batch, allSegments);
    if (!batchSegments.length) { coverage.batchesCompleted++; continue; }
    const batchRequestId = requestId + '-b' + batch.batchIndex;
    const batchMaxCandidates = Math.min(batch.concepts.length, 18);
    const genResult = await generateCompleteBatch(
      provider,
      { requestId: batchRequestId, sourceId, sourceTitle },
      batchSegments,
      batch.concepts,
      batchMaxCandidates,
    );
    coverage.remoteAIUsed = true;
    coverage.remoteCandidateCount += genResult.provenance.remoteCandidateCount;
    const newCovered = computeCoveredTargets(genResult.candidates, batch.concepts);
    for (const targetId of newCovered) coverage.coveredTargetIds.add(targetId);
    const batchResultObj: BatchResult = { batchIndex: batch.batchIndex, candidates: genResult.candidates, generationResult: genResult, conceptsAttempted: batch.concepts.map((c) => c.term), conceptsCovered: newCovered };
    allBatchResults.push(batchResultObj);
    allCandidates.push(...genResult.candidates);
    coverage.batchesCompleted++;
    coverage.totalCandidates = allCandidates.length;
    if (options.onBatchComplete) await options.onBatchComplete(batchResultObj);
  }
  let gapBatchUsed = false;
  if (!isCompletionCriteria(coverage, plan, maxBatches) && coverage.batchesCompleted < maxBatches) {
    const generatedTargetIds = new Set(coveredTargetIds(allCandidates, concepts, () => true));
    const gapBatch = buildGapBatch(
      concepts,
      { ...coverage, coveredTargetIds: generatedTargetIds },
      allSegments,
      coverage.batchesCompleted,
    );
    if (gapBatch) {
      gapBatchUsed = true;
      const gapSegments = selectBatchSegments(gapBatch, allSegments);
      if (gapSegments.length) {
        const gapResult = await generateCompleteBatch(
          provider,
          { requestId: requestId + '-repair', sourceId, sourceTitle },
          gapSegments,
          gapBatch.concepts,
          Math.min(gapBatch.concepts.length, 18),
        );
        coverage.remoteAIUsed = true;
        coverage.remoteCandidateCount += gapResult.provenance.remoteCandidateCount;
        const gapCovered = computeCoveredTargets(gapResult.candidates, gapBatch.concepts);
        for (const targetId of gapCovered) coverage.coveredTargetIds.add(targetId);
        const gapResultObj: BatchResult = { batchIndex: gapBatch.batchIndex, candidates: gapResult.candidates, generationResult: gapResult, conceptsAttempted: gapBatch.concepts.map((c) => c.term), conceptsCovered: gapCovered };
        allBatchResults.push(gapResultObj);
        allCandidates.push(...gapResult.candidates);
        coverage.totalCandidates = allCandidates.length;
        if (options.onBatchComplete) await options.onBatchComplete(gapResultObj);
      }
    }
  }
  const missingTargetIds = concepts.filter((concept) => !coverage.coveredTargetIds.has(concept.id)).map((concept) => concept.id);
  const uncoveredCritical = concepts.filter((c) => c.importance === 'critical' && !coverage.coveredTargetIds.has(c.id)).length;
  const uncoveredHigh = concepts.filter((c) => c.importance === 'high' && !coverage.coveredTargetIds.has(c.id)).length;
  const allConceptsCovered = missingTargetIds.length === 0;
  const stoppedReason: BatchMetadata['stoppedReason'] = allConceptsCovered ? 'all_concepts_covered' : 'max_batches_reached';
  return {
    allBatchResults, allCandidates, coverage,
    batchMetadata: {
      totalBatches: plan.batches.length + (gapBatchUsed ? 1 : 0),
      batchesCompleted: coverage.batchesCompleted + (gapBatchUsed ? 1 : 0),
      totalConcepts: concepts.length, criticalConceptCount: plan.criticalConceptCount, highConceptCount: plan.highConceptCount,
      coveredConceptCount: coverage.coveredTargetIds.size, uncoveredCriticalCount: uncoveredCritical, uncoveredHighCount: uncoveredHigh,
      gapBatchUsed,
      repairAttemptedTargetCount: gapBatchUsed ? (allBatchResults.at(-1)?.conceptsAttempted.length ?? 0) : 0,
      repairedTargetCount: gapBatchUsed ? (allBatchResults.at(-1)?.conceptsCovered.length ?? 0) : 0,
      missingTargetIds,
      batchDiagnostics: allBatchResults.map((result) => ({
        batchIndex: result.batchIndex,
        attemptedTargetCount: result.conceptsAttempted.length,
        coveredTargetCount: result.conceptsCovered.length,
        candidateCount: result.candidates.length,
        remoteCandidateCount: result.generationResult.provenance.remoteCandidateCount,
        fallbackUsed: result.generationResult.provenance.fallbackUsed,
        fallbackReason: result.generationResult.provenance.fallbackReason,
      })),
      stoppedReason,
    },
  };
}

async function generateCompleteBatch(
  provider: CardGenerationProvider,
  identity: Pick<CardGenerationInput, 'requestId' | 'sourceId' | 'sourceTitle'>,
  segments: ParsedSegment[],
  concepts: ConceptTarget[],
  maxCandidates: number,
): Promise<GroundedCardGenerationResult> {
  const sourceSegments = segments.map((segment) => ({
    segmentId: segment.id,
    locator: segment.locator,
    sectionPath: segment.sectionPath,
    text: segment.text,
  }));
  const primary = await generateGroundedCards(
    provider,
    { ...identity, maxCandidates, segments: sourceSegments, conceptTargets: concepts },
  );

  // Repair missing model output only. Evaluation failures usually indicate
  // source layout or grounding problems; repeating same request wastes quota.
  const covered = new Set(coveredTargetIds(primary.candidates, concepts, () => true));
  const missing = concepts.filter((concept) => !covered.has(concept.id));
  if (!missing.length) return primary;

  const repair = await generateGroundedCards(
    provider,
    {
      ...identity,
      requestId: `${identity.requestId}-smart-repair`,
      maxCandidates: missing.length,
      segments: sourceSegments,
      conceptTargets: missing,
    },
  );
  if (!repair.candidates.length) return primary;

  return {
    candidates: [...primary.candidates, ...repair.candidates],
    provenance: {
      ...primary.provenance,
      generationMode: 'REMOTE_AI',
      fallbackUsed: false,
      remoteCandidateCount: primary.candidates.length + repair.candidates.length,
    },
  };
}
