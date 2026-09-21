import { cardTrustSummary } from '@/cards/trust';

describe('cardTrustSummary', () => {
  it('does not describe auto source links as medical verification', () => {
    expect(
      cardTrustSummary({
        status: 'source_extracted',
        evidence: {
          sourceTitle: 'Lecture 4',
          locator: 'Page 8',
          text: 'Metformin reduces hepatic glucose production.',
          supportScore: 0.91,
          verificationStatus: 'auto-published-extractive',
        },
      }),
    ).toEqual({
      label: 'Source linked',
      detail: '91% source support. Evidence linked, not medical certification.',
      tone: 'source',
    });
  });

  it('prioritizes source review warnings over other card status', () => {
    expect(
      cardTrustSummary({
        status: 'verified',
        evidence: {
          sourceTitle: 'Lecture 4',
          locator: 'Page 8',
          text: 'Ambiguous evidence.',
          supportScore: 0.33,
          verificationStatus: 'needs-source-review',
        },
      }).label,
    ).toBe('Needs source check');
  });

  it('does not treat gateway evidence coordinates as claim verification', () => {
    expect(cardTrustSummary({
      status: 'needs_review',
      evidence: { sourceTitle: 'Source', locator: 'Page 1', text: 'Evidence', supportScore: 1,
        verificationStatus: 'gateway-evidence-span-verified' },
    }).label).toBe('Needs source check');
  });
});
