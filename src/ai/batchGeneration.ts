import type { ConceptTarget } from '@/ingestion/concepts';
import { selectSegmentsForConcept } from '@/ingestion/concepts';
import type { ParsedSegment } from '@/ingestion/types';
import type { CardGenerationInput, GroundedCardCandidate, GroundedCardGenerationResult, CardGenerationProvider } from '@/ai/types';
import { generateGroundedCardsWithFallback } from '@/ai/generate';

export const BATCH_SIZE = 8;
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
  coveredTerms: Set<string>;
  batchesCompleted: number;
  totalCandidates: number;
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
  stoppedReason: 'all_concepts_covered' | 'max_batches_reached' | 'no_concepts' | 'generation_failed';
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
  for (const concept of batch.concepts) {
    const relevant = selectSegmentsForConcept(concept, allSegments, SEGMENTS_PER_CONCEPT);
    for (const seg of relevant) {
      if (!seen.has(seg.id)) { seen.add(seg.id); result.push(seg); }
    }
  }
  return result;
}

export function computeCoveredConcepts(
  candidates: GroundedCardCandidate[],
  concepts: ConceptTarget[],
): string[] {
  return concepts
    .filter((concept) => {
      const termLower = concept.term.toLowerCase();
      return candidates.some((candidate) => {
        const text = (candidate.question + ' ' + candidate.answer + ' ' + candidate.evidenceText).toLowerCase();
        return text.includes(termLower);
      });
    })
    .map((c) => c.term);
}

export function isCompletionCriteria(
  coverage: CoverageState,
  plan: BatchPlan,
  maxBatches: number = MAX_BATCHES,
): boolean {
  if (coverage.batchesCompleted >= maxBatches) return true;
  const allConcepts = plan.batches.flatMap((b) => b.concepts);
  const critical = allConcepts.filter((c) => c.importance === 'critical').map((c) => c.term);
  const high = allConcepts.filter((c) => c.importance === 'high').map((c) => c.term);
  return critical.every((t) => coverage.coveredTerms.has(t)) && high.every((t) => coverage.coveredTerms.has(t));
}

export function buildGapBatch(
  concepts: ConceptTarget[],
  coverage: CoverageState,
  allSegments: ParsedSegment[],
  existingBatchCount: number,
): ConceptBatch | null {
  const uncovered = concepts.filter(
    (c) => (c.importance === 'critical' || c.importance === 'high') && !coverage.coveredTerms.has(c.term),
  );
  if (!uncovered.length) return null;
  const segmentIdSet = new Set<string>();
  for (const concept of uncovered) {
    const segs = selectSegmentsForConcept(concept, allSegments, SEGMENTS_PER_CONCEPT);
    for (const seg of segs) segmentIdSet.add(seg.id);
  }
  return { batchIndex: existingBatchCount, concepts: uncovered, segmentIds: [...segmentIdSet] };
}

export async function runBatchedGeneration(
  provider: CardGenerationProvider | null,
  requestId: string,
  sourceId: string,
  sourceTitle: string,
  concepts: ConceptTarget[],
  allSegments: ParsedSegment[],
  createLocalCandidates: () => GroundedCardCandidate[],
  options: {
    batchSize?: number;
    maxBatches?: number;
    onBatchComplete?: (result: BatchResult) => Promise<void>;
  } = {},
): Promise<BatchGenerationSummary> {
  const batchSize = options.batchSize ?? BATCH_SIZE;
  const maxBatches = options.maxBatches ?? MAX_BATCHES;
  if (!concepts.length) {
    const fallbackResult = await generateGroundedCardsWithFallback(
      provider,
      { requestId, sourceId, sourceTitle, maxCandidates: 56, segments: allSegments.map((s) => ({ segmentId: s.id, locator: s.locator, sectionPath: s.sectionPath, text: s.text })) },
      createLocalCandidates,
    );
    return {
      allBatchResults: [], allCandidates: fallbackResult.candidates,
      coverage: { coveredTerms: new Set(), batchesCompleted: 0, totalCandidates: fallbackResult.candidates.length, remoteAIUsed: !fallbackResult.provenance.fallbackUsed, anyFallback: fallbackResult.provenance.fallbackUsed },
      batchMetadata: { totalBatches: 0, batchesCompleted: 0, totalConcepts: 0, criticalConceptCount: 0, highConceptCount: 0, coveredConceptCount: 0, uncoveredCriticalCount: 0, uncoveredHighCount: 0, gapBatchUsed: false, stoppedReason: 'no_concepts' },
    };
  }
  const plan = planConceptBatches(concepts, batchSize, maxBatches);
  const coverage: CoverageState = { coveredTerms: new Set(), batchesCompleted: 0, totalCandidates: 0, remoteAIUsed: false, anyFallback: false };
  const allBatchResults: BatchResult[] = [];
  const allCandidates: GroundedCardCandidate[] = [];
  for (const batch of plan.batches) {
    if (isCompletionCriteria(coverage, plan, maxBatches)) break;
    const batchSegments = selectBatchSegments(batch, allSegments);
    if (!batchSegments.length) { coverage.batchesCompleted++; continue; }
    const batchRequestId = requestId + '-b' + batch.batchIndex;
    const batchMaxCandidates = Math.min(batch.concepts.length * 3, 24);
    const genResult = await generateGroundedCardsWithFallback(
      provider,
      { requestId: batchRequestId, sourceId, sourceTitle, maxCandidates: batchMaxCandidates, segments: batchSegments.map((s) => ({ segmentId: s.id, locator: s.locator, sectionPath: s.sectionPath, text: s.text })), conceptTargets: batch.concepts.map((c) => ({ term: c.term, detail: c.detail, importance: c.importance, emphasis: c.emphasis, segmentIds: c.segmentIds, locator: c.locator })) },
      createLocalCandidates,
    );
    if (!genResult.provenance.fallbackUsed) coverage.remoteAIUsed = true;
    if (genResult.provenance.fallbackUsed) coverage.anyFallback = true;
    const newCovered = computeCoveredConcepts(genResult.candidates, batch.concepts);
    for (const term of newCovered) coverage.coveredTerms.add(term);
    const batchResultObj: BatchResult = { batchIndex: batch.batchIndex, candidates: genResult.candidates, generationResult: genResult, conceptsAttempted: batch.concepts.map((c) => c.term), conceptsCovered: newCovered };
    allBatchResults.push(batchResultObj);
    allCandidates.push(...genResult.candidates);
    coverage.batchesCompleted++;
    coverage.totalCandidates = allCandidates.length;
    if (options.onBatchComplete) await options.onBatchComplete(batchResultObj);
  }
  let gapBatchUsed = false;
  if (!isCompletionCriteria(coverage, plan, maxBatches) && coverage.batchesCompleted < maxBatches) {
    const gapBatch = buildGapBatch(concepts, coverage, allSegments, coverage.batchesCompleted);
    if (gapBatch) {
      gapBatchUsed = true;
      const gapSegments = selectBatchSegments(gapBatch, allSegments);
      if (gapSegments.length) {
        const gapResult = await generateGroundedCardsWithFallback(
          provider,
          { requestId: requestId + '-gap', sourceId, sourceTitle, maxCandidates: Math.min(gapBatch.concepts.length * 3, 24), segments: gapSegments.map((s) => ({ segmentId: s.id, locator: s.locator, sectionPath: s.sectionPath, text: s.text })), conceptTargets: gapBatch.concepts.map((c) => ({ term: c.term, detail: c.detail, importance: c.importance, emphasis: c.emphasis, segmentIds: c.segmentIds, locator: c.locator })) },
          createLocalCandidates,
        );
        if (!gapResult.provenance.fallbackUsed) coverage.remoteAIUsed = true;
        if (gapResult.provenance.fallbackUsed) coverage.anyFallback = true;
        const gapCovered = computeCoveredConcepts(gapResult.candidates, gapBatch.concepts);
        for (const term of gapCovered) coverage.coveredTerms.add(term);
        const gapResultObj: BatchResult = { batchIndex: gapBatch.batchIndex, candidates: gapResult.candidates, generationResult: gapResult, conceptsAttempted: gapBatch.concepts.map((c) => c.term), conceptsCovered: gapCovered };
        allBatchResults.push(gapResultObj);
        allCandidates.push(...gapResult.candidates);
        coverage.totalCandidates = allCandidates.length;
        if (options.onBatchComplete) await options.onBatchComplete(gapResultObj);
      }
    }
  }
  const uncoveredCritical = concepts.filter((c) => c.importance === 'critical' && !coverage.coveredTerms.has(c.term)).length;
  const uncoveredHigh = concepts.filter((c) => c.importance === 'high' && !coverage.coveredTerms.has(c.term)).length;
  const stoppedReason: BatchMetadata['stoppedReason'] = (uncoveredCritical === 0 && uncoveredHigh === 0) ? 'all_concepts_covered' : 'max_batches_reached';
  return {
    allBatchResults, allCandidates, coverage,
    batchMetadata: {
      totalBatches: plan.batches.length + (gapBatchUsed ? 1 : 0),
      batchesCompleted: coverage.batchesCompleted + (gapBatchUsed ? 1 : 0),
      totalConcepts: concepts.length, criticalConceptCount: plan.criticalConceptCount, highConceptCount: plan.highConceptCount,
      coveredConceptCount: coverage.coveredTerms.size, uncoveredCriticalCount: uncoveredCritical, uncoveredHighCount: uncoveredHigh,
      gapBatchUsed, stoppedReason,
    },
  };
}
