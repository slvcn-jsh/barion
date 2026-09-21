import { AIResponseValidationError, parseGroundedCardResponse } from '@/ai/validation';
import type { SourceContext } from '@/ai/types';

const segments: SourceContext[] = [{
  segmentId: 'segment-1',
  locator: 'Page 4',
  sectionPath: 'Management',
  text: 'Metformin reduces hepatic glucose production and improves insulin sensitivity.',
}];

describe('parseGroundedCardResponse', () => {
  it('accepts canonical cards and derives locator from trusted source context', async () => {
    const result = await parseGroundedCardResponse({
      candidates: [{
        segmentId: 'segment-1',
        cardType: 'mechanism',
        learningObjective: 'Recall how metformin affects glucose handling.',
        question: 'How does metformin affect glucose handling?',
        answer: 'It reduces hepatic glucose production and improves insulin sensitivity.',
        evidenceText: 'Metformin reduces hepatic glucose production and improves insulin sensitivity.',
      }],
    }, segments, 3);

    expect(result).toEqual([expect.objectContaining({ segmentId: 'segment-1', locator: 'Page 4' })]);
  });

  it('rejects evidence not present in referenced segment', async () => {
    await expect(parseGroundedCardResponse({
      candidates: [{
        segmentId: 'segment-1',
        cardType: 'mechanism',
        learningObjective: 'Recall metformin action.',
        question: 'What does metformin do?',
        answer: 'It cures diabetes.',
        evidenceText: 'Metformin cures diabetes.',
      }],
    }, segments, 3)).rejects.toThrow(AIResponseValidationError);
  });

  it('rejects unknown segments and excess candidates', async () => {
    const candidate = {
      segmentId: 'unknown',
      cardType: 'mechanism',
      learningObjective: 'Recall metformin action.',
      question: 'What does metformin do?',
      answer: 'It changes glucose handling.',
      evidenceText: 'Metformin reduces hepatic glucose production',
    };

    await expect(parseGroundedCardResponse({ candidates: [candidate, candidate] }, segments, 1))
      .rejects.toThrow(AIResponseValidationError);
  });
});