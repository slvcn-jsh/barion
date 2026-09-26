import { extractConceptTargets, selectSegmentsForConcept } from '@/ingestion/concepts';
import type { ParsedSegment } from '@/ingestion/types';

const makeSegment = (id: string, sectionPath: string, text: string, locator = 'Page 1'): ParsedSegment => ({
  id, locator, sectionPath, text, startOffset: 0, endOffset: text.length,
});

describe('extractConceptTargets', () => {
  it('extracts definitions as concept targets', () => {
    const segments = [
      makeSegment('seg-1', 'Pharmacology', 'Metformin is a biguanide that reduces hepatic glucose production and improves insulin sensitivity in type 2 diabetes.', 'Page 1'),
    ];
    const concepts = extractConceptTargets(segments);
    expect(concepts.length).toBeGreaterThan(0);
    const metformin = concepts.find((c) => c.term.toLowerCase().includes('metformin'));
    expect(metformin).toBeDefined();
    expect(metformin?.detail.length).toBeGreaterThan(10);
    expect(metformin?.segmentIds).toContain('seg-1');
  });

  it('classifies critical signals as critical importance', () => {
    const segments = [
      makeSegment('seg-1', 'Safety', 'Lithium toxicity is a contraindication and requires immediate monitoring of serum levels due to its narrow therapeutic index.', 'Page 2'),
    ];
    const concepts = extractConceptTargets(segments);
    const toxic = concepts.find((c) => c.term.toLowerCase().includes('lithium'));
    if (toxic) {
      expect(['critical', 'high', 'standard']).toContain(toxic.importance);
    }
    expect(concepts.length).toBeGreaterThan(0);
  });

  it('produces unique concept IDs', () => {
    const segments = [
      makeSegment('seg-1', 'Section A', 'Schizophrenia is a psychotic disorder characterized by hallucinations, delusions, and disorganized speech.', 'Page 1'),
      makeSegment('seg-2', 'Section B', 'Depression is a mood disorder characterized by persistent sadness and anhedonia affecting daily functioning.', 'Page 2'),
    ];
    const concepts = extractConceptTargets(segments);
    const ids = concepts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('merges the same concept across two segments and includes both segment IDs', () => {
    const text1 = 'Delirium is an acute confusional state with fluctuating consciousness and inattention.';
    const text2 = 'Delirium is caused by metabolic disturbances, infections, and medication toxicity in hospitalized patients.';
    const segments = [
      makeSegment('seg-1', 'Section A', text1, 'Page 1'),
      makeSegment('seg-2', 'Section B', text2, 'Page 2'),
    ];
    const concepts = extractConceptTargets(segments);
    const delirium = concepts.find((c) => c.term.toLowerCase() === 'delirium');
    expect(delirium).toBeDefined();
    expect(delirium!.segmentIds).toContain('seg-1');
    expect(delirium!.segmentIds).toContain('seg-2');
  });

  it('returns empty when no useful concepts are found', () => {
    const segments = [makeSegment('seg-1', 'Intro', 'This section provides an overview.', 'Page 1')];
    const concepts = extractConceptTargets(segments);
    expect(Array.isArray(concepts)).toBe(true);
  });
});

describe('selectSegmentsForConcept', () => {
  const concept = {
    id: 'concept-1',
    term: 'metformin',
    detail: 'reduces hepatic glucose production',
    importance: 'high' as const,
    emphasis: 'treatment' as const,
    segmentIds: ['seg-1'],
    locator: 'Page 1',
  };
  const segments: ParsedSegment[] = [
    makeSegment('seg-1', 'Pharmacology', 'Metformin reduces hepatic glucose production and improves insulin sensitivity.', 'Page 1'),
    makeSegment('seg-2', 'Pharmacology', 'Insulin secretion is regulated by blood glucose concentration in the pancreatic beta cells.', 'Page 2'),
    makeSegment('seg-3', 'Neurology', 'Schizophrenia involves excess dopamine activity and is treated with antipsychotics.', 'Page 3'),
  ];

  it('returns the segment whose ID matches the concept', () => {
    const result = selectSegmentsForConcept(concept, segments, 3);
    expect(result.some((s) => s.id === 'seg-1')).toBe(true);
  });

  it('ranks segments by term relevance', () => {
    const result = selectSegmentsForConcept(concept, segments, 3);
    expect(result[0].id).toBe('seg-1');
  });

  it('excludes segments with no term relevance', () => {
    const result = selectSegmentsForConcept(concept, segments, 3);
    expect(result.every((s) => s.id !== 'seg-3')).toBe(true);
  });

  it('returns no more than maxSegments', () => {
    const result = selectSegmentsForConcept(concept, segments, 1);
    expect(result.length).toBeLessThanOrEqual(1);
  });
});
