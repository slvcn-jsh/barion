import { planConceptBatches, selectBatchSegments, computeCoveredConcepts, isCompletionCriteria, buildGapBatch } from '@/ai/batchGeneration';
import type { ConceptTarget } from '@/ingestion/concepts';
import type { ParsedSegment } from '@/ingestion/types';
import type { GroundedCardCandidate } from '@/ai/types';

const makeConcept = (term: string, importance: 'critical' | 'high' | 'standard' = 'standard', segmentIds = ['s1']): ConceptTarget => ({
  id: `c-${term}`, term, detail: `${term} detail`, importance, emphasis: 'clinical', segmentIds, locator: 'Page 1'
});

const makeSegment = (id: string, text: string): ParsedSegment => ({
  id, locator: 'Page 1', sectionPath: 'Section', text, startOffset: 0, endOffset: text.length
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

describe('computeCoveredConcepts', () => {
  it('identifies covered concepts when term is present in question, answer, or evidence', () => {
    const concepts = [makeConcept('Metformin'), makeConcept('Insulin')];
    const candidates: GroundedCardCandidate[] = [{
      segmentId: 's1', locator: 'Page 1', cardType: 'treatment',
      learningObjective: 'Recall metformin mechanism',
      question: 'What is metformin?', answer: 'An oral biguanide.',
      evidenceText: 'Metformin decreases hepatic glucose output.'
    }];
    const covered = computeCoveredConcepts(candidates, concepts);
    expect(covered).toContain('Metformin');
    expect(covered).not.toContain('Insulin');
  });
});

describe('isCompletionCriteria', () => {
  it('returns true when all critical and high concepts are covered', () => {
    const concepts = [makeConcept('Crit', 'critical'), makeConcept('High', 'high')];
    const plan = planConceptBatches(concepts, 2, 4);
    const coverage = {
      coveredTerms: new Set(['Crit', 'High']),
      batchesCompleted: 1, totalCandidates: 4,
      remoteAIUsed: true, anyFallback: false
    };
    expect(isCompletionCriteria(coverage, plan, 4)).toBe(true);
  });

  it('returns false when some critical concepts remain uncovered', () => {
    const concepts = [makeConcept('Crit', 'critical'), makeConcept('High', 'high')];
    const plan = planConceptBatches(concepts, 2, 4);
    const coverage = {
      coveredTerms: new Set(['High']),
      batchesCompleted: 1, totalCandidates: 2,
      remoteAIUsed: true, anyFallback: false
    };
    expect(isCompletionCriteria(coverage, plan, 4)).toBe(false);
  });

  it('returns true when max batches is reached regardless of uncovered concepts', () => {
    const concepts = [makeConcept('Crit', 'critical')];
    const plan = planConceptBatches(concepts, 1, 2);
    const coverage = {
      coveredTerms: new Set<string>(),
      batchesCompleted: 2, totalCandidates: 0,
      remoteAIUsed: false, anyFallback: true
    };
    expect(isCompletionCriteria(coverage, plan, 2)).toBe(true);
  });
});

describe('buildGapBatch', () => {
  it('constructs a gap batch for uncovered high-importance concepts', () => {
    const concepts = [makeConcept('Crit', 'critical'), makeConcept('High', 'high')];
    const coverage = {
      coveredTerms: new Set(['High']),
      batchesCompleted: 1, totalCandidates: 2,
      remoteAIUsed: true, anyFallback: false
    };
    const segments = [makeSegment('s1', 'Crit text')];
    const gap = buildGapBatch(concepts, coverage, segments, 1);
    expect(gap).not.toBeNull();
    expect(gap?.concepts.map((c) => c.term)).toEqual(['Crit']);
  });

  it('returns null if all high-importance concepts are covered', () => {
    const concepts = [makeConcept('Crit', 'critical')];
    const coverage = {
      coveredTerms: new Set(['Crit']),
      batchesCompleted: 1, totalCandidates: 2,
      remoteAIUsed: true, anyFallback: false
    };
    const gap = buildGapBatch(concepts, coverage, [], 1);
    expect(gap).toBeNull();
  });
});
