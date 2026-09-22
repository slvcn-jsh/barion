import type { SourceSpan } from '@/ai/sourceSpan';
import type { PublicationDisposition } from '@/ai/publicationPolicy';

export type SourceSupportStatus =
  | 'supported_by_citation' | 'supported_by_segment' | 'supported_elsewhere_in_source'
  | 'externally_supported_only' | 'unsupported' | 'contradicted' | 'uncertain';

export type MedicalVerificationStatus =
  | 'verified' | 'likely_correct' | 'conflict' | 'incorrect' | 'outdated' | 'uncertain'
  | 'verification_not_required' | 'not_performed_offline' | 'authority_unavailable';

export type ClaimEvaluation = {
  claimId: string;
  field: 'question' | 'core_answer' | 'explanation' | 'study_note' | 'learning_objective';
  claimText: string;
  claimType: string;
  removable: boolean;
  riskLevel: 'critical' | 'high' | 'moderate' | 'low';
  requiresVerification: boolean;
  sourceSupport: SourceSupportStatus;
  sourceFidelity: 'fully_grounded' | 'partially_grounded' | 'unsupported' | 'contradicted_by_source'
    | 'source_not_found' | 'insufficient_evidence' | 'source_conflict' | 'uncertain';
  citationStatus: ProductionEvaluation['citationStatus'];
  verificationStatus: MedicalVerificationStatus;
  supportingEvidence: { segmentId: string; locator: string; text: string; tier: 'citation' | 'segment' | 'document' }[];
  contradictionEvidence: string[];
  reasonCodes: string[];
};

export type ProductionEvaluation = {
  contractVersion: '1.0.0';
  evaluationVersion: '1.0.0' | '2.0.0';
  policyVersion: '3.0.0' | '3.1.0';
  sourceSpan: SourceSpan;
  evidenceSpanVerified: boolean;
  sourceClaimSupported: 'not_evaluated' | 'supported' | 'unsupported' | 'contradicted' | 'uncertain';
  citationStatus: 'exact' | 'sufficient' | 'partial' | 'wrong_segment' | 'missing' | 'overbroad' | 'uncertain' | 'stale';
  medicalRisk: 'critical' | 'high' | 'moderate' | 'low' | 'none';
  medicalVerificationStatus: MedicalVerificationStatus;
  pedagogyStatus: 'not_evaluated' | 'acceptable' | 'review';
  publicationDisposition: PublicationDisposition;
  reasonCodes: string[];
  claimResults?: ClaimEvaluation[];
  originalCandidate?: {
    segmentId: string;
    locator: string;
    cardType: string;
    question: string;
    answer: string;
    learningObjective: string;
    evidenceText: string;
    evidenceSpan: SourceSpan;
  };
  sanitization?: {
    version: '1.0.0';
    initialDisposition: 'SANITIZE';
    finalDisposition: 'PUBLISH' | 'REVIEW' | 'REJECT';
    removedContent: { field: 'explanation' | 'study_note'; text: string }[];
    reason: string;
    reevaluated: true;
  };
  validatorVersion?: string;
};

export function sourceSpanEvaluation(span: SourceSpan): ProductionEvaluation {
  const verified = ['exact', 'normalized', 'context-disambiguated'].includes(span.status);
  return {
    contractVersion: '1.0.0', evaluationVersion: '1.0.0', policyVersion: '3.1.0', sourceSpan: span,
    evidenceSpanVerified: verified, sourceClaimSupported: 'not_evaluated',
    citationStatus: span.status === 'stale-source' ? 'stale' : verified ? 'exact' : 'uncertain',
    medicalRisk: 'none', medicalVerificationStatus: 'verification_not_required',
    pedagogyStatus: 'not_evaluated', publicationDisposition: verified ? 'REVIEW' : 'REJECT',
    reasonCodes: verified ? ['CLAIM_SUPPORT_NOT_EVALUATED'] : ['EVIDENCE_SPAN_UNRESOLVED'],
  };
}

export function localExtractiveEvaluation(span: SourceSpan): ProductionEvaluation {
  const base = sourceSpanEvaluation(span);
  if (!base.evidenceSpanVerified) return base;
  return {
    ...base,
    sourceClaimSupported: 'supported',
    citationStatus: 'exact',
    publicationDisposition: 'PUBLISH',
    reasonCodes: ['DETERMINISTIC_EXTRACTIVE_SOURCE_SUPPORT'],
  };
}

