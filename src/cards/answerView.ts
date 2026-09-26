export type ParsedAnswerSection = {
  label?: string;
  body: string;
};

const KNOWN_LABELS = new Set([
  'answer',
  'clinical use',
  'recall focus',
  'source linked',
  'study note',
  'why it matters',
]);

const LEARNER_HIDDEN_LABELS = new Set([
  'recall focus',
  'source linked',
  'why it matters',
]);

export function parseAnswerSections(answer: string): ParsedAnswerSection[] {
  const lines = answer
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sections = lines.map((line) => {
    const match = line.match(/^(?:\d+[.)]\s*)?(?:[-•*]\s*)?(?:\*{1,2})?([A-Za-z][A-Za-z ]{1,42})(?:\*{1,2})?:\s*(?:\*{1,2})?\s*(.+)$/);
    if (!match) {
      return { body: line.replace(/^[\s*_]+|[\s*_]+$/g, "") };
    }

    const label = match[1].trim();
    if (!KNOWN_LABELS.has(label.toLowerCase())) {
      return { body: line.replace(/^[\s*_]+|[\s*_]+$/g, "") };
    }

    const body = match[2].trim().replace(/^[\s*_]+|[\s*_]+$/g, "");
    return { label, body };
  });

  return sections.length ? sections : [{ body: answer.trim() }];
}

export function learnerAnswer(answer: string) {
  const sections = parseAnswerSections(answer);
  const explicitAnswer = sections.find((section) => section.label?.toLowerCase() === 'answer');
  if (explicitAnswer?.body.trim()) return explicitAnswer.body.trim();

  const visible = sections
    .filter((section) => !section.label || !LEARNER_HIDDEN_LABELS.has(section.label.toLowerCase()))
    .map((section) => section.body.trim())
    .filter(Boolean);

  return visible.join('\n').trim() || answer.trim();
}

export function answerHasLearnerHiddenMetadata(answer: string) {
  return parseAnswerSections(answer).some((section) => (
    section.label ? LEARNER_HIDDEN_LABELS.has(section.label.toLowerCase()) : false
  ));
}
