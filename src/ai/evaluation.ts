import type { SourceSpan } from '@/ai/sourceSpan';
import type { PublicationDisposition } from '@/ai/publicationPolicy';

export type ProductionEvaluation = {
  contractVersion: '1.0.0';
  evaluationVersion: '1.0.0';
  policyVersion: '3.0.0';
  sourceSpan: SourceSpan;
  evidenceSpanVerified: boolean;
  sourceClaimSupported: 'not_evaluated' | 'supported' | 'unsupported' | 'contradicted' | 'uncertain';
  citationStatus: 'exact' | 'sufficient' | 'partial' | 'wrong_segment' | 'missing' | 'overbroad' | 'uncertain' | 'stale';
  medicalRisk: 'critical' | 'high' | 'moderate' | 'low' | 'none';
  medicalVerificationStatus: 'verified' | 'likely_correct' | 'conflict' | 'incorrect' | 'outdated' | 'uncertain' | 'verification_not_required' | 'not_performed_offline' | 'authority_unavailable';
  pedagogyStatus: 'not_evaluated' | 'acceptable' | 'review';
  publicationDisposition: PublicationDisposition;
  reasonCodes: string[];
  originalCandidate?: { question: string; answer: string };
  sanitization?: { version: string; removedContent: string[]; reason: string; reevaluated: boolean };
};

export function sourceSpanEvaluation(span: SourceSpan): ProductionEvaluation {
  const verified = ['exact', 'normalized', 'context-disambiguated'].includes(span.status);
  return {
    contractVersion: '1.0.0', evaluationVersion: '1.0.0', policyVersion: '3.0.0', sourceSpan: span,
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

