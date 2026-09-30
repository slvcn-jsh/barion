import { isAutoStudyEligible } from '@/ai/publicationPolicy';
import type { GroundedCardCandidate } from '@/ai/types';
import { resolveCandidateTargetId } from '@/ai/targetCoverage';
import type { ConceptTarget } from '@/ingestion/concepts';

export type ScoredStudyCandidate = {
  candidate: GroundedCardCandidate;
  qualityScore: number;
};

export type CandidateDropReason = 'unsafe' | 'low-quality' | 'duplicate' | 'budget';

export type CandidateSelection = {
  selected: ScoredStudyCandidate[];
  dropped: Array<ScoredStudyCandidate & { reason: CandidateDropReason }>;
  maxCards: number;
};

const ABSOLUTE_MAX_CARDS = 18;
const CARDS_PER_PAGE = 8;

const IGNORED_TOKENS = new Set([
  'about', 'answer', 'card', 'correct', 'does', 'during', 'effective', 'effectiveness',
  'first', 'from', 'have', 'identify', 'method', 'most', 'patient', 'patients', 'recall',
  'regarding', 'source', 'study', 'that', 'their', 'these', 'this', 'those', 'using',
  'what', 'when', 'where', 'which', 'with', 'within', 'would', 'year',
]);

export function selectCandidatesForAutomaticStudy(
  candidates: ScoredStudyCandidate[],
  qualityThreshold: number,
  targets: ConceptTarget[] = [],
): CandidateSelection {
  const maxCards = sourceCardBudget(candidates.map(({ candidate }) => candidate), targets);
  const eligible: ScoredStudyCandidate[] = [];
  const dropped: CandidateSelection['dropped'] = [];

  for (const item of candidates) {
    const disposition = item.candidate.evaluation?.publicationDisposition ?? 'REVIEW';
    if (!isAutoStudyEligible(disposition)) {
      dropped.push({ ...item, reason: 'unsafe' });
    } else if (item.qualityScore < qualityThreshold) {
      dropped.push({ ...item, reason: 'low-quality' });
    } else {
      eligible.push(item);
    }
  }

  eligible.sort((left, right) => candidateValue(right) - candidateValue(left));

  const selected: ScoredStudyCandidate[] = [];
  const selectedItems = new Set<ScoredStudyCandidate>();

  for (const target of targets) {
    if (selected.length >= maxCards) break;
    const anchor = eligible.find((item) => (
      !selectedItems.has(item) && resolveCandidateTargetId(item.candidate, targets) === target.id
    ));
    if (!anchor) continue;
    selected.push(anchor);
    selectedItems.add(anchor);
  }

  for (const item of eligible) {
    if (!selectedItems.has(item) && resolveCandidateTargetId(item.candidate, targets) && selected.length >= maxCards) {
      dropped.push({ ...item, reason: 'budget' });
      selectedItems.add(item);
    }
  }

  for (const item of eligible) {
    if (selectedItems.has(item)) continue;
    const duplicateFact = selected.some((existing) => factSimilarity(existing.candidate, item.candidate) >= 0.9);

    if (duplicateFact) {
      dropped.push({ ...item, reason: 'duplicate' });
      continue;
    }
    if (selected.length >= maxCards) {
      dropped.push({ ...item, reason: 'budget' });
      continue;
    }

    selected.push(item);
  }

  return { selected, dropped, maxCards };
}

export function candidateValue(item: ScoredStudyCandidate) {
  const evaluation = item.candidate.evaluation;
  const grounding = evaluation?.sourceClaimSupported === 'supported'
    ? 1
    : evaluation?.sourceClaimSupported === 'uncertain'
      ? 0.5
      : 0;
  const coverage = evidenceCoverage(item.candidate.answer, item.candidate.evidenceText);
  return (item.qualityScore * 0.5) + (grounding * 0.3) + (coverage * 0.2);
}

function sourceCardBudget(candidates: GroundedCardCandidate[], targets: ConceptTarget[]) {
  const pages = new Set<number>();
  for (const candidate of candidates) {
    const match = candidate.locator.match(/\bpage\s+(\d+)\b/i);
    if (match) pages.add(Number(match[1]));
  }
  const pageBudget = pages.size ? Math.min(ABSOLUTE_MAX_CARDS, pages.size * CARDS_PER_PAGE) : ABSOLUTE_MAX_CARDS;
  return targets.length ? Math.min(pageBudget, targets.length) : pageBudget;
}

function factSimilarity(left: GroundedCardCandidate, right: GroundedCardCandidate) {
  const leftAnswer = contentTokens(coreAnswer(left.answer));
  const rightAnswer = contentTokens(coreAnswer(right.answer));
  const combinedSimilarity = tokenSimilarity(
    contentTokens(`${left.question} ${left.learningObjective} ${coreAnswer(left.answer)}`),
    contentTokens(`${right.question} ${right.learningObjective} ${coreAnswer(right.answer)}`),
  );
  if (Math.min(leftAnswer.length, rightAnswer.length) < 3) return combinedSimilarity;
  return Math.max(tokenSimilarity(leftAnswer, rightAnswer), combinedSimilarity);
}

function coreAnswer(answer: string) {
  return answer
    .replace(/^\s*(?:\*{1,2})?answer(?:\*{1,2})?\s*[:\-]\s*/i, '')
    .split(/\n\s*(?:\*{1,2})?(?:why it matters|study note)(?:\*{1,2})?\s*[:\-]/i)[0]
    .trim();
}

function tokenSimilarity(leftValues: string[], rightValues: string[]) {
  const leftTokens = new Set(leftValues);
  const rightTokens = new Set(rightValues);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function evidenceCoverage(answer: string, evidence: string) {
  const answerTokens = contentTokens(answer);
  if (!answerTokens.length) return 0;
  const evidenceTokens = new Set(contentTokens(evidence));
  return answerTokens.filter((token) => evidenceTokens.has(token)).length / answerTokens.length;
}

function contentTokens(value: string) {
  return normalize(value)
    .split(' ')
    .filter((token) => (/^\d+(?:\.\d+)?$/.test(token) || token.length > 2) && !IGNORED_TOKENS.has(token));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
