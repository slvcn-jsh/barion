import { isAutoStudyEligible, type PublicationDisposition } from '@/ai/publicationPolicy';
import { resolveSourceSpan } from '@/ai/sourceSpan';
import { parseGroundedCardResponse } from '@/ai/validation';

test('mocked production flow persists evaluated candidates and reloads only PUBLISH into study', async () => {
  const importedSource = {
    segmentId: 'segment-1',
    locator: 'Page 1',
    sectionPath: 'Mechanism',
    text: 'Metformin reduces hepatic glucose production.',
  };
  const span = await resolveSourceSpan(importedSource.text, importedSource.text);
  const generated = {
    candidates: [
      rawCandidate('publish', 'PUBLISH', 'supported', 'supported_by_citation', span),
      rawCandidate('review', 'REVIEW', 'supported', 'supported_by_citation', span, ['HIGH_RISK_UNVERIFIED']),
      rawCandidate('reject', 'REJECT', 'unsupported', 'unsupported', span, ['UNSUPPORTED_CORE_CLAIM']),
    ],
  };

  const evaluated = await parseGroundedCardResponse(generated, [importedSource], 3);
  const persisted = new Map(evaluated.map((candidate) => [
    candidate.question,
    JSON.stringify(candidate),
  ]));

  const reloaded = [...persisted.values()].map((value) => JSON.parse(value) as typeof evaluated[number]);
  const studyDeck = reloaded.filter((candidate) =>
    candidate.evaluation && isAutoStudyEligible(candidate.evaluation.publicationDisposition),
  );

  expect(reloaded).toHaveLength(3);
  expect(studyDeck.map((candidate) => candidate.question)).toEqual(['Question publish?']);
  expect(reloaded.find((candidate) => candidate.question === 'Question review?')?.evaluation?.reasonCodes)
    .toContain('HIGH_RISK_UNVERIFIED');
  expect(reloaded.find((candidate) => candidate.question === 'Question reject?')?.evaluation?.claimResults?.[0].sourceSupport)
    .toBe('unsupported');
});

function rawCandidate(
  id: string,
  disposition: PublicationDisposition,
  aggregateSupport: 'supported' | 'unsupported',
  claimSupport: 'supported_by_citation' | 'unsupported',
  span: Awaited<ReturnType<typeof resolveSourceSpan>>,
  reasonCodes: string[] = [],
) {
  const answer = aggregateSupport === 'supported'
    ? 'Answer: Metformin reduces hepatic glucose production.'
    : 'Answer: Metformin cures diabetes.';
  return {
    segmentId: 'segment-1', cardType: 'mechanism',
    learningObjective: `Recall candidate ${id}.`, question: `Question ${id}?`, answer,
    evidenceText: 'Metformin reduces hepatic glucose production.', evidenceSpan: span,
    evaluation: {
      contractVersion: '1.0.0', evaluationVersion: '2.0.0', policyVersion: '3.1.0', sourceSpan: span,
      evidenceSpanVerified: true, sourceClaimSupported: aggregateSupport, citationStatus: 'exact',
      medicalRisk: 'low', medicalVerificationStatus: 'verification_not_required', pedagogyStatus: 'acceptable',
      publicationDisposition: disposition, reasonCodes, validatorVersion: '1.1.0',
      originalCandidate: {
        segmentId: 'segment-1', locator: 'Page 1', cardType: 'mechanism',
        question: `Question ${id}?`, answer, learningObjective: `Recall candidate ${id}.`,
        evidenceText: 'Metformin reduces hepatic glucose production.', evidenceSpan: span,
      },
      claimResults: [{
        claimId: `claim-${id}`, field: 'core_answer', claimText: answer.replace('Answer: ', ''),
        claimType: 'factual', removable: false, riskLevel: 'low', requiresVerification: false,
        sourceSupport: claimSupport,
        sourceFidelity: claimSupport === 'unsupported' ? 'unsupported' : 'fully_grounded',
        citationStatus: 'exact', verificationStatus: 'verification_not_required',
        supportingEvidence: claimSupport === 'unsupported' ? [] : [{
          segmentId: 'segment-1', locator: 'Page 1', text: 'Metformin reduces hepatic glucose production.', tier: 'citation',
        }],
        contradictionEvidence: [], reasonCodes,
      }],
    },
  };
}

test("sanitized candidate with valid reevaluation passes internal quality gate", async () => {
  const source = {
    segmentId: "segment-1",
    locator: "Page 1",
    sectionPath: "Mechanism",
    text: "Metformin reduces hepatic glucose production.",
  };
  const span = await resolveSourceSpan(source.text, source.text);
  const originalAnswer = "Answer: Metformin reduces hepatic glucose production.\nWhy it matters: Cures everything.";
  const sanitizedAnswer = "Answer: Metformin reduces hepatic glucose production.";
  const generated = {
    candidates: [{
      segmentId: "segment-1",
      cardType: "mechanism",
      learningObjective: "Recall metformin mechanism.",
      question: "What does metformin do?",
      answer: sanitizedAnswer,
      evidenceText: "Metformin reduces hepatic glucose production.",
      evidenceSpan: span,
      evaluation: {
        contractVersion: "1.0.0",
        evaluationVersion: "2.0.0",
        policyVersion: "3.1.0",
        sourceSpan: span,
        evidenceSpanVerified: true,
        sourceClaimSupported: "supported",
        citationStatus: "exact",
        medicalRisk: "low",
        medicalVerificationStatus: "verification_not_required",
        pedagogyStatus: "acceptable",
        publicationDisposition: "PUBLISH",
        reasonCodes: ["SANITIZED_AND_REEVALUATED"],
        validatorVersion: "1.1.0",
        originalCandidate: {
          segmentId: "segment-1",
          locator: "Page 1",
          cardType: "mechanism",
          question: "What does metformin do?",
          answer: originalAnswer,
          learningObjective: "Recall metformin mechanism.",
          evidenceText: "Metformin reduces hepatic glucose production.",
          evidenceSpan: span,
        },
        sanitization: {
          version: "1.0.0",
          initialDisposition: "SANITIZE",
          finalDisposition: "PUBLISH",
          removedContent: [{ field: "explanation", text: "Cures everything." }],
          reason: "Unsupported removable optional content removed.",
          reevaluated: true,
        },
        claimResults: [{
          claimId: "claim-sanitized-1",
          field: "core_answer",
          claimText: "Metformin reduces hepatic glucose production",
          claimType: "factual",
          removable: false,
          riskLevel: "low",
          requiresVerification: false,
          sourceSupport: "supported_by_citation",
          sourceFidelity: "fully_grounded",
          citationStatus: "exact",
          verificationStatus: "verification_not_required",
          supportingEvidence: [{
            segmentId: "segment-1",
            locator: "Page 1",
            text: "Metformin reduces hepatic glucose production.",
            tier: "citation",
          }],
          contradictionEvidence: [],
          reasonCodes: [],
        }],
      },
    }],
  };

  const parsed = await parseGroundedCardResponse(generated, [source], 1);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].answer).toBe(sanitizedAnswer);
  expect(isAutoStudyEligible(parsed[0].evaluation!.publicationDisposition)).toBe(true);
});

test("candidate authorization detects content tampering and rejects mismatched candidate", async () => {
  const source = {
    segmentId: "segment-1",
    locator: "Page 1",
    sectionPath: "Mechanism",
    text: "Metformin reduces hepatic glucose production.",
  };
  const span = await resolveSourceSpan(source.text, source.text);
  const generated = {
    candidates: [{
      segmentId: "segment-1",
      cardType: "mechanism",
      learningObjective: "Recall metformin mechanism.",
      question: "Tampered question?",
      answer: "Answer: Metformin reduces hepatic glucose production.",
      evidenceText: "Metformin reduces hepatic glucose production.",
      evidenceSpan: span,
      evaluation: {
        contractVersion: "1.0.0",
        evaluationVersion: "2.0.0",
        policyVersion: "3.1.0",
        sourceSpan: span,
        evidenceSpanVerified: true,
        sourceClaimSupported: "supported",
        citationStatus: "exact",
        medicalRisk: "low",
        medicalVerificationStatus: "verification_not_required",
        pedagogyStatus: "acceptable",
        publicationDisposition: "PUBLISH",
        reasonCodes: [],
        validatorVersion: "1.1.0",
        originalCandidate: {
          segmentId: "segment-1",
          locator: "Page 1",
          cardType: "mechanism",
          question: "Original question?",
          answer: "Answer: Metformin reduces hepatic glucose production.",
          learningObjective: "Recall metformin mechanism.",
          evidenceText: "Metformin reduces hepatic glucose production.",
          evidenceSpan: span,
        },
        claimResults: [{
          claimId: "claim-tampered-1",
          field: "core_answer",
          claimText: "Metformin reduces hepatic glucose production",
          claimType: "factual",
          removable: false,
          riskLevel: "low",
          requiresVerification: false,
          sourceSupport: "supported_by_citation",
          sourceFidelity: "fully_grounded",
          citationStatus: "exact",
          verificationStatus: "verification_not_required",
          supportingEvidence: [{
            segmentId: "segment-1",
            locator: "Page 1",
            text: "Metformin reduces hepatic glucose production.",
            tier: "citation",
          }],
          contradictionEvidence: [],
          reasonCodes: [],
        }],
      },
    }],
  };

  await expect(parseGroundedCardResponse(generated, [source], 1)).rejects.toThrow();
});
