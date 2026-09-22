import contract from '../../services/card_evaluation/policy_contract.json';

export type PublicationDisposition = 'PUBLISH' | 'SANITIZE' | 'REVIEW' | 'REJECT';
export type EvaluationFacts = {
  coreSource: string;
  optionalSource: string;
  citation: string;
  risk: string;
  verification: string;
  sanitized: boolean;
};

export const EVALUATION_CONTRACT_VERSION = '1.0.0';
export const PUBLICATION_POLICY_VERSION = '3.1.0';

export function decidePublication(facts: EvaluationFacts): PublicationDisposition {
  if (facts.coreSource === 'unsupported' || facts.coreSource === 'contradicted') return 'REJECT';
  if (facts.optionalSource === 'unsupported' && !facts.sanitized) return 'SANITIZE';
  if (!['exact', 'sufficient'].includes(facts.citation)) return 'REVIEW';
  if (['conflict', 'incorrect', 'outdated'].includes(facts.verification)) return 'REVIEW';
  if (['critical', 'high'].includes(facts.risk)
      && !['verified', 'likely_correct'].includes(facts.verification)) return 'REVIEW';
  return 'PUBLISH';
}

export function isAutoStudyEligible(disposition: PublicationDisposition) {
  return disposition === 'PUBLISH';
}

export function policyContract() {
  return contract;
}
