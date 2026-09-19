import { createExtractiveDrafts } from '@/ingestion/drafts';
import type { ParsedSegment } from '@/ingestion/types';

const segment: ParsedSegment = {
  id: 'segment-1',
  locator: 'Page 4',
  sectionPath: 'PCOS management',
  text: [
    'Polycystic ovary syndrome is an endocrine disorder characterized by hyperandrogenism and ovulatory dysfunction.',
    'Metformin reduces hepatic glucose production and improves insulin sensitivity.',
    'Combined oral contraceptives should be avoided in patients with high thrombosis risk because estrogen increases clot risk.',
  ].join(' '),
  startOffset: 0,
  endOffset: 335,
};

describe('createExtractiveDrafts', () => {
  it('is deterministic and does not emit duplicate recall facts', () => {
    const first = createExtractiveDrafts([segment]);
    const second = createExtractiveDrafts([segment]);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    const recallFacts = first.map((draft) => draft.answer.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
    expect(new Set(recallFacts).size).toBe(recallFacts.length);
  });

  it('keeps every draft grounded in its source segment and quality-scored', () => {
    const drafts = createExtractiveDrafts([segment]);

    for (const draft of drafts) {
      expect(draft.segmentId).toBe(segment.id);
      expect(draft.locator).toBe(segment.locator);
      expect(draft.evidenceText.length).toBeGreaterThan(0);
      expect(draft.qualityScore).toBeGreaterThanOrEqual(0);
      expect(draft.qualityScore).toBeLessThanOrEqual(1);
      expect(draft.question).not.toMatch(/key takeaway|main point|what does the source say/i);
    }
  });

  it('formats generated answers as clean learner-facing recall cards', () => {
    const drafts = createExtractiveDrafts([segment]);

    expect(drafts.length).toBeGreaterThan(0);
    for (const draft of drafts) {
      expect(draft.answer).not.toContain('Answer:');
      expect(draft.answer).not.toContain('Recall focus:');
      expect(draft.answer).not.toContain('Why it matters:');
      expect(draft.answer).not.toContain('Source linked:');
      expect(draft.answer).not.toMatch(/main point|key takeaway|this section/i);
    }
  });

  it('does not turn generic cloze words into cards', () => {
    const drafts = createExtractiveDrafts([{
      ...segment,
      text: 'Complex Somatic Symptom Disorder includes headache, chest pain, and illness anxiety disorder.',
    }]);

    expect(drafts.every((draft) => draft.answer.toLowerCase() !== 'symptom.')).toBe(true);
  });
});
