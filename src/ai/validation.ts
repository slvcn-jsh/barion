import { sourceSpanEvaluation } from '@/ai/evaluation';
import { BarionAIError } from '@/ai/errors';
import { resolveSourceSpan } from '@/ai/sourceSpan';
import type { GroundedCardCandidate, SourceContext } from '@/ai/types';

const MAX_CANDIDATES = 100;

type ValidationIssue = {
  path: string;
  reason: string;
};

export class AIResponseValidationError extends BarionAIError {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super('invalid_provider_response', 'Provider response did not match grounded card schema.');
    this.name = 'AIResponseValidationError';
    this.issues = issues;
  }
}

export async function parseGroundedCardResponse(
  value: unknown,
  segments: SourceContext[],
  requestedMaximum: number,
): Promise<GroundedCardCandidate[]> {
  const issues: ValidationIssue[] = [];
  const root = asRecord(value);
  if (!root || !Array.isArray(root.candidates)) {
    throw new AIResponseValidationError([{ path: 'candidates', reason: 'must be an array' }]);
  }

  const maximum = Math.min(Math.max(Math.floor(requestedMaximum), 0), MAX_CANDIDATES);
  if (root.candidates.length > maximum) {
    issues.push({ path: 'candidates', reason: `must contain at most ${maximum} items` });
  }

  const segmentById = new Map(segments.map((segment) => [segment.segmentId, segment]));
  const seen = new Set<string>();
  const candidates: GroundedCardCandidate[] = [];

  for (const [index, rawCandidate] of root.candidates.entries()) {
    const path = `candidates[${index}]`;
    const candidate = asRecord(rawCandidate);
    if (!candidate) {
      issues.push({ path, reason: 'must be an object' });
      continue;
    }

    const segmentId = readString(candidate, 'segmentId', path, issues, 1, 200);
    const cardType = readString(candidate, 'cardType', path, issues, 1, 80);
    const learningObjective = readString(candidate, 'learningObjective', path, issues, 3, 300);
    const question = readString(candidate, 'question', path, issues, 3, 500);
    const answer = readString(candidate, 'answer', path, issues, 1, 2000);
    const evidenceText = readString(candidate, 'evidenceText', path, issues, 1, 4000);

    if (!segmentId || !cardType || !learningObjective || !question || !answer || !evidenceText) continue;

    const segment = segmentById.get(segmentId);
    if (!segment) {
      issues.push({ path: `${path}.segmentId`, reason: 'must reference a supplied source segment' });
      continue;
    }
    const evidenceSpan = await resolveSourceSpan(segment.text, evidenceText);
    if (!['exact', 'normalized', 'context-disambiguated'].includes(evidenceSpan.status)) {
      issues.push({ path: `${path}.evidenceText`, reason: 'must resolve uniquely in its source segment' });
      continue;
    }

    const duplicateKey = normalize(`${question}\n${answer}`);
    if (seen.has(duplicateKey)) {
      issues.push({ path, reason: 'duplicates an earlier candidate' });
      continue;
    }
    seen.add(duplicateKey);
    candidates.push({
      segmentId,
      locator: segment.locator,
      cardType,
      learningObjective,
      question,
      answer,
      evidenceText,
      evidenceSpan,
      evaluation: sourceSpanEvaluation(evidenceSpan),
    });
  }

  if (issues.length) throw new AIResponseValidationError(issues);
  return candidates;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(
  record: Record<string, unknown>,
  key: string,
  parentPath: string,
  issues: ValidationIssue[],
  minimumLength: number,
  maximumLength: number,
) {
  const value = record[key];
  if (typeof value !== 'string') {
    issues.push({ path: `${parentPath}.${key}`, reason: 'must be a string' });
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length < minimumLength || trimmed.length > maximumLength) {
    issues.push({
      path: `${parentPath}.${key}`,
      reason: `must contain ${minimumLength}-${maximumLength} characters`,
    });
    return null;
  }
  return trimmed;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}