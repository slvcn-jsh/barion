import {
  describeGatewayCardQuality,
  evaluateGatewayCardQuality,
  shouldAutoPublishCandidate,
} from '@/ai/cardQuality';
import type { GroundedCardCandidate } from '@/ai/types';

const strongCard: GroundedCardCandidate = {
  segmentId: 'segment-1',
  locator: 'Page 4',
  cardType: 'mechanism',
  learningObjective: 'Explain how metformin changes hepatic glucose handling.',
  question: 'How does metformin affect hepatic glucose production?',
  answer: [
    'Answer: It reduces hepatic glucose production.',
    'Why it matters: This action improves glucose handling.',
    'Study note: Link metformin with reduced hepatic glucose output.',
  ].join('\n'),
  evidenceText: 'Metformin reduces hepatic glucose production and improves insulin sensitivity.',
};

describe('gateway card quality', () => {
  it('rewards complete active-recall cards and clamps scores to the upper bound', () => {
    expect(evaluateGatewayCardQuality(strongCard)).toBe(0.98);
  });

  it('penalizes vague source-dependent questions below the publishing threshold', () => {
    const vagueCard = { ...strongCard, question: 'What does the text say about metformin?' };

    expect(evaluateGatewayCardQuality(vagueCard)).toBeLessThan(0.82);
    expect(describeGatewayCardQuality(vagueCard, evaluateGatewayCardQuality(vagueCard)))
      .toContain('question depends on source wording');
  });

  it('penalizes multi-part compound kitchen-sink questions for violating atomicity', () => {
    const compoundCard = {
      ...strongCard,
      question: 'What is lithium toxicity, what causes it, and how is it treated?',
    };
    const score = evaluateGatewayCardQuality(compoundCard);
    expect(score).toBeLessThan(0.82);
    expect(describeGatewayCardQuality(compoundCard, score))
      .toContain('question is compound rather than atomic');
  });

  it('penalizes mechanically transformed questions that copy sentence structures', () => {
    const mechanicalCard = {
      ...strongCard,
      question: 'What may occur when serum levels become elevated?',
    };
    const score = evaluateGatewayCardQuality(mechanicalCard);
    expect(score).toBeLessThan(0.82);
    expect(describeGatewayCardQuality(mechanicalCard, score))
      .toContain('question is mechanically transformed from source text');
  });

  it('penalizes answers missing required structure and reports the reason', () => {
    const unstructuredCard = { ...strongCard, answer: 'It reduces hepatic glucose production.' };
    const score = evaluateGatewayCardQuality(unstructuredCard);

    expect(score).toBeLessThan(0.82);
    expect(describeGatewayCardQuality(unstructuredCard, score)).toContain('structured answer is incomplete');
  });

  it('keeps every score within the documented bounds', () => {
    const minimalCard: GroundedCardCandidate = {
      segmentId: 's',
      locator: 'p',
      cardType: '',
      learningObjective: '',
      question: 'What does page 1 say?',
      answer: 'x',
      evidenceText: 'x',
    };

    expect(evaluateGatewayCardQuality(minimalCard)).toBe(0.50);
    expect(evaluateGatewayCardQuality(strongCard)).toBeLessThanOrEqual(0.98);
  });

  it('allows any evaluated threshold-passing candidate into publication', () => {
    expect(shouldAutoPublishCandidate(0.82, true, 0.82)).toBe(true);
    expect(shouldAutoPublishCandidate(0.81, true, 0.82)).toBe(false);
    expect(shouldAutoPublishCandidate(0.98, false, 0.82)).toBe(true);
  });
});
