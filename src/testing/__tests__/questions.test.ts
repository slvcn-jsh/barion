import type { StudyCard } from '@/domain/types';
import { createInitialFsrsCard } from '@/scheduler/fsrs';
import { buildTestQuestions } from '@/testing/questions';

function card(id: string, cardType: string, answer: string, prompt = `Prompt ${id}`): StudyCard {
  return {
    id,
    deckId: 'deck-1',
    deckTitle: 'Clinical set',
    prompt,
    answer: `Answer: ${answer}`,
    cardType,
    status: 'source_extracted',
    isStarred: false,
    dueAt: '2026-01-01T00:00:00.000Z',
    fsrsCardJson: createInitialFsrsCard(new Date('2026-01-01T00:00:00.000Z')),
  };
}

describe('buildTestQuestions', () => {
  it('falls back to written recall instead of mixing unrelated answer types', () => {
    const cards = [
      card('definition', 'definition', 'A chronic endocrine disorder'),
      card('mechanism', 'mechanism', 'Blocks the angiotensin converting enzyme'),
      card('finding', 'clinical-finding', 'Irregular menses and hirsutism'),
      card('safety', 'contraindication', 'Avoid during pregnancy'),
    ];

    const questions = buildTestQuestions(cards, 'adaptive', 'standard');

    expect(questions).toHaveLength(cards.length);
    expect(questions.every((question) => question.type === 'written-recall')).toBe(true);
    expect(questions.every((question) => question.options.length === 0)).toBe(true);
  });

  it('builds deterministic MCQs only from compatible answer families', () => {
    const cards = [
      card('one', 'clinical-finding', 'Painless cervical lymphadenopathy'),
      card('two', 'clinical-finding', 'Progressive exertional dyspnea'),
      card('three', 'clinical-finding', 'Sudden unilateral leg swelling'),
      card('four', 'clinical-finding', 'Persistent resting tremor'),
    ];

    const first = buildTestQuestions(cards, 'rapid-recall', 'standard');
    const second = buildTestQuestions(cards, 'rapid-recall', 'standard');

    expect(first).toEqual(second);
    expect(first.every((question) => question.type === 'multiple-choice')).toBe(true);
    for (const question of first) {
      expect(question.options).toHaveLength(4);
      expect(new Set(question.options.map((option) => option.label)).size).toBe(4);
      expect(question.options.find((option) => option.id === question.correctOptionId)?.label).toBe(
        question.correctAnswer,
      );
    }
  });

  it('increases production effort in challenging mode with written recall', () => {
    const cards = [
      card('one', 'clinical-finding', 'Painless cervical lymphadenopathy'),
      card('two', 'clinical-finding', 'Progressive exertional dyspnea'),
      card('three', 'clinical-finding', 'Sudden unilateral leg swelling'),
      card('four', 'clinical-finding', 'Persistent resting tremor'),
    ];

    const questions = buildTestQuestions(cards, 'rapid-recall', 'challenging');

    expect(questions[0].type).toBe('written-recall');
    expect(questions[1].type).toBe('multiple-choice');
    expect(questions[2].type).toBe('written-recall');
  });

  it('reverses only the existing card sides without inventing medical content', () => {
    const cards = [
      card('one', 'definition', 'A persistent elevation in arterial pressure', 'What is hypertension?'),
      card('two', 'definition', 'A sustained elevation in blood glucose', 'What is diabetes mellitus?'),
      card('three', 'definition', 'Inflammation of the pericardial sac', 'What is pericarditis?'),
      card('four', 'definition', 'Inflammation of the pancreatic tissue', 'What is pancreatitis?'),
    ];

    const questions = buildTestQuestions(cards, 'rapid-recall', 'standard', 'back-to-front');

    expect(questions[0].prompt).toBe('A persistent elevation in arterial pressure');
    expect(questions[0].correctAnswer).toBe('What is hypertension?');
    expect(questions.every((question) => question.direction === 'back-to-front')).toBe(true);
  });

  it('adds proposed-answer checks to clinical practice without replacing the source answer', () => {
    const cards = [
      card('one', 'clinical-finding', 'Painless cervical lymphadenopathy'),
      card('two', 'clinical-finding', 'Progressive exertional dyspnea'),
      card('three', 'clinical-finding', 'Sudden unilateral leg swelling'),
      card('four', 'clinical-finding', 'Persistent resting tremor'),
      card('five', 'clinical-finding', 'Severe headache with visual changes'),
      card('six', 'clinical-finding', 'Crushing substernal chest pain'),
    ];

    const questions = buildTestQuestions(cards, 'clinical', 'standard', 'front-to-back');
    const proposed = questions.find((question) => question.type === 'true-false');

    expect(proposed).toBeDefined();
    expect(proposed?.proposedAnswer).toBeTruthy();
    expect(proposed?.options.map((option) => option.label)).toEqual(['Correct', 'Not correct']);
    expect(cards.map((item) => item.answer.replace(/^Answer:\s*/, ''))).toContain(proposed?.correctAnswer);
    expect(proposed?.correctAnswer).not.toBe('Correct');
    expect(proposed?.correctAnswer).not.toBe('Not correct');
  });
});
