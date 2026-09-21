import { sanitizeOptionalAnswer } from '@/ai/sanitization';

test('sanitization preserves original, removes optional content, and reevaluates', () => {
  const original = { question: 'What does metformin do?', answer: 'Answer: Reduces hepatic glucose production.\nWhy it matters: Unsupported cure claim.\nStudy note: Source-supported note.' };
  let evaluated = '';
  const result = sanitizeOptionalAnswer(original, ['Why it matters'], (candidate) => { evaluated = candidate.answer; return 'PUBLISH'; });
  expect(result.original).toEqual(original);
  expect(result.sanitized.answer).not.toContain('Unsupported cure claim');
  expect(result.metadata.removedContent).toEqual(['Why it matters: Unsupported cure claim.']);
  expect(evaluated).toBe(result.sanitized.answer);
  expect(result.disposition).toBe('PUBLISH');
});

test('failed sanitization remains held', () => {
  const result = sanitizeOptionalAnswer({ question: 'Q?', answer: 'Answer: Core.\nStudy note: Unsupported.' }, ['Study note'], () => 'SANITIZE');
  expect(result.disposition).toBe('REVIEW');
});
