import { createStudyGuide } from '@/ingestion/studyGuide';
import type { ParsedSegment } from '@/ingestion/types';

const segments: ParsedSegment[] = [
  {
    id: 'seg-1',
    locator: 'Page 1',
    sectionPath: 'Schizophrenia',
    text:
      'Schizophrenia is associated with increased dopamine activity and may include hallucinations and delusions. Diagnostic criteria include at least two signs for one month, including hallucinations, delusions, disorganized speech, disorganized behavior, and negative symptoms. Negative symptoms include avolition, alogia, anhedonia, and asociality.',
    startOffset: 0,
    endOffset: 320,
  },
  {
    id: 'seg-2',
    locator: 'Page 2',
    sectionPath: 'Antipsychotic safety',
    text:
      'Neuroleptic malignant syndrome is a potentially fatal condition with hyperthermia, hypertension, and altered mental status. Nursing action includes discontinuing the medication and hydrating the patient. Extrapyramidal symptoms include dystonia, akathisia, and pseudoparkinsonism.',
    startOffset: 0,
    endOffset: 280,
  },
];

describe('createStudyGuide', () => {
  it('builds a source-grounded guide before recall actions', () => {
    const guide = createStudyGuide(segments, 'Psychiatric Nursing Review');

    expect(guide.title).toBe('Study guide for Psychiatric Nursing Review');
    expect(guide.overview).toMatch(/Start with/i);
    expect(guide.outline.length).toBeGreaterThanOrEqual(2);
    expect(guide.quickReference.some((item) => item.term.toLowerCase() === 'schizophrenia')).toBe(true);
    expect(guide.discussionQuestions.length).toBeGreaterThan(0);
  });

  it('keeps learner-facing guide text free of evidence labels', () => {
    const guide = createStudyGuide(segments, 'Psychiatric Nursing Review');
    const serialized = JSON.stringify(guide);

    expect(serialized).not.toMatch(/source linked/i);
    expect(serialized).not.toMatch(/original evidence/i);
    expect(serialized).not.toMatch(/recall focus/i);
  });
});
