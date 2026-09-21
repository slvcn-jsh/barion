import type { GroundedCardCandidate } from '@/ai/types';

const SUPPORTED_CARD_TYPES = new Set([
  'clinical-finding',
  'treatment-reasoning',
  'diagnostic-reasoning',
  'mechanism',
  'contraindication',
  'definition',
  'risk-factor',
  'comparison',
  'classification',
  'algorithm-step',
]);

const STRUCTURED_ANSWER_LABELS = [/^answer:/im, /^why it matters:/im, /^study note:/im];
const VAGUE_QUESTION = /\bwhat does\s+(?:page\s+\w+|the (?:text|section|author|document|source))\b|\baccording to\s+(?:page\s+\w+|the (?:text|section|document|source))\b/i;

export function evaluateGatewayCardQuality(draft: GroundedCardCandidate): number {
  const structuredLabelCount = STRUCTURED_ANSWER_LABELS.filter((pattern) => pattern.test(draft.answer)).length;
  let score = 0.52;

  if (draft.question.length >= 15 && draft.question.length <= 250) score += 0.08;
  if (draft.question.trim().endsWith('?')) score += 0.03;
  if (structuredLabelCount === STRUCTURED_ANSWER_LABELS.length) {
    score += 0.18;
  } else {
    score += structuredLabelCount * 0.03;
    score -= 0.10;
  }
  if (draft.answer.length >= 20 && draft.answer.length <= 800) score += 0.06;
  if (draft.evidenceText.length >= 25 && draft.evidenceText.length <= 600) score += 0.06;
  if (draft.learningObjective.length >= 10 && draft.learningObjective.length <= 200) score += 0.04;
  if (SUPPORTED_CARD_TYPES.has(draft.cardType)) score += 0.04;
  if (VAGUE_QUESTION.test(draft.question)) score -= 0.25;

  return Math.max(0.50, Math.min(0.98, Number(score.toFixed(2))));
}

export function describeGatewayCardQuality(draft: GroundedCardCandidate, score: number): string {
  const issues: string[] = [];
  if (VAGUE_QUESTION.test(draft.question)) issues.push('question depends on source wording');
  if (!STRUCTURED_ANSWER_LABELS.every((pattern) => pattern.test(draft.answer))) {
    issues.push('structured answer is incomplete');
  }
  if (!SUPPORTED_CARD_TYPES.has(draft.cardType)) issues.push('card type is unsupported');
  if (draft.evidenceText.length < 25) issues.push('evidence excerpt is too short');

  const reviewReason = issues.length ? issues.join('; ') : 'AI-generated content requires user review';
  const typeLabel = draft.cardType.replace(/-/g, ' ');
  return `${Math.round(score * 100)}% quality · AI active recall · ${typeLabel} · held before publishing: ${reviewReason}.`;
}

export function shouldAutoPublishCandidate(qualityScore: number, isLocalExtractive: boolean, threshold: number): boolean {
  return isLocalExtractive && qualityScore >= threshold;
}
