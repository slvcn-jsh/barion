import {
  planConceptBatches,
  selectBatchSegments,
  computeCoveredTargets,
  isCompletionCriteria,
  buildGapBatch,
  runBatchedGeneration,
} from '@/ai/batchGeneration';
import type { ConceptTarget } from '@/ingestion/concepts';
import type { ParsedSegment } from '@/ingestion/types';
import type { CardGenerationProvider, GroundedCardCandidate } from '@/ai/types';
import { generateGroundedCards } from '@/ai/generate';

jest.mock('@/ai/generate', () => ({
  generateGroundedCards: jest.fn(),
}));

const mockedGenerateGroundedCards = jest.mocked(generateGroundedCards);

const makeConcept = (term: string, importance: 'critical' | 'high' | 'standard' = 'standard', segmentIds = ['s1']): ConceptTarget => ({
  id: `c-${term}`, term, detail: `${term} detail`, importance, emphasis: 'clinical', segmentIds, locator: 'Page 1',
  targetType: 'named-concept', frontStyle: 'term', primary: true,
});

const makeSegment = (id: string, text: string): ParsedSegment => ({
  id, locator: 'Page 1', sectionPath: 'Section', text, startOffset: 0, endOffset: text.length
});

const publishableEvaluation = {
  publicationDisposition: 'PUBLISH',
} as NonNullable<GroundedCardCandidate['evaluation']>;

const candidateForCoverage = (
  overrides: Partial<GroundedCardCandidate> = {},
): GroundedCardCandidate => ({
  segmentId: 's1',
  locator: 'Page 1',
  cardType: 'definition',
  learningObjective: 'Recall abstinence.',
  question: 'What is abstinence?',
  answer: 'Answer: Abstinence prevents pregnancy.',
  evidenceText: 'Abstinence prevents pregnancy.',
  qualityScore: 0.95,
  evaluation: publishableEvaluation,
  ...overrides,
});

describe('planConceptBatches', () => {
  it('partitions concepts into bounded batches', () => {
    const concepts = Array.from({ length: 15 }, (_, i) => makeConcept(`term-${i}`));
    const plan = planConceptBatches(concepts, 5, 4);
    expect(plan.batches.length).toBe(3);
    expect(plan.batches[0].concepts.length).toBe(5);
    expect(plan.batches[2].concepts.length).toBe(5);
    expect(plan.totalConcepts).toBe(15);
  });

  it('prioritizes critical and high concepts into earlier batches', () => {
    const concepts = [
      makeConcept('std1', 'standard'),
      makeConcept('crit1', 'critical'),
      makeConcept('high1', 'high'),
      makeConcept('std2', 'standard'),
    ];
    const plan = planConceptBatches(concepts, 2, 4);
    expect(plan.batches[0].concepts.some((c) => c.importance === 'critical')).toBe(true);
    expect(plan.batches[0].concepts.some((c) => c.importance === 'high')).toBe(true);
  });
});

describe('selectBatchSegments', () => {
  it('round-robins concepts so bounded request payloads cover breadth first', () => {
    const segments = [
      makeSegment('a1', 'Alpha primary'),
      makeSegment('a2', 'Alpha secondary'),
      makeSegment('b1', 'Beta primary'),
      makeSegment('b2', 'Beta secondary'),
    ];
    const batch = {
      batchIndex: 0,
      concepts: [makeConcept('Alpha', 'standard', ['a1', 'a2']), makeConcept('Beta', 'standard', ['b1', 'b2'])],
      segmentIds: ['a1', 'a2', 'b1', 'b2'],
    };

    expect(selectBatchSegments(batch, segments).slice(0, 2).map((segment) => segment.id))
      .toEqual(['a1', 'b1']);
  });
});

describe('computeCoveredTargets', () => {
  it('identifies one tested concept from a publishable card recall target', () => {
    const concepts = [makeConcept('Metformin'), makeConcept('Insulin')];
    const candidates: GroundedCardCandidate[] = [{
      segmentId: 's1', locator: 'Page 1', cardType: 'treatment',
      qualityScore: 0.95,
      learningObjective: 'Recall metformin mechanism',
      question: 'What is metformin?', answer: 'An oral biguanide.',
      evidenceText: 'Metformin decreases hepatic glucose output.',
      evaluation: publishableEvaluation,
    }];
    const covered = computeCoveredTargets(candidates, concepts);
    expect(covered).toContain('c-Metformin');
    expect(covered).not.toContain('c-Insulin');
  });

  it('does not treat broad evidence or rejected candidates as concept coverage', () => {
    const concepts = [makeConcept('Abstinence'), makeConcept('Withdrawal'), makeConcept('Fertility awareness')];
    const candidates: GroundedCardCandidate[] = [{
      segmentId: 's1', locator: 'Page 1', cardType: 'definition',
      qualityScore: 0.95,
      learningObjective: 'Recall abstinence effectiveness.',
      question: 'How effective is abstinence?',
      answer: 'Answer: Abstinence is 100% effective.',
      evidenceText: 'Abstinence is effective. Withdrawal can fail. Fertility awareness monitors body signs.',
      evaluation: publishableEvaluation,
    }, {
      segmentId: 's1', locator: 'Page 1', cardType: 'risk-factor',
      qualityScore: 0.95,
      learningObjective: 'Recall withdrawal failure.',
      question: 'How often does withdrawal fail?',
      answer: 'Answer: Withdrawal can fail.',
      evidenceText: 'Withdrawal can fail.',
      evaluation: { publicationDisposition: 'REJECT' } as NonNullable<GroundedCardCandidate['evaluation']>,
    }];

    expect(computeCoveredTargets(candidates, concepts)).toEqual(['c-Abstinence']);
  });

  it('does not treat a low-quality publishable candidate as completed coverage', () => {
    const concepts = [makeConcept('Abstinence')];
    const candidates: GroundedCardCandidate[] = [candidateForCoverage({
      targetId: concepts[0].id,
      qualityScore: 0.5,
    })];

    expect(computeCoveredTargets(candidates, concepts)).toEqual([]);
  });
});

describe('isCompletionCriteria', () => {
  it('returns true only when every planned concept is covered', () => {
    const concepts = [makeConcept('Crit', 'critical'), makeConcept('High', 'high'), makeConcept('Standard')];
    const plan = planConceptBatches(concepts, 3, 4);
    const coverage = {
      coveredTargetIds: new Set(['c-Crit', 'c-High', 'c-Standard']),
      batchesCompleted: 1, totalCandidates: 4,
      remoteCandidateCount: 4, fallbackCandidateCount: 0,
      remoteAIUsed: true, anyFallback: false
    };
    expect(isCompletionCriteria(coverage, plan, 4)).toBe(true);
  });

  it('does not stop before generating a standard-only plan', () => {
    const plan = planConceptBatches([makeConcept('Standard one'), makeConcept('Standard two')], 2, 4);
    const coverage = {
      coveredTargetIds: new Set<string>(),
      batchesCompleted: 0, totalCandidates: 0,
      remoteCandidateCount: 0, fallbackCandidateCount: 0,
      remoteAIUsed: false, anyFallback: false,
    };

    expect(isCompletionCriteria(coverage, plan, 4)).toBe(false);
  });

  it('returns false when some critical concepts remain uncovered', () => {
    const concepts = [makeConcept('Crit', 'critical'), makeConcept('High', 'high')];
    const plan = planConceptBatches(concepts, 2, 4);
    const coverage = {
      coveredTargetIds: new Set(['c-High']),
      batchesCompleted: 1, totalCandidates: 2,
      remoteCandidateCount: 2, fallbackCandidateCount: 0,
      remoteAIUsed: true, anyFallback: false
    };
    expect(isCompletionCriteria(coverage, plan, 4)).toBe(false);
  });

  it('returns true when max batches is reached regardless of uncovered concepts', () => {
    const concepts = [makeConcept('Crit', 'critical')];
    const plan = planConceptBatches(concepts, 1, 2);
    const coverage = {
      coveredTargetIds: new Set<string>(),
      batchesCompleted: 2, totalCandidates: 0,
      remoteCandidateCount: 0, fallbackCandidateCount: 0,
      remoteAIUsed: false, anyFallback: true
    };
    expect(isCompletionCriteria(coverage, plan, 2)).toBe(true);
  });
});

describe('buildGapBatch', () => {
  it('constructs a gap batch for every uncovered concept', () => {
    const concepts = [makeConcept('Crit', 'critical'), makeConcept('High', 'high'), makeConcept('Standard')];
    const coverage = {
      coveredTargetIds: new Set(['c-High']),
      batchesCompleted: 1, totalCandidates: 2,
      remoteCandidateCount: 2, fallbackCandidateCount: 0,
      remoteAIUsed: true, anyFallback: false
    };
    const segments = [makeSegment('s1', 'Crit text')];
    const gap = buildGapBatch(concepts, coverage, segments, 1);
    expect(gap).not.toBeNull();
    expect(gap?.concepts.map((c) => c.term)).toEqual(['Crit', 'Standard']);
  });

  it('returns null if all concepts are covered', () => {
    const concepts = [makeConcept('Crit', 'critical')];
    const coverage = {
      coveredTargetIds: new Set(['c-Crit']),
      batchesCompleted: 1, totalCandidates: 2,
      remoteCandidateCount: 2, fallbackCandidateCount: 0,
      remoteAIUsed: true, anyFallback: false
    };
    const gap = buildGapBatch(concepts, coverage, [], 1);
    expect(gap).toBeNull();
  });
});

describe('runBatchedGeneration', () => {
  it('retains provider provenance when no explicit concept inventory exists', async () => {
    const candidate = candidateForCoverage();
    const provider: CardGenerationProvider = { id: 'remote-test', model: 'remote-model', generate: jest.fn() };
    mockedGenerateGroundedCards.mockReset();
    mockedGenerateGroundedCards.mockResolvedValue(remoteResult('request-no-concepts', [candidate]));

    const result = await runBatchedGeneration(
      provider,
      'request-no-concepts',
      'source-1',
      'Source',
      [],
      [makeSegment('s1', 'Abstinence prevents pregnancy.')],
    );

    expect(result.allBatchResults).toHaveLength(1);
    expect(result.allBatchResults[0].generationResult.provenance).toEqual(expect.objectContaining({
      requestId: 'request-no-concepts',
      providerId: 'remote-test',
      modelId: 'remote-model',
    }));
  });

  it('fills coverage gaps with a second Smart Generation request', async () => {
    const concepts = [makeConcept('Alpha'), makeConcept('Beta'), makeConcept('Gamma')];
    const segments = [makeSegment('s1', 'Alpha source. Beta source. Gamma source.')];
    const provider: CardGenerationProvider = {
      id: 'remote-test',
      model: 'remote-model',
      generate: jest.fn(),
    };
    mockedGenerateGroundedCards.mockReset();
    mockedGenerateGroundedCards.mockImplementation(async (_provider, input) => (
      input.requestId.endsWith('-smart-repair')
        ? remoteResult(input.requestId, concepts.slice(1).map((concept) => (
          candidateForCoverage({
            targetId: concept.id,
            question: `What is the ${concept.term} concept?`,
            answer: `Answer: ${concept.term} source.`,
            learningObjective: `Recall ${concept.term}.`,
            evidenceText: `${concept.term} source evidence long enough for scoring.`,
          })
        )))
        : remoteResult(input.requestId, [candidateForCoverage({
        targetId: concepts[0].id,
        question: 'What is the Alpha concept?',
      })])
    ));

    const result = await runBatchedGeneration(
      provider,
      'request-coverage',
      'source-1',
      'Source',
      concepts,
      segments,
    );

    expect(result.allCandidates).toHaveLength(3);
    expect(result.coverage.coveredTargetIds).toEqual(new Set(concepts.map((concept) => concept.id)));
    expect(result.coverage.remoteCandidateCount).toBe(3);
    expect(result.coverage.fallbackCandidateCount).toBe(0);
    expect(result.coverage.remoteAIUsed).toBe(true);
    expect(result.coverage.anyFallback).toBe(false);
    expect(result.batchMetadata.missingTargetIds).toEqual([]);
    expect(mockedGenerateGroundedCards).toHaveBeenCalledTimes(2);
    expect(result.allBatchResults[0].generationResult.provenance).toEqual(expect.objectContaining({
      generationMode: 'REMOTE_AI',
      fallbackUsed: false,
    }));
  });

  it('does not spend another request when evaluation holds already generated targets', async () => {
    const concepts = [makeConcept('Alpha'), makeConcept('Beta')];
    const segments = [makeSegment('s1', 'Alpha source. Beta source.')];
    const provider: CardGenerationProvider = { id: 'remote-test', model: 'remote-model', generate: jest.fn() };
    mockedGenerateGroundedCards.mockReset();
    mockedGenerateGroundedCards.mockResolvedValue(remoteResult('request-held-b0', concepts.map((concept) => (
      candidateForCoverage({
        targetId: concept.id,
        question: concept.term,
        evaluation: { publicationDisposition: 'REVIEW' } as NonNullable<GroundedCardCandidate['evaluation']>,
      })
    ))));

    const result = await runBatchedGeneration(
      provider,
      'request-held',
      'source-1',
      'Source',
      concepts,
      segments,
    );

    expect(mockedGenerateGroundedCards).toHaveBeenCalledTimes(1);
    expect(result.allCandidates).toHaveLength(2);
    expect(result.coverage.coveredTargetIds).toEqual(new Set());
    expect(result.batchMetadata.gapBatchUsed).toBe(false);
    expect(result.batchMetadata.missingTargetIds).toEqual(concepts.map((concept) => concept.id));
  });
});

function remoteResult(requestId: string, candidates: GroundedCardCandidate[]) {
  return {
    candidates,
    provenance: {
      requestId,
      generationMode: 'REMOTE_AI' as const,
      fallbackUsed: false,
      providerId: 'remote-test',
      modelId: 'remote-model',
      promptId: 'grounded-card-generation',
      promptVersion: '1.3.0',
      generatedAt: '2026-09-22T00:00:00.000Z',
      remoteCandidateCount: candidates.length,
      durationMs: 10,
    },
  };
}
