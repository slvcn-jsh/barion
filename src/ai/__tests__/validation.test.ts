import { AIResponseValidationError, parseGroundedCardResponse } from '@/ai/validation';
import type { ClaimEvaluation, ProductionEvaluation } from '@/ai/evaluation';
import { resolveSourceSpan } from '@/ai/sourceSpan';
import type { SourceContext } from '@/ai/types';
import contractCase from '../../../services/card_evaluation/fixtures/production_contract_case.json';

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
    expect(result[0].evaluation?.publicationDisposition).toBe('REVIEW');
  });

  it('revalidates production evaluation metadata and keeps claim-level grounding', async () => {
    const span = await resolveSourceSpan(segments[0].text, segments[0].text);
    const result = await parseGroundedCardResponse({
      candidates: [{
        segmentId: 'segment-1',
        cardType: 'mechanism',
        learningObjective: 'Recall how metformin affects glucose handling.',
        question: 'How does metformin affect glucose handling?',
        answer: 'Answer: Metformin reduces hepatic glucose production and improves insulin sensitivity.',
        evidenceText: segments[0].text,
        evidenceSpan: span,
        evaluation: evaluated(span),
      }],
    }, segments, 3);

    expect(result[0].evaluation).toEqual(expect.objectContaining({
      publicationDisposition: 'PUBLISH',
      sourceClaimSupported: 'supported',
      claimResults: [expect.objectContaining({ sourceSupport: 'supported_by_citation' })],
    }));
  });

  it('accepts the same production contract fixture as the Python gateway', async () => {
    const result = await parseGroundedCardResponse(
      { candidates: [contractCase.candidate] },
      [contractCase.segment],
      1,
    );
    expect(result[0].evaluation?.publicationDisposition).toBe('PUBLISH');
    expect(result[0].evaluation?.claimResults?.[0].sourceSupport).toBe('supported_by_citation');
  });

  it('rejects a gateway PUBLISH decision that lacks semantic source support', async () => {
    const span = await resolveSourceSpan(segments[0].text, segments[0].text);
    const invalid = evaluated(span);
    invalid.sourceClaimSupported = 'unsupported';
    invalid.claimResults[0].sourceSupport = 'unsupported';

    await expect(parseGroundedCardResponse({
      candidates: [{
        segmentId: 'segment-1', cardType: 'mechanism',
        learningObjective: 'Recall metformin action.', question: 'What does metformin do?',
        answer: 'Answer: Metformin cures diabetes.', evidenceText: segments[0].text,
        evidenceSpan: span, evaluation: invalid,
      }],
    }, segments, 3)).rejects.toThrow(AIResponseValidationError);
  });

  it('rejects evaluation metadata that authorizes different card content', async () => {
    const span = await resolveSourceSpan(segments[0].text, segments[0].text);
    const evaluation = evaluated(span);
    await expect(parseGroundedCardResponse({ candidates: [{
      segmentId: 'segment-1',
      cardType: 'mechanism',
      learningObjective: evaluation.originalCandidate.learningObjective,
      question: 'What unrelated question was substituted?',
      answer: evaluation.originalCandidate.answer,
      evidenceText: segments[0].text,
      evidenceSpan: span,
      evaluation,
    }] }, segments, 1)).rejects.toThrow(AIResponseValidationError);
  });

  it('maps legacy gateway evaluation to conservative review without local fallback', async () => {
    const span = await resolveSourceSpan(segments[0].text, segments[0].text);
    const result = await parseGroundedCardResponse({ candidates: [{
      segmentId: 'segment-1',
      cardType: 'mechanism',
      learningObjective: 'Recall metformin action.',
      question: 'What does metformin do?',
      answer: 'Answer: Metformin reduces hepatic glucose production and improves insulin sensitivity.',
      evidenceText: segments[0].text,
      evidenceSpan: span,
      evaluation: {
        contractVersion: '1.0.0',
        evaluationVersion: '1.0.0',
        policyVersion: '3.0.0',
        sourceSpan: span,
      },
    }] }, segments, 1);
    expect(result[0].evaluation).toEqual(expect.objectContaining({
      evaluationVersion: '1.0.0',
      policyVersion: '3.0.0',
      publicationDisposition: 'REVIEW',
      reasonCodes: ['LEGACY_GATEWAY_EVALUATION_REQUIRES_REVIEW'],
    }));
  });

  it('accepts only the deterministic sanitized form authorized by metadata', async () => {
    const span = await resolveSourceSpan(segments[0].text, segments[0].text);
    const evaluation = evaluated(span);
    evaluation.originalCandidate.answer = `${evaluation.originalCandidate.answer}\nWhy it matters: Unsupported enrichment.`;
    evaluation.sanitization = {
      version: '1.0.0',
      initialDisposition: 'SANITIZE',
      finalDisposition: 'PUBLISH',
      removedContent: [{ field: 'explanation', text: 'Unsupported enrichment.' }],
      reason: 'Unsupported removable optional content removed.',
      reevaluated: true,
    };
    evaluation.reasonCodes = ['SANITIZED_AND_REEVALUATED'];
    const result = await parseGroundedCardResponse({ candidates: [{
      segmentId: 'segment-1',
      cardType: evaluation.originalCandidate.cardType,
      learningObjective: evaluation.originalCandidate.learningObjective,
      question: evaluation.originalCandidate.question,
      answer: 'Answer: Metformin reduces hepatic glucose production and improves insulin sensitivity.',
      evidenceText: segments[0].text,
      evidenceSpan: span,
      evaluation,
    }] }, segments, 1);
    expect(result[0].evaluation?.publicationDisposition).toBe('PUBLISH');
    expect(result[0].evaluation?.originalCandidate?.answer).toContain('Unsupported enrichment.');
  });

  it.each([
    ['claim aggregate disagreement', (invalid: ReturnType<typeof evaluated>) => {
      invalid.claimResults[0].sourceSupport = 'unsupported';
      invalid.claimResults[0].sourceFidelity = 'unsupported';
      invalid.claimResults[0].supportingEvidence = [];
    }],
    ['partial core citation', (invalid: ReturnType<typeof evaluated>) => {
      invalid.citationStatus = 'partial';
      invalid.claimResults[0].citationStatus = 'partial';
    }],
    ['high-risk verification unavailable', (invalid: ReturnType<typeof evaluated>) => {
      invalid.medicalRisk = 'high';
      invalid.medicalVerificationStatus = 'authority_unavailable';
      invalid.claimResults[0].riskLevel = 'high';
      invalid.claimResults[0].requiresVerification = true;
      invalid.claimResults[0].verificationStatus = 'authority_unavailable';
    }],
  ])('rejects unsafe PUBLISH metadata: %s', async (_name, mutate) => {
    const span = await resolveSourceSpan(segments[0].text, segments[0].text);
    const invalid = evaluated(span);
    mutate(invalid);

    await expect(parseGroundedCardResponse({ candidates: [{
      segmentId: 'segment-1', cardType: 'mechanism', learningObjective: 'Recall metformin action.',
      question: 'What does metformin do?', answer: 'Answer: Metformin reduces hepatic glucose production and improves insulin sensitivity.',
      evidenceText: segments[0].text, evidenceSpan: span, evaluation: invalid,
    }] }, segments, 1)).rejects.toThrow(AIResponseValidationError);
  });

  it('rejects v2 evaluation metadata without validator version or core claims', async () => {
    const span = await resolveSourceSpan(segments[0].text, segments[0].text);
    const invalid = evaluated(span);
    delete (invalid as Partial<typeof invalid>).validatorVersion;
    invalid.claimResults = [];

    await expect(parseGroundedCardResponse({ candidates: [{
      segmentId: 'segment-1', cardType: 'mechanism', learningObjective: 'Recall metformin action.',
      question: 'What does metformin do?', answer: 'Answer: Metformin reduces hepatic glucose production and improves insulin sensitivity.',
      evidenceText: segments[0].text, evidenceSpan: span, evaluation: invalid,
    }] }, segments, 1)).rejects.toThrow(AIResponseValidationError);
  });

  it('holds evidence not present in referenced segment instead of treating coordinates as support', async () => {
    const result = await parseGroundedCardResponse({
      candidates: [{
        segmentId: 'segment-1',
        cardType: 'mechanism',
        learningObjective: 'Recall metformin action.',
        question: 'What does metformin do?',
        answer: 'It cures diabetes.',
        evidenceText: 'Metformin cures diabetes.',
      }],
    }, segments, 3);
    expect(result[0].evidenceSpan?.status).toBe('not-found');
    expect(result[0].evaluation?.publicationDisposition).toBe('REJECT');
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

type EvaluationFixture = ProductionEvaluation & {
  claimResults: ClaimEvaluation[];
  originalCandidate: NonNullable<ProductionEvaluation['originalCandidate']>;
  validatorVersion: string;
};

function evaluated(span: Awaited<ReturnType<typeof resolveSourceSpan>>): EvaluationFixture {
  return {
    contractVersion: '1.0.0' as const,
    evaluationVersion: '2.0.0' as const,
    policyVersion: '3.1.0' as const,
    sourceSpan: span,
    evidenceSpanVerified: true,
    sourceClaimSupported: 'supported' as 'supported' | 'unsupported',
    citationStatus: 'exact' as const,
    medicalRisk: 'low' as const,
    medicalVerificationStatus: 'verification_not_required' as const,
    pedagogyStatus: 'acceptable' as const,
    publicationDisposition: 'PUBLISH' as const,
    reasonCodes: [],
    originalCandidate: {
      segmentId: 'segment-1',
      locator: 'Page 4',
      cardType: 'mechanism',
      question: 'How does metformin affect glucose handling?',
      answer: 'Answer: Metformin reduces hepatic glucose production and improves insulin sensitivity.',
      learningObjective: 'Recall how metformin affects glucose handling.',
      evidenceText: segments[0].text,
      evidenceSpan: span,
    },
    validatorVersion: '1.1.0',
    claimResults: [{
      claimId: 'claim-1', field: 'core_answer' as const,
      claimText: 'Metformin reduces hepatic glucose production and improves insulin sensitivity.',
      claimType: 'factual', removable: false, riskLevel: 'low' as const,
      requiresVerification: false,
      sourceSupport: 'supported_by_citation' as 'supported_by_citation' | 'unsupported',
      sourceFidelity: 'fully_grounded' as const, citationStatus: 'exact' as const,
      verificationStatus: 'verification_not_required' as const,
      supportingEvidence: [{ segmentId: 'segment-1', locator: 'Page 4', text: segments[0].text, tier: 'citation' as const }],
      contradictionEvidence: [], reasonCodes: [],
    }],
  };
}
