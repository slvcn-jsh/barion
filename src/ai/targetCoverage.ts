import type { GroundedCardCandidate } from '@/ai/types';
import type { ConceptTarget } from '@/ingestion/concepts';

export function resolveCandidateTargetId(
  candidate: GroundedCardCandidate,
  targets: ConceptTarget[],
): string | undefined {
  const explicit = candidate.targetId && targets.find((target) => target.id === candidate.targetId);
  if (explicit) return explicit.id;

  const recallTokens = new Set(contentTokens(
    `${candidate.learningObjective} ${candidate.question} ${coreAnswer(candidate.answer)}`,
  ));
  let best: { id: string; score: number; specificity: number } | undefined;
  for (const target of targets) {
    const targetTokens = contentTokens(target.term);
    if (!targetTokens.length) continue;
    const matched = targetTokens.filter((token) => recallTokens.has(token)).length;
    const score = matched / targetTokens.length;
    if (score < 0.75) continue;
    const segmentBonus = target.segmentIds.includes(candidate.segmentId) ? 0.2 : 0;
    const totalScore = score + segmentBonus;
    const specificity = targetTokens.join('').length;
    if (!best || totalScore > best.score || (totalScore === best.score && specificity > best.specificity)) {
      best = { id: target.id, score: totalScore, specificity };
    }
  }
  return best?.id;
}

export function coveredTargetIds(
  candidates: GroundedCardCandidate[],
  targets: ConceptTarget[],
  isEligible: (candidate: GroundedCardCandidate) => boolean,
) {
  const covered = new Set<string>();
  for (const candidate of candidates) {
    if (!isEligible(candidate)) continue;
    const targetId = resolveCandidateTargetId(candidate, targets);
    if (targetId) covered.add(targetId);
  }
  return [...covered];
}

function coreAnswer(answer: string) {
  return answer
    .replace(/^\s*(?:\*{1,2})?answer(?:\*{1,2})?\s*[:\-]\s*/i, '')
    .split(/\n\s*(?:\*{1,2})?(?:why it matters|study note)(?:\*{1,2})?\s*[:\-]/i)[0]
    .trim();
}

function contentTokens(value: string) {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 2 && !IGNORED_TOKENS.has(token));
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const IGNORED_TOKENS = new Set([
  'about', 'answer', 'card', 'define', 'does', 'identify', 'method', 'recall', 'study',
  'that', 'the', 'their', 'this', 'using', 'what', 'when', 'where', 'which', 'with',
]);
