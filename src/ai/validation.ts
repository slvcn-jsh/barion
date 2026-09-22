import { sourceSpanEvaluation } from '@/ai/evaluation';
import type { ClaimEvaluation, MedicalVerificationStatus, ProductionEvaluation, SourceSupportStatus } from '@/ai/evaluation';
import { BarionAIError } from '@/ai/errors';
import { decidePublication } from '@/ai/publicationPolicy';
import { resolveSourceSpan, type SourceSpan } from '@/ai/sourceSpan';
import type { GroundedCardCandidate, SourceContext } from '@/ai/types';

const MAX_CANDIDATES = 100;

type ValidationIssue = {
  path: string;
  reason: string;
};

type CandidateContent = {
  segmentId: string;
  locator: string;
  cardType: string;
  question: string;
  answer: string;
  learningObjective: string;
  evidenceText: string;
  evidenceSpan: SourceSpan;
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
    const serverSpan = candidate.evidenceSpan === undefined
      ? null
      : parseSourceSpan(candidate.evidenceSpan, `${path}.evidenceSpan`, issues);
    if (serverSpan && !sameSourceSpan(serverSpan, evidenceSpan)) {
      issues.push({ path: `${path}.evidenceSpan`, reason: 'must match locally resolved source coordinates and hashes' });
    }
    const evaluation = candidate.evaluation === undefined
      ? sourceSpanEvaluation(evidenceSpan)
      : parseProductionEvaluation(candidate.evaluation, {
        segmentId,
        locator: segment.locator,
        cardType,
        question,
        answer,
        learningObjective,
        evidenceText,
        evidenceSpan,
      }, evidenceSpan, `${path}.evaluation`, issues);
    if (!evaluation) continue;

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
      evaluation,
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

const SOURCE_SUPPORT = [
  'supported_by_citation', 'supported_by_segment', 'supported_elsewhere_in_source',
  'externally_supported_only', 'unsupported', 'contradicted', 'uncertain',
] as const;
const CITATION = ['exact', 'sufficient', 'partial', 'wrong_segment', 'missing', 'overbroad', 'uncertain', 'stale'] as const;
const RISK = ['critical', 'high', 'moderate', 'low', 'none'] as const;
const VERIFICATION = [
  'verified', 'likely_correct', 'conflict', 'incorrect', 'outdated', 'uncertain',
  'verification_not_required', 'not_performed_offline', 'authority_unavailable',
] as const;
const DISPOSITION = ['PUBLISH', 'SANITIZE', 'REVIEW', 'REJECT'] as const;
const FIELDS = ['question', 'core_answer', 'explanation', 'study_note', 'learning_objective'] as const;
const FIDELITY = [
  'fully_grounded', 'partially_grounded', 'unsupported', 'contradicted_by_source',
  'source_not_found', 'insufficient_evidence', 'source_conflict', 'uncertain',
] as const;

function parseProductionEvaluation(
  value: unknown,
  candidate: CandidateContent,
  localSpan: SourceSpan,
  path: string,
  issues: ValidationIssue[],
): ProductionEvaluation | null {
  const evaluation = asRecord(value);
  if (!evaluation) {
    issues.push({ path, reason: 'must be an object' });
    return null;
  }
  if (evaluation.evaluationVersion === '1.0.0' && evaluation.policyVersion === '3.0.0') {
    return parseLegacyProductionEvaluation(evaluation, localSpan, path, issues);
  }
  const issueCount = issues.length;
  const contractVersion = readLiteral(evaluation.contractVersion, ['1.0.0'] as const, `${path}.contractVersion`, issues);
  const evaluationVersion = readLiteral(evaluation.evaluationVersion, ['2.0.0'] as const, `${path}.evaluationVersion`, issues);
  const policyVersion = readLiteral(evaluation.policyVersion, ['3.1.0'] as const, `${path}.policyVersion`, issues);
  const sourceSpan = parseSourceSpan(evaluation.sourceSpan, `${path}.sourceSpan`, issues);
  const evidenceSpanVerified = readBoolean(evaluation.evidenceSpanVerified, `${path}.evidenceSpanVerified`, issues);
  const sourceClaimSupported = readLiteral(
    evaluation.sourceClaimSupported,
    ['not_evaluated', 'supported', 'unsupported', 'contradicted', 'uncertain'] as const,
    `${path}.sourceClaimSupported`,
    issues,
  );
  const citationStatus = readLiteral(evaluation.citationStatus, CITATION, `${path}.citationStatus`, issues);
  const medicalRisk = readLiteral(evaluation.medicalRisk, RISK, `${path}.medicalRisk`, issues);
  const medicalVerificationStatus = readLiteral(evaluation.medicalVerificationStatus, VERIFICATION, `${path}.medicalVerificationStatus`, issues);
  const pedagogyStatus = readLiteral(evaluation.pedagogyStatus, ['not_evaluated', 'acceptable', 'review'] as const, `${path}.pedagogyStatus`, issues);
  const publicationDisposition = readLiteral(evaluation.publicationDisposition, DISPOSITION, `${path}.publicationDisposition`, issues);
  const reasonCodes = readStringArray(evaluation.reasonCodes, `${path}.reasonCodes`, issues);
  const claimResults = parseClaimResults(evaluation.claimResults, `${path}.claimResults`, issues);
  const originalCandidate = parseOriginalCandidate(evaluation.originalCandidate, `${path}.originalCandidate`, issues);
  const sanitization = evaluation.sanitization === undefined || evaluation.sanitization === null
    ? undefined
    : parseSanitization(evaluation.sanitization, `${path}.sanitization`, issues);
  if (originalCandidate) {
    validateCandidateAuthorization(candidate, originalCandidate, sanitization, path, issues);
  }
  const validatorVersion = typeof evaluation.validatorVersion === 'string' && evaluation.validatorVersion.trim()
    ? evaluation.validatorVersion.trim()
    : undefined;
  if (!validatorVersion) {
    issues.push({ path: `${path}.validatorVersion`, reason: 'must be a non-empty string' });
  }

  if (sourceSpan && !sameSourceSpan(sourceSpan, localSpan)) {
    issues.push({ path: `${path}.sourceSpan`, reason: 'must match locally resolved source coordinates and hashes' });
  }
  const locallyVerified = ['exact', 'normalized', 'context-disambiguated'].includes(localSpan.status);
  if (evidenceSpanVerified !== null && evidenceSpanVerified !== locallyVerified) {
    issues.push({ path: `${path}.evidenceSpanVerified`, reason: 'must agree with locally resolved source span' });
  }
  if (publicationDisposition === 'PUBLISH' && (!locallyVerified || sourceClaimSupported !== 'supported')) {
    issues.push({ path: `${path}.publicationDisposition`, reason: 'PUBLISH requires resolved evidence and supported core claims' });
  }
  if (publicationDisposition === 'PUBLISH' && sanitization && sanitization.finalDisposition !== 'PUBLISH') {
    issues.push({ path: `${path}.sanitization.finalDisposition`, reason: 'must be PUBLISH when sanitized candidate is published' });
  }
  if (claimResults && sourceClaimSupported && citationStatus && medicalRisk && medicalVerificationStatus
      && pedagogyStatus && publicationDisposition) {
    validateEvaluationConsistency({
      claimResults,
      sourceClaimSupported,
      citationStatus,
      medicalRisk,
      medicalVerificationStatus,
      pedagogyStatus,
      publicationDisposition,
      sanitization,
    }, path, issues);
  }
  if (issues.length > issueCount || !contractVersion || !evaluationVersion || !policyVersion || !sourceSpan
      || evidenceSpanVerified === null || !sourceClaimSupported || !citationStatus || !medicalRisk
      || !medicalVerificationStatus || !pedagogyStatus || !publicationDisposition || !reasonCodes
      || !claimResults || !originalCandidate) return null;

  return {
    contractVersion,
    evaluationVersion,
    policyVersion,
    sourceSpan,
    evidenceSpanVerified,
    sourceClaimSupported,
    citationStatus,
    medicalRisk,
    medicalVerificationStatus,
    pedagogyStatus,
    publicationDisposition,
    reasonCodes,
    claimResults,
    originalCandidate,
    sanitization,
    validatorVersion,
  };
}

function parseLegacyProductionEvaluation(
  evaluation: Record<string, unknown>,
  localSpan: SourceSpan,
  path: string,
  issues: ValidationIssue[],
): ProductionEvaluation | null {
  const issueCount = issues.length;
  const contractVersion = readLiteral(evaluation.contractVersion, ['1.0.0'] as const, `${path}.contractVersion`, issues);
  const sourceSpan = parseSourceSpan(evaluation.sourceSpan, `${path}.sourceSpan`, issues);
  if (sourceSpan && !sameSourceSpan(sourceSpan, localSpan)) {
    issues.push({ path: `${path}.sourceSpan`, reason: 'must match locally resolved source coordinates and hashes' });
  }
  if (issues.length > issueCount || !contractVersion || !sourceSpan) return null;

  const evidenceSpanVerified = ['exact', 'normalized', 'context-disambiguated'].includes(localSpan.status);
  return {
    contractVersion,
    evaluationVersion: '1.0.0',
    policyVersion: '3.0.0',
    sourceSpan,
    evidenceSpanVerified,
    sourceClaimSupported: 'not_evaluated',
    citationStatus: localSpan.status === 'stale-source' ? 'stale' : evidenceSpanVerified ? 'exact' : 'uncertain',
    medicalRisk: 'none',
    medicalVerificationStatus: 'verification_not_required',
    pedagogyStatus: 'not_evaluated',
    publicationDisposition: evidenceSpanVerified ? 'REVIEW' : 'REJECT',
    reasonCodes: [evidenceSpanVerified
      ? 'LEGACY_GATEWAY_EVALUATION_REQUIRES_REVIEW'
      : 'EVIDENCE_SPAN_UNRESOLVED'],
  };
}

function validateCandidateAuthorization(
  candidate: CandidateContent,
  original: NonNullable<ProductionEvaluation['originalCandidate']>,
  sanitization: ProductionEvaluation['sanitization'],
  path: string,
  issues: ValidationIssue[],
) {
  const expected = sanitization ? sanitizedCandidate(original, sanitization, path, issues) : original;
  if (!expected || !sameCandidateContent(candidate, expected)) {
    issues.push({ path, reason: 'must authorize the exact returned candidate content' });
  }
}

function sanitizedCandidate(
  original: NonNullable<ProductionEvaluation['originalCandidate']>,
  sanitization: NonNullable<ProductionEvaluation['sanitization']>,
  path: string,
  issues: ValidationIssue[],
): CandidateContent | null {
  const answer = parseStructuredAnswer(original.answer);
  if (!answer) {
    issues.push({ path: `${path}.originalCandidate.answer`, reason: 'must use structured answer labels for sanitization' });
    return null;
  }
  for (const removed of sanitization.removedContent) {
    const field = removed.field === 'explanation' ? 'explanation' : 'studyNote';
    if (answer[field] !== removed.text) {
      issues.push({ path: `${path}.sanitization.removedContent`, reason: 'must match original optional content' });
      return null;
    }
    answer[field] = '';
  }
  const rebuilt = [
    ['Answer', answer.core],
    ['Why it matters', answer.explanation],
    ['Study note', answer.studyNote],
  ].filter(([, text]) => text).map(([label, text]) => `${label}: ${text}`).join('\n');
  return { ...original, answer: rebuilt };
}

function parseStructuredAnswer(value: string) {
  const matches = [...value.matchAll(/^\s*(answer|why\s+it\s+matters|study\s+note)\s*:\s*/gim)];
  if (!matches.length) return null;
  const output = { core: '', explanation: '', studyNote: '' };
  const seen = new Set<string>();
  matches.forEach((match, index) => {
    const label = match[1].toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(label)) return;
    seen.add(label);
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? value.length : value.length;
    const text = value.slice(start, end).replace(/\s+/g, ' ').trim();
    if (label === 'answer') output.core = text;
    if (label === 'why it matters') output.explanation = text;
    if (label === 'study note') output.studyNote = text;
  });
  return output.core ? output : null;
}

function sameCandidateContent(left: CandidateContent, right: CandidateContent) {
  return left.segmentId === right.segmentId
    && left.locator === right.locator
    && left.cardType === right.cardType
    && left.question === right.question
    && left.answer === right.answer
    && left.learningObjective === right.learningObjective
    && left.evidenceText === right.evidenceText
    && sameSourceSpan(left.evidenceSpan, right.evidenceSpan);
}

function validateEvaluationConsistency(
  evaluation: Pick<ProductionEvaluation,
    'sourceClaimSupported' | 'citationStatus' | 'medicalRisk' | 'medicalVerificationStatus'
    | 'pedagogyStatus' | 'publicationDisposition' | 'sanitization'>
    & { claimResults: ClaimEvaluation[] },
  path: string,
  issues: ValidationIssue[],
) {
  const coreClaims = evaluation.claimResults.filter((claim) => ['question', 'core_answer'].includes(claim.field));
  const coreAnswerClaims = coreClaims.filter((claim) => claim.field === 'core_answer');
  const derivedSupport = aggregateCoreSupport(coreClaims);
  const derivedCitation = aggregateCitation(coreClaims);
  const derivedRisk = aggregateRisk(evaluation.claimResults);
  const derivedVerification = aggregateVerification(evaluation.claimResults);

  if (!coreAnswerClaims.length) {
    issues.push({ path: `${path}.claimResults`, reason: 'must contain at least one core_answer claim' });
  }
  if (evaluation.sourceClaimSupported !== derivedSupport) {
    issues.push({ path: `${path}.sourceClaimSupported`, reason: 'must agree with core claim support results' });
  }
  if (evaluation.citationStatus !== derivedCitation) {
    issues.push({ path: `${path}.citationStatus`, reason: 'must agree with core claim citation results' });
  }
  if (evaluation.medicalRisk !== derivedRisk) {
    issues.push({ path: `${path}.medicalRisk`, reason: 'must agree with highest claim risk' });
  }
  if (evaluation.medicalVerificationStatus !== derivedVerification) {
    issues.push({ path: `${path}.medicalVerificationStatus`, reason: 'must agree with claim verification results' });
  }

  if (evaluation.publicationDisposition !== 'PUBLISH') return;
  const unsafeNonRemovable = evaluation.claimResults.some((claim) =>
    !claim.removable && ['externally_supported_only', 'unsupported', 'contradicted', 'uncertain'].includes(claim.sourceSupport));
  if (unsafeNonRemovable) {
    issues.push({ path: `${path}.publicationDisposition`, reason: 'PUBLISH cannot contain unsupported non-removable claims' });
  }
  if (evaluation.pedagogyStatus === 'review') {
    issues.push({ path: `${path}.publicationDisposition`, reason: 'PUBLISH cannot bypass pedagogical review' });
  }
  const optionalUnsupported = evaluation.claimResults.some((claim) =>
    claim.removable && ['externally_supported_only', 'unsupported', 'contradicted', 'uncertain'].includes(claim.sourceSupport));
  const expected = decidePublication({
    coreSource: derivedSupport,
    optionalSource: optionalUnsupported ? 'unsupported' : 'supported',
    citation: derivedCitation,
    risk: derivedRisk,
    verification: derivedVerification,
    sanitized: Boolean(evaluation.sanitization?.reevaluated),
  });
  if (expected !== 'PUBLISH') {
    issues.push({ path: `${path}.publicationDisposition`, reason: `PUBLISH conflicts with client policy result ${expected}` });
  }
}

function aggregateCoreSupport(claims: ClaimEvaluation[]): ProductionEvaluation['sourceClaimSupported'] {
  const statuses = new Set(claims.map((claim) => claim.sourceSupport));
  if (statuses.has('contradicted')) return 'contradicted';
  if (statuses.has('unsupported') || statuses.has('externally_supported_only')) return 'unsupported';
  if (!statuses.size || statuses.has('uncertain')) return 'uncertain';
  return 'supported';
}

function aggregateCitation(claims: ClaimEvaluation[]): ProductionEvaluation['citationStatus'] {
  const statuses = new Set(claims.map((claim) => claim.citationStatus));
  return (['stale', 'wrong_segment', 'missing', 'uncertain', 'overbroad', 'partial', 'sufficient', 'exact'] as const)
    .find((status) => statuses.has(status)) ?? 'uncertain';
}

function aggregateRisk(claims: ClaimEvaluation[]): ProductionEvaluation['medicalRisk'] {
  return (['critical', 'high', 'moderate', 'low'] as const)
    .find((risk) => claims.some((claim) => claim.riskLevel === risk)) ?? 'none';
}

function aggregateVerification(claims: ClaimEvaluation[]): MedicalVerificationStatus {
  const statuses = new Set(claims.map((claim) => claim.verificationStatus));
  return (['incorrect', 'conflict', 'outdated', 'authority_unavailable', 'not_performed_offline', 'uncertain',
    'likely_correct', 'verified', 'verification_not_required'] as const)
    .find((status) => statuses.has(status)) ?? 'verification_not_required';
}

function parseClaimResults(value: unknown, path: string, issues: ValidationIssue[]): ClaimEvaluation[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path, reason: 'must be an array' });
    return null;
  }
  return value.map((item, index) => parseClaimResult(item, `${path}[${index}]`, issues)).filter((item): item is ClaimEvaluation => item !== null);
}

function parseClaimResult(value: unknown, path: string, issues: ValidationIssue[]): ClaimEvaluation | null {
  const item = asRecord(value);
  if (!item) {
    issues.push({ path, reason: 'must be an object' });
    return null;
  }
  const issueCount = issues.length;
  const claimId = requiredString(item.claimId, `${path}.claimId`, issues);
  const field = readLiteral(item.field, FIELDS, `${path}.field`, issues);
  const claimText = requiredString(item.claimText, `${path}.claimText`, issues);
  const claimType = requiredString(item.claimType, `${path}.claimType`, issues);
  const removable = readBoolean(item.removable, `${path}.removable`, issues);
  const riskLevel = readLiteral(item.riskLevel, ['critical', 'high', 'moderate', 'low'] as const, `${path}.riskLevel`, issues);
  const requiresVerification = readBoolean(item.requiresVerification, `${path}.requiresVerification`, issues);
  const sourceSupport = readLiteral(item.sourceSupport, SOURCE_SUPPORT, `${path}.sourceSupport`, issues) as SourceSupportStatus | null;
  const sourceFidelity = readLiteral(item.sourceFidelity, FIDELITY, `${path}.sourceFidelity`, issues);
  const citationStatus = readLiteral(item.citationStatus, CITATION, `${path}.citationStatus`, issues);
  const verificationStatus = readLiteral(item.verificationStatus, VERIFICATION, `${path}.verificationStatus`, issues) as MedicalVerificationStatus | null;
  const supportingEvidence = parseSupportingEvidence(item.supportingEvidence, `${path}.supportingEvidence`, issues);
  const contradictionEvidence = readStringArray(item.contradictionEvidence, `${path}.contradictionEvidence`, issues);
  const reasonCodes = readStringArray(item.reasonCodes, `${path}.reasonCodes`, issues);
  if (issues.length > issueCount || !claimId || !field || !claimText || !claimType || removable === null
      || !riskLevel || requiresVerification === null || !sourceSupport || !sourceFidelity || !citationStatus
      || !verificationStatus || !supportingEvidence || !contradictionEvidence || !reasonCodes) return null;
  return {
    claimId, field, claimText, claimType, removable, riskLevel, requiresVerification,
    sourceSupport, sourceFidelity, citationStatus, verificationStatus,
    supportingEvidence, contradictionEvidence, reasonCodes,
  };
}

function parseSupportingEvidence(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!Array.isArray(value)) {
    issues.push({ path, reason: 'must be an array' });
    return null;
  }
  const output: ClaimEvaluation['supportingEvidence'] = [];
  value.forEach((raw, index) => {
    const item = asRecord(raw);
    if (!item) {
      issues.push({ path: `${path}[${index}]`, reason: 'must be an object' });
      return;
    }
    const segmentId = requiredString(item.segmentId, `${path}[${index}].segmentId`, issues, true);
    const locator = requiredString(item.locator, `${path}[${index}].locator`, issues, true);
    const text = requiredString(item.text, `${path}[${index}].text`, issues);
    const tier = readLiteral(item.tier, ['citation', 'segment', 'document'] as const, `${path}[${index}].tier`, issues);
    if (segmentId !== null && locator !== null && text && tier) output.push({ segmentId, locator, text, tier });
  });
  return output;
}

function parseOriginalCandidate(value: unknown, path: string, issues: ValidationIssue[]) {
  const item = asRecord(value);
  if (!item) {
    issues.push({ path, reason: 'must be an object' });
    return null;
  }
  const segmentId = requiredString(item.segmentId, `${path}.segmentId`, issues);
  const locator = requiredString(item.locator, `${path}.locator`, issues, true);
  const cardType = requiredString(item.cardType, `${path}.cardType`, issues);
  const question = requiredString(item.question, `${path}.question`, issues);
  const answer = requiredString(item.answer, `${path}.answer`, issues);
  const learningObjective = requiredString(item.learningObjective, `${path}.learningObjective`, issues, true);
  const evidenceText = requiredString(item.evidenceText, `${path}.evidenceText`, issues, true);
  const evidenceSpan = parseSourceSpan(item.evidenceSpan, `${path}.evidenceSpan`, issues);
  return segmentId && locator !== null && cardType && question && answer
    && learningObjective !== null && evidenceText !== null && evidenceSpan
    ? { segmentId, locator, cardType, question, answer, learningObjective, evidenceText, evidenceSpan }
    : null;
}

function parseSanitization(value: unknown, path: string, issues: ValidationIssue[]): ProductionEvaluation['sanitization'] | undefined {
  const item = asRecord(value);
  if (!item) {
    issues.push({ path, reason: 'must be an object' });
    return undefined;
  }
  const version = readLiteral(item.version, ['1.0.0'] as const, `${path}.version`, issues);
  const initialDisposition = readLiteral(item.initialDisposition, ['SANITIZE'] as const, `${path}.initialDisposition`, issues);
  const finalDisposition = readLiteral(item.finalDisposition, ['PUBLISH', 'REVIEW', 'REJECT'] as const, `${path}.finalDisposition`, issues);
  const reason = requiredString(item.reason, `${path}.reason`, issues);
  if (item.reevaluated !== true) issues.push({ path: `${path}.reevaluated`, reason: 'must be true' });
  const removedContent: { field: 'explanation' | 'study_note'; text: string }[] = [];
  if (!Array.isArray(item.removedContent)) {
    issues.push({ path: `${path}.removedContent`, reason: 'must be an array' });
  } else {
    item.removedContent.forEach((raw, index) => {
      const removed = asRecord(raw);
      const field = removed ? readLiteral(removed.field, ['explanation', 'study_note'] as const, `${path}.removedContent[${index}].field`, issues) : null;
      const text = removed ? requiredString(removed.text, `${path}.removedContent[${index}].text`, issues) : null;
      if (!removed) issues.push({ path: `${path}.removedContent[${index}]`, reason: 'must be an object' });
      if (field && text) removedContent.push({ field, text });
    });
  }
  if (!removedContent.length) issues.push({ path: `${path}.removedContent`, reason: 'must identify removed optional content' });
  return version && initialDisposition && finalDisposition && reason && item.reevaluated === true
    ? { version, initialDisposition, finalDisposition, removedContent, reason, reevaluated: true }
    : undefined;
}

function parseSourceSpan(value: unknown, path: string, issues: ValidationIssue[]): SourceSpan | null {
  const span = asRecord(value);
  if (!span) {
    issues.push({ path, reason: 'must be an object' });
    return null;
  }
  const version = readLiteral(span.version, ['1.0.0'] as const, `${path}.version`, issues);
  const offsetEncoding = readLiteral(span.offsetEncoding, ['utf16-code-units'] as const, `${path}.offsetEncoding`, issues);
  const boundaryConvention = readLiteral(span.boundaryConvention, ['half-open'] as const, `${path}.boundaryConvention`, issues);
  const status = readLiteral(span.status, ['exact', 'normalized', 'context-disambiguated', 'ambiguous', 'not-found', 'invalid', 'stale-source'] as const, `${path}.status`, issues);
  const startOffset = nullableNonNegativeInteger(span.startOffset, `${path}.startOffset`, issues);
  const endOffset = nullableNonNegativeInteger(span.endOffset, `${path}.endOffset`, issues);
  const evidenceTextSha256 = sha256(span.evidenceTextSha256, `${path}.evidenceTextSha256`, issues);
  const sourceTextSha256 = sha256(span.sourceTextSha256, `${path}.sourceTextSha256`, issues);
  const matchCount = nonNegativeIntegerValue(span.matchCount, `${path}.matchCount`, issues);
  const resolved = status !== null && ['exact', 'normalized', 'context-disambiguated'].includes(status);
  if (resolved !== (startOffset !== null && endOffset !== null)) {
    issues.push({ path, reason: 'resolved spans require offsets; unresolved spans require null offsets' });
  }
  if (startOffset !== null && endOffset !== null && endOffset < startOffset) {
    issues.push({ path: `${path}.endOffset`, reason: 'must not precede startOffset' });
  }
  return version && offsetEncoding && boundaryConvention && status && evidenceTextSha256 && sourceTextSha256 && matchCount !== null
    ? { version, offsetEncoding, boundaryConvention, status, startOffset, endOffset, evidenceTextSha256, sourceTextSha256, matchCount }
    : null;
}

function sameSourceSpan(left: SourceSpan, right: SourceSpan) {
  return left.version === right.version && left.offsetEncoding === right.offsetEncoding
    && left.boundaryConvention === right.boundaryConvention && left.status === right.status
    && left.startOffset === right.startOffset && left.endOffset === right.endOffset
    && left.evidenceTextSha256 === right.evidenceTextSha256
    && left.sourceTextSha256 === right.sourceTextSha256 && left.matchCount === right.matchCount;
}

function readLiteral<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  issues: ValidationIssue[],
): T | null {
  if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
  issues.push({ path, reason: `must be one of ${allowed.join(', ')}` });
  return null;
}

function readBoolean(value: unknown, path: string, issues: ValidationIssue[]) {
  if (typeof value === 'boolean') return value;
  issues.push({ path, reason: 'must be a boolean' });
  return null;
}

function requiredString(value: unknown, path: string, issues: ValidationIssue[], allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    issues.push({ path, reason: allowEmpty ? 'must be a string' : 'must be a non-empty string' });
    return null;
  }
  return value.trim();
}

function readStringArray(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    issues.push({ path, reason: 'must be an array of strings' });
    return null;
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function nullableNonNegativeInteger(value: unknown, path: string, issues: ValidationIssue[]) {
  if (value === null) return null;
  if (Number.isInteger(value) && Number(value) >= 0) return Number(value);
  issues.push({ path, reason: 'must be null or a non-negative integer' });
  return null;
}

function nonNegativeIntegerValue(value: unknown, path: string, issues: ValidationIssue[]) {
  if (Number.isInteger(value) && Number(value) >= 0) return Number(value);
  issues.push({ path, reason: 'must be a non-negative integer' });
  return null;
}

function sha256(value: unknown, path: string, issues: ValidationIssue[]) {
  if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) return value;
  issues.push({ path, reason: 'must be a lowercase SHA-256 digest' });
  return null;
}
