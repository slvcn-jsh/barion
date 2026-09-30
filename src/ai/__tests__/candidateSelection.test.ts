import { candidateValue, selectCandidatesForAutomaticStudy } from '@/ai/candidateSelection';
import type { ProductionEvaluation } from '@/ai/evaluation';
import type { GroundedCardCandidate } from '@/ai/types';
import type { ConceptTarget } from '@/ingestion/concepts';

function evaluation(disposition: ProductionEvaluation['publicationDisposition'] = 'PUBLISH'): ProductionEvaluation {
  return {
    contractVersion: '1.0.0',
    evaluationVersion: '2.0.0',
    policyVersion: '3.1.0',
    sourceSpan: {
      status: 'exact', startOffset: 0, endOffset: 20, version: '1.0.0',
      offsetEncoding: 'utf16-code-units', boundaryConvention: 'half-open',
      evidenceTextSha256: 'e', sourceTextSha256: 's', matchCount: 1,
    },
    evidenceSpanVerified: true,
    sourceClaimSupported: disposition === 'PUBLISH' ? 'supported' : 'unsupported',
    citationStatus: 'exact',
    medicalRisk: 'low',
    medicalVerificationStatus: 'verification_not_required',
    pedagogyStatus: 'acceptable',
    publicationDisposition: disposition,
    reasonCodes: [],
  };
}

function candidate(overrides: Partial<GroundedCardCandidate> = {}): GroundedCardCandidate {
  return {
    segmentId: 's1',
    locator: 'Page 1',
    cardType: 'definition',
    learningObjective: 'Recall abstinence efficacy.',
    question: 'How effective is abstinence in preventing pregnancy?',
    answer: 'Abstinence is 100% effective in preventing pregnancy.',
    evidenceText: 'Abstinence: Abstinence is 100% effective in preventing pregnancy.',
    evaluation: evaluation(),
    ...overrides,
  };
}

describe('selectCandidatesForAutomaticStudy', () => {
  it('silently drops unsafe and semantically duplicate candidates', () => {
    const selection = selectCandidatesForAutomaticStudy([
      { candidate: candidate(), qualityScore: 0.95 },
      { candidate: candidate({ question: 'What is the pregnancy prevention effectiveness of abstinence?' }), qualityScore: 0.9 },
      { candidate: candidate({ question: 'Unsupported claim?', evaluation: evaluation('REJECT') }), qualityScore: 0.99 },
    ], 0.82);

    expect(selection.selected).toHaveLength(1);
    expect(selection.dropped.map((item) => item.reason).sort()).toEqual(['duplicate', 'unsafe']);
  });

  it('caps a two-page source at sixteen high-value cards', () => {
    const candidates = Array.from({ length: 24 }, (_, index) => ({
      candidate: candidate({
        segmentId: `s${index}`,
        locator: index % 2 ? 'Page 1' : 'Page 2',
        question: `Which unique marker ${index} is tested?`,
        answer: `Marker ${index} identifies finding ${index}.`,
        evidenceText: `Topic ${index}: Marker ${index} identifies finding ${index}.`,
      }),
      qualityScore: 0.9,
    }));
    const selection = selectCandidatesForAutomaticStudy(candidates, 0.82);

    expect(selection.maxCards).toBe(16);
    expect(selection.selected).toHaveLength(16);
    expect(selection.dropped.filter((item) => item.reason === 'budget')).toHaveLength(8);
  });

  it('keeps distinct facts that share one broad evidence excerpt', () => {
    const evidenceText = [
      'Methods of Birth Control: Abstinence is 100% effective.',
      'Withdrawal has a 25% first-year pregnancy rate.',
      'Fertility awareness monitors basal body temperature, cervical position, and cervical mucus.',
      'Hormonal contraception does not protect against STIs.',
    ].join(' ');
    const selection = selectCandidatesForAutomaticStudy([
      {
        candidate: candidate({
          question: 'How effective is abstinence?',
          answer: 'Answer: Abstinence is 100% effective.',
          evidenceText,
        }),
        qualityScore: 0.98,
      },
      {
        candidate: candidate({
          cardType: 'risk-factor',
          question: 'What is the first-year pregnancy rate with withdrawal?',
          answer: 'Answer: Withdrawal has a 25% first-year pregnancy rate.',
          evidenceText,
        }),
        qualityScore: 0.98,
      },
      {
        candidate: candidate({
          cardType: 'mechanism',
          question: 'Which indicators does fertility awareness monitor?',
          answer: 'Answer: Basal body temperature, cervical position, and cervical mucus.',
          evidenceText,
        }),
        qualityScore: 0.98,
      },
      {
        candidate: candidate({
          cardType: 'contraindication',
          question: 'Do hormonal contraceptives protect against STIs?',
          answer: 'Answer: Hormonal contraception does not protect against STIs.',
          evidenceText,
        }),
        qualityScore: 0.98,
      },
    ], 0.82);

    expect(selection.selected).toHaveLength(4);
    expect(selection.dropped).toHaveLength(0);
  });

  it('keeps one explicit anchor for each distinct source target', () => {
    const targets: ConceptTarget[] = ['Contraception', 'Abstinence'].map((term, index) => ({
      id: `target-${index}`,
      term,
      detail: `${term} is a birth control concept.`,
      importance: 'standard',
      emphasis: 'definition',
      segmentIds: ['s1'],
      locator: 'Page 1',
      targetType: 'named-concept',
      frontStyle: 'term',
      primary: true,
    }));
    const selection = selectCandidatesForAutomaticStudy(targets.map((target) => ({
      candidate: candidate({
        targetId: target.id,
        question: target.term,
        learningObjective: `Recall ${target.term}.`,
        answer: 'Answer: A method of birth control.',
      }),
      qualityScore: 0.95,
    })), 0.82, targets);

    expect(selection.selected).toHaveLength(2);
    expect(selection.dropped).toHaveLength(0);
  });

  it('applies the absolute budget while selecting target anchors', () => {
    const targets: ConceptTarget[] = Array.from({ length: 20 }, (_, index) => ({
      id: `target-${index}`,
      term: `Concept ${index}`,
      detail: `Concept ${index} has distinct source detail.`,
      importance: 'standard',
      emphasis: 'definition',
      segmentIds: [`s${index}`],
      locator: `Page ${(index % 3) + 1}`,
      targetType: 'named-concept',
      frontStyle: 'term',
      primary: true,
    }));
    const selection = selectCandidatesForAutomaticStudy(targets.map((target, index) => ({
      candidate: candidate({
        targetId: target.id,
        segmentId: `s${index}`,
        locator: `Page ${(index % 3) + 1}`,
        question: target.term,
        answer: `Answer: Distinct fact ${index}.`,
        evidenceText: `Concept ${index}: Distinct fact ${index}.`,
      }),
      qualityScore: 0.95,
    })), 0.82, targets);

    expect(selection.maxCards).toBe(18);
    expect(selection.selected).toHaveLength(18);
    expect(selection.dropped.filter((item) => item.reason === 'budget')).toHaveLength(2);
  });

  it('ranks grounded evidence coverage above equal-quality weak coverage', () => {
    const strong = { candidate: candidate(), qualityScore: 0.9 };
    const weak = {
      candidate: candidate({ answer: 'Unrelated vocabulary appears here.' }),
      qualityScore: 0.9,
    };
    expect(candidateValue(strong)).toBeGreaterThan(candidateValue(weak));
  });
});
