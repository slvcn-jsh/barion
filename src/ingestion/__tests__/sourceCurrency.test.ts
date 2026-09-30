import { detectSourceCurrency } from '@/ingestion/sourceCurrency';

describe('detectSourceCurrency', () => {
  it('recognizes compact revision dates and marks old medical sources', () => {
    expect(detectSourceCurrency('University reviewer. Rev. 7/19', new Date('2026-09-27'))).toEqual({
      label: 'July 2019',
      year: 2019,
      potentiallyStale: true,
    });
  });

  it('returns null when source has no publication date', () => {
    expect(detectSourceCurrency('Lecture notes without date.', new Date('2026-09-27'))).toBeNull();
  });
});

