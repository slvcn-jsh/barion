import type { ParsedSegment } from './types';

export type StudyGuideOutlineSection = {
  id: string;
  title: string;
  bullets: string[];
  emphasis: 'overview' | 'definition' | 'clinical' | 'treatment' | 'safety';
  locator: string;
};

export type StudyGuideQuickReference = {
  id: string;
  term: string;
  detail: string;
  locator: string;
};

export type StudyGuideDiscussionQuestion = {
  id: string;
  prompt: string;
  answer: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
};

export type GeneratedStudyGuide = {
  title: string;
  overview: string;
  outline: StudyGuideOutlineSection[];
  quickReference: StudyGuideQuickReference[];
  discussionQuestions: StudyGuideDiscussionQuestion[];
};

const MAX_SECTIONS = 10;
const MAX_BULLETS_PER_SECTION = 5;
const MAX_QUICK_REFERENCE = 16;
const MAX_DISCUSSION_QUESTIONS = 8;

const MEDICAL_SIGNALS = [
  'assessment',
  'contraindication',
  'criteria',
  'diagnosis',
  'diagnostic',
  'finding',
  'intervention',
  'management',
  'manifestation',
  'mechanism',
  'medication',
  'nursing',
  'pathophysiology',
  'priority',
  'risk',
  'safety',
  'sign',
  'symptom',
  'therapy',
  'treatment',
];

const LOW_VALUE_HEADINGS = new Set([
  'overview',
  'introduction',
  'summary',
  'page',
  'notes',
  'source',
]);

export function createStudyGuide(segments: ParsedSegment[], sourceTitle: string): GeneratedStudyGuide {
  const usableSegments = segments
    .map((segment) => ({ ...segment, text: normalizeSourceText(segment.text) }))
    .filter((segment) => segment.text.length >= 50);

  const outline = buildOutline(usableSegments, sourceTitle);
  const quickReference = buildQuickReference(usableSegments);
  const discussionQuestions = buildDiscussionQuestions(outline, quickReference);

  return {
    title: `Study guide for ${cleanTitle(sourceTitle)}`,
    overview: buildOverview(sourceTitle, outline, quickReference),
    outline,
    quickReference,
    discussionQuestions,
  };
}

function buildOutline(segments: ParsedSegment[], sourceTitle: string): StudyGuideOutlineSection[] {
  const sections = new Map<string, { title: string; locator: string; sentences: string[]; score: number }>();

  for (const segment of segments) {
    const title = sectionTitle(segment.sectionPath, sourceTitle, segment.locator);
    const key = normalizeKey(title);
    const entry = sections.get(key) ?? { title, locator: segment.locator, sentences: [], score: 0 };
    const sentences = splitSentences(segment.text)
      .map((sentence) => ({ sentence, score: sentenceScore(sentence) }))
      .filter((item) => item.score > 0.25)
      .sort((left, right) => right.score - left.score)
      .slice(0, 4);

    entry.sentences.push(...sentences.map((item) => item.sentence));
    entry.score += sentences.reduce((total, item) => total + item.score, 0);
    sections.set(key, entry);
  }

  return [...sections.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_SECTIONS)
    .map((section, index) => {
      const bullets = dedupe(section.sentences)
        .map((sentence) => bulletFromSentence(sentence))
        .filter(Boolean)
        .slice(0, MAX_BULLETS_PER_SECTION);

      return {
        id: `outline-${index + 1}`,
        title: section.title,
        bullets,
        emphasis: classifySection(`${section.title} ${bullets.join(' ')}`),
        locator: section.locator,
      };
    })
    .filter((section) => section.bullets.length > 0);
}

function buildQuickReference(segments: ParsedSegment[]): StudyGuideQuickReference[] {
  const items: StudyGuideQuickReference[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    for (const sentence of splitSentences(segment.text)) {
      const extracted = extractQuickReference(sentence);
      if (!extracted) continue;
      const key = normalizeKey(extracted.term);
      if (seen.has(key) || key.length < 3) continue;
      seen.add(key);
      items.push({
        id: `quick-${items.length + 1}`,
        term: extracted.term,
        detail: extracted.detail,
        locator: segment.locator,
      });
      if (items.length >= MAX_QUICK_REFERENCE) return items;
    }
  }

  return items;
}

function buildDiscussionQuestions(
  outline: StudyGuideOutlineSection[],
  quickReference: StudyGuideQuickReference[],
): StudyGuideDiscussionQuestion[] {
  const questions: StudyGuideDiscussionQuestion[] = [];

  for (const section of outline) {
    if (!section.bullets.length) continue;
    const focus = questionFocus(section.title);
    const prompt = section.emphasis === 'treatment'
      ? `How should you approach management or treatment for ${focus}?`
      : section.emphasis === 'clinical'
        ? `Which findings or patterns matter most for ${focus}?`
        : section.emphasis === 'safety'
          ? `What safety point should you remember about ${focus}?`
          : `What are the key ideas to recall about ${focus}?`;

    questions.push({
      id: `discussion-${questions.length + 1}`,
      prompt,
      answer: section.bullets.slice(0, 3).join(' '),
      difficulty: section.bullets.length >= 4 ? 'Hard' : section.bullets.length >= 2 ? 'Medium' : 'Easy',
    });

    if (questions.length >= MAX_DISCUSSION_QUESTIONS) return questions;
  }

  for (const item of quickReference) {
    questions.push({
      id: `discussion-${questions.length + 1}`,
      prompt: `How would you explain ${item.term} in your own words?`,
      answer: item.detail,
      difficulty: item.detail.length > 120 ? 'Medium' : 'Easy',
    });
    if (questions.length >= MAX_DISCUSSION_QUESTIONS) return questions;
  }

  return questions;
}

function buildOverview(
  sourceTitle: string,
  outline: StudyGuideOutlineSection[],
  quickReference: StudyGuideQuickReference[],
) {
  const title = cleanTitle(sourceTitle);
  const anchors = outline.slice(0, 3).map((section) => section.title);
  const referenceCount = quickReference.length;

  if (!anchors.length) {
    return `${title} was processed into a short source-grounded guide. Review the sections below before starting recall.`;
  }

  const anchorText = anchors.length === 1
    ? anchors[0]
    : `${anchors.slice(0, -1).join(', ')} and ${anchors.at(-1)}`;
  const quickText = referenceCount
    ? ` It also extracted ${referenceCount} quick-reference term${referenceCount === 1 ? '' : 's'} for fast review.`
    : '';

  return `Start with ${anchorText}. These sections contain the highest-yield ideas Barion could extract from ${title}.${quickText}`;
}

function extractQuickReference(sentence: string) {
  const definition = sentence.match(/^(.{3,90}?)\s+(?:is|are|refers to|means|is defined as|are defined as)\s+(.{12,240})$/i);
  if (definition) {
    const term = cleanTerm(definition[1]);
    const detail = cleanSentence(definition[2]);
    if (isUsefulTerm(term) && isUsefulDetail(detail)) return { term, detail };
  }

  const criteria = sentence.match(/^(?:diagnostic criteria for\s+)?(.{3,90}?)\s+(?:include|includes|require|requires)\s+(.{12,240})$/i);
  if (criteria) {
    const term = cleanTerm(criteria[1]);
    const detail = cleanSentence(criteria[2]);
    if (isUsefulTerm(term) && isUsefulDetail(detail)) return { term, detail: `Includes ${lowercaseFirst(detail)}` };
  }

  const colon = sentence.match(/^([^:]{3,80}):\s*(.{12,240})$/);
  if (colon) {
    const term = cleanTerm(colon[1]);
    const detail = cleanSentence(colon[2]);
    if (isUsefulTerm(term) && isUsefulDetail(detail)) return { term, detail };
  }

  return null;
}

function splitSentences(text: string) {
  return text
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [line])
    .map(cleanSentence)
    .filter((sentence) => sentence.length >= 35 && sentence.length <= 320 && !isReferenceNoise(sentence));
}

function sentenceScore(sentence: string) {
  let score = 0;
  const lower = sentence.toLowerCase();
  const signalCount = MEDICAL_SIGNALS.filter((signal) => new RegExp(`\\b${escapeRegExp(signal)}\\b`, 'i').test(lower)).length;
  score += Math.min(signalCount * 0.18, 0.54);
  if (/\b(is|are|include|includes|requires|causes|increases|decreases|contraindicated|treated|managed)\b/i.test(sentence)) score += 0.2;
  if (/\b(first|initial|priority|hallmark|diagnostic|therapeutic|side effects?)\b/i.test(sentence)) score += 0.18;
  if (sentence.length >= 60 && sentence.length <= 220) score += 0.12;
  if (/^(figure|table|copyright|references|doi)\b/i.test(sentence)) score -= 0.4;
  return score;
}

function bulletFromSentence(sentence: string) {
  return ensureSentence(cleanSentence(sentence)
    .replace(/^(note|important|remember)\s*:\s*/i, '')
    .replace(/^[-*]\s*/, ''));
}

function classifySection(value: string): StudyGuideOutlineSection['emphasis'] {
  if (/\b(contraindication|avoid|toxicity|overdose|safety|fatal|emergency)\b/i.test(value)) return 'safety';
  if (/\b(treatment|therapy|management|intervention|medication|nursing action)\b/i.test(value)) return 'treatment';
  if (/\b(symptom|sign|finding|criteria|diagnos|manifestation|presents)\b/i.test(value)) return 'clinical';
  if (/\b(defined as|refers to|means|classification|type|phase)\b/i.test(value)) return 'definition';
  return 'overview';
}

function sectionTitle(sectionPath: string, sourceTitle: string, locator: string) {
  const cleaned = cleanTitle(sectionPath);
  const source = cleanTitle(sourceTitle);
  const normalized = normalizeKey(cleaned);
  if (!cleaned || LOW_VALUE_HEADINGS.has(normalized) || normalizeKey(cleaned) === normalizeKey(source)) {
    return locator || source || 'Study section';
  }
  return cleaned;
}

function questionFocus(value: string) {
  const cleaned = cleanTitle(value);
  if (!cleaned) return 'this section';
  return /^[A-Z0-9 -]+$/.test(cleaned) ? cleaned : cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

function normalizeSourceText(value: string) {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/^[-*]\s*/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanSentence(value: string) {
  return value
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s*\([^)]*(figure|table|see|page)[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:\-\s]+/, '')
    .replace(/[,;:\-\s]+$/, '')
    .trim();
}

function cleanTitle(value: string) {
  return cleanSentence(value)
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/^[-*]\s*/, '')
    .trim();
}

function cleanTerm(value: string) {
  return cleanTitle(value)
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/^(in|for|among|with)\s+[^,]{3,80},\s*/i, '')
    .trim();
}

function isUsefulTerm(value: string) {
  const normalized = normalizeKey(value);
  const words = value.split(/\s+/).filter(Boolean);
  return (
    value.length >= 3 &&
    value.length <= 90 &&
    words.length <= 10 &&
    !LOW_VALUE_HEADINGS.has(normalized) &&
    !/^(it|they|this|these|those|there|he|she|we|you|example|condition|problem|topic)$/i.test(value)
  );
}

function isUsefulDetail(value: string) {
  return value.length >= 12 && value.length <= 260 && !isReferenceNoise(value);
}

function isReferenceNoise(value: string) {
  return /^(references|bibliography|copyright|doi:|http|www\.|figure\s+\d+|table\s+\d+)/i.test(value);
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalizeKey(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function ensureSentence(value: string) {
  const cleaned = cleanSentence(value);
  if (!cleaned) return '';
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function lowercaseFirst(value: string) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
