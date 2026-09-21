import type { PublicationDisposition } from '@/ai/publicationPolicy';

export type SanitizationResult = {
  original: { question: string; answer: string };
  sanitized: { question: string; answer: string };
  metadata: { version: '1.0.0'; removedContent: string[]; reason: string; reevaluated: true };
  disposition: PublicationDisposition;
};

export function sanitizeOptionalAnswer(
  candidate: { question: string; answer: string },
  unsupportedLabels: ('Why it matters' | 'Study note')[],
  reevaluate: (candidate: { question: string; answer: string }) => PublicationDisposition,
): SanitizationResult {
  const fields = parseFields(candidate.answer);
  const removedContent: string[] = [];
  for (const label of unsupportedLabels) {
    const value = fields.get(label);
    if (value) removedContent.push(`${label}: ${value}`);
    fields.delete(label);
  }
  const core = fields.get('Answer');
  if (!core) throw new Error('Sanitization cannot remove or lose core answer.');
  const sanitized = { question: candidate.question, answer: [...fields].map(([label, value]) => `${label}: ${value}`).join('\n') };
  const disposition = reevaluate(sanitized);
  return { original: { ...candidate }, sanitized,
    metadata: { version: '1.0.0', removedContent, reason: 'Unsupported optional source enrichment removed.', reevaluated: true },
    disposition: disposition === 'SANITIZE' ? 'REVIEW' : disposition };
}

function parseFields(answer: string) {
  const matches = [...answer.matchAll(/(?:^|\n)(Answer|Why it matters|Study note):\s*/g)];
  const fields = new Map<string, string>();
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? answer.length;
    fields.set(match[1], answer.slice(start, end).trim());
  }
  return fields;
}
