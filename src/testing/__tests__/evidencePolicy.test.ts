import { decideTestEvidence } from '@/testing/evidencePolicy';

describe('test evidence policy', () => {
  it('treats wrong and confident as an urgent misconception', () => {
    expect(decideTestEvidence(false, 'confident')).toEqual({
      rating: 'again',
      weakDelta: 4,
      confidentMiss: true,
    });
  });

  it('keeps correct but uncertain concepts close', () => {
    expect(decideTestEvidence(true, 'unsure')).toEqual({
      rating: 'hard',
      weakDelta: -0.25,
      confidentMiss: false,
    });
  });
});
