import { learnerAnswer, parseAnswerSections } from '@/cards/answerView';

describe('parseAnswerSections', () => {
  it('keeps generated medical answer sections readable', () => {
    expect(
      parseAnswerSections([
        'Answer: Metformin reduces hepatic glucose production.',
        'Recall focus: Cause-and-effect link: metformin -> hepatic glucose production.',
        'Why it matters: Mechanism cards support reasoning beyond isolated facts.',
        'Source linked: Page 4.',
      ].join('\n')),
    ).toEqual([
      { label: 'Answer', body: 'Metformin reduces hepatic glucose production.' },
      { label: 'Recall focus', body: 'Cause-and-effect link: metformin -> hepatic glucose production.' },
      { label: 'Why it matters', body: 'Mechanism cards support reasoning beyond isolated facts.' },
      { label: 'Source linked', body: 'Page 4.' },
    ]);
  });

  it('handles markdown bold labels and bullet markers cleanly', () => {
    const raw = [
      '**Answer:** Metformin reduces hepatic glucose production.',
      '- **Why it matters:** First line medication for type 2 diabetes.',
      '**Study note:** Check renal function before starting.',
    ].join('\n');
    expect(parseAnswerSections(raw)).toEqual([
      { label: 'Answer', body: 'Metformin reduces hepatic glucose production.' },
      { label: 'Why it matters', body: 'First line medication for type 2 diabetes.' },
      { label: 'Study note', body: 'Check renal function before starting.' },
    ]);
    expect(learnerAnswer(raw)).toBe('Metformin reduces hepatic glucose production.');
  });

  it('hides internal source metadata from learner answer views', () => {
    expect(
      learnerAnswer([
        'Answer: Metformin reduces hepatic glucose production.',
        'Recall focus: Cause-and-effect link.',
        'Why it matters: Mechanism cards support reasoning.',
        'Source linked: Page 4.',
      ].join('\n')),
    ).toBe('Metformin reduces hepatic glucose production.');
  });
});
