import { adaptiveCardTypeBoost } from '@/ingestion/drafts';

describe('adaptive medical draft priorities', () => {
  it('prioritizes reasoning and safety for challenging board preparation', () => {
    const profile = {
      reviewStyle: 'clinical-reasoning' as const,
      difficulty: 'challenging' as const,
      examGoal: 'board-style' as const,
    };

    expect(adaptiveCardTypeBoost('diagnostic-reasoning', profile)).toBeGreaterThan(
      adaptiveCardTypeBoost('definition', profile),
    );
    expect(adaptiveCardTypeBoost('contraindication', profile)).toBeGreaterThan(0);
  });

  it('prioritizes stable anchors for a gentle class-quiz profile', () => {
    const profile = {
      reviewStyle: 'concise' as const,
      difficulty: 'gentle' as const,
      examGoal: 'class-quiz' as const,
    };

    expect(adaptiveCardTypeBoost('definition', profile)).toBeGreaterThan(
      adaptiveCardTypeBoost('algorithm-step', profile),
    );
    expect(adaptiveCardTypeBoost('cloze-recall', profile)).toBeGreaterThan(0);
  });

  it('uses comparison and sequence cards as visual structure', () => {
    const profile = {
      reviewStyle: 'visual-support' as const,
      difficulty: 'standard' as const,
      examGoal: 'source-mastery' as const,
    };

    expect(adaptiveCardTypeBoost('comparison', profile)).toBeGreaterThan(
      adaptiveCardTypeBoost('risk-factor', profile),
    );
  });
});
