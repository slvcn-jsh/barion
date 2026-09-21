import type { CardStatus, EvidenceSnippet } from '@/domain/types';

export type TrustTone = 'verified' | 'source' | 'review' | 'manual';

export type TrustSummary = {
  label: string;
  detail: string;
  tone: TrustTone;
};

type TrustInput = {
  status?: CardStatus | string;
  evidence?: EvidenceSnippet;
  qualityScore?: number | null;
};

export function cardTrustSummary(card: TrustInput): TrustSummary {
  if (card.status === 'needs_review' || needsSourceReview(card.evidence)) {
    return {
      label: 'Needs source check',
      detail: 'Held out until the wording and source evidence are checked.',
      tone: 'review',
    };
  }

  if (card.status === 'verified' || card.evidence?.verificationStatus === 'built-in-curated-demo') {
    return {
      label: 'Verified',
      detail: 'Curated or manually approved after evidence review.',
      tone: 'verified',
    };
  }

  if (card.evidence) {
    const support = Math.round(Number(card.evidence.supportScore ?? card.qualityScore ?? 0) * 100);
    return {
      label: 'Source linked',
      detail: `${support}% source support. Evidence linked, not medical certification.`,
      tone: 'source',
    };
  }

  return {
    label: 'Manual card',
    detail: 'No source evidence is attached.',
    tone: 'manual',
  };
}

export function needsSourceReview(evidence?: EvidenceSnippet) {
  return evidence?.verificationStatus === 'needs-source-review'
    || evidence?.verificationStatus === 'gateway-evidence-span-verified';
}
