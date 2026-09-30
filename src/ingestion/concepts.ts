import type { ParsedSegment } from './types';

export type ConceptImportance = 'critical' | 'high' | 'standard';

export type ConceptEmphasis =
  | 'safety'
  | 'treatment'
  | 'clinical'
  | 'definition'
  | 'mechanism'
  | 'overview';

export type ConceptTargetType = 'named-concept' | 'section' | 'myth' | 'safety';
export type ConceptFrontStyle = 'term' | 'question';

export type ConceptTarget = {
  id: string;
  term: string;
  detail: string;
  importance: ConceptImportance;
  emphasis: ConceptEmphasis;
  segmentIds: string[];
  locator: string;
  targetType: ConceptTargetType;
  frontStyle: ConceptFrontStyle;
  primary: true;
};
type ConceptEntry = {
  term: string;
  detail: string;
  importance: ConceptImportance;
  emphasis: ConceptEmphasis;
  segmentIds: Set<string>;
  locator: string;
  score: number;
  targetType: ConceptTargetType;
  frontStyle: ConceptFrontStyle;
};
const MAX_CONCEPTS = 20;
const CRITICAL_SIGNALS = ['contraindicated','contraindication','fatal','toxicity','overdose','emergency','anaphylaxis','life-threatening','do not','never','avoid','black box'];
const HIGH_SIGNALS = ['diagnosis','diagnostic criteria','treatment','management','first-line','hallmark','mechanism','pathophysiology','risk factor','side effect','adverse','indication','nursing action','priority'];
const MEDICAL_TERMS = ['aldosterone','anhedonia','antipsychotic','benzodiazepine','beta blocker','bipolar','clozapine','cortisol','delirium','delusion','dementia','depression','diabetes','dopamine','dyskinesia','epinephrine','extrapyramidal','flumazenil','glucose','hallucination','hypertension','hyperthyroidism','hypothyroidism','insulin','lithium','mania','metformin','naloxone','neuroleptic','norepinephrine','olanzapine','pcos','quetiapine','risperidone','schizoaffective','schizophrenia','serotonin','tardive dyskinesia','thyroid','warfarin','contraception','contraceptive','abstinence','sterilization','vasectomy','ligation','progestin','estrogen','hormonal','barrier','condom','spermicide','iud','nexplanon','ovulation','pregnancy','fertilization'];
const DEFINITION_PATTERN = /^(.{3,90}?)\s+(?:is|are|refers to|means|is defined as|are defined as)\s+(.{12,240})$/i;
const CRITERIA_PATTERN = /^(?:diagnostic criteria for\s+)?(.{3,90}?)\s+(?:include|includes|require|requires)\s+(.{12,240})$/i;
const COLON_PATTERN = /^([^:]{3,80}):\s*(.{12,240})$/;

const INVALID_TERM_PREFIX = /^(if|when|where|while|because|although|since|both|all|some|any|each|every|such as|following|these|those|this|that|many|other|another|several|most|more|you|we|they|he|she|it|there|here|how|what|why|as|even if|which|who|whom|whose|such|with|for|in|on|at|by|from|to)\b/i;
const INVALID_TERM_EXACT = /^(it|they|this|these|those|there|he|she|we|you|example|condition|problem|topic|note|summary|overview|introduction|reviewer|fact sheets?|visits?|appointment|services?|question|questions|option|options|method|methods|choice|choices|pros and cons|answers?|results?|details?|information|chart|page|source|pregnancy|woman|man|men|women|rod|single rod|shot|pill|patch|ring|foam|device|string|opening|skin|arm|mouth|vagina|uterus|cervix|penis|hormone|hormones)$/i;
const NON_DEFINITION_PREDICATE = /^\s*(avoided|considered|encouraged|required|recommended|achieved|used|applied|taken|performed|placed|given|found|seen|available|described|noted|believed|known|thought|reported|scheduled|delayed|needed|monitored|checked|tested|measured|in|on|at|by|for|with|from|to|when|where|if|because|that)\b/i;
export function extractConceptTargets(segments: ParsedSegment[]): ConceptTarget[] {
  const conceptMap = new Map<string, ConceptEntry>();
  for (const segment of segments) {
    const myth = extractMythTarget(segment.text);
    if (myth) upsertConcept(conceptMap, segment, myth);

    const sectionConcept = extractSectionConcept(segment);
    if (sectionConcept) {
      upsertConcept(conceptMap, segment, sectionConcept);
    }

    for (const target of extractLineTargets(segment)) {
      upsertConcept(conceptMap, segment, target);
    }
    const sentences = splitSentences(segment.text);
    for (const sentence of sentences) {
      const safety = extractSafetyTarget(sentence);
      if (safety) upsertConcept(conceptMap, segment, safety);
      const extracted = extractConcept(sentence);
      if (!extracted) continue;
      upsertConcept(conceptMap, segment, { ...extracted, targetType: 'named-concept', frontStyle: 'term', sourceText: sentence });
    }
  }
  const sortedEntries = [...conceptMap.entries()]
    .sort((a, b) => b[1].score - a[1].score);

  const deduplicated: Array<[string, ConceptEntry]> = [];
  for (const [key, entry] of sortedEntries) {
    const isSubsumed = deduplicated.some(([exKey, existing]) => {
      const commonSegments = [...entry.segmentIds].filter((id) => existing.segmentIds.has(id));
      if (!commonSegments.length || !isGenericSubconcept(key, exKey)) return false;
      entry.segmentIds.forEach((id) => existing.segmentIds.add(id));
      return true;
    });
    if (!isSubsumed) {
      deduplicated.push([key, entry]);
    }
  }

  return deduplicated
    .slice(0, MAX_CONCEPTS)
    .map(([key, entry]) => ({
      id: `target-${key.replace(/\s+/g, '-')}`,
      term: entry.term,
      detail: entry.detail,
      importance: entry.importance,
      emphasis: entry.emphasis,
      segmentIds: [...entry.segmentIds],
      locator: entry.locator,
      targetType: entry.targetType,
      frontStyle: entry.frontStyle,
      primary: true,
    }));
}

const GENERIC_SUBCONCEPT_WORDS = new Set([
  'device', 'devices', 'foam', 'foams', 'form', 'forms', 'method', 'methods',
  'procedure', 'procedures', 'product', 'products',
]);

function isGenericSubconcept(left: string, right: string) {
  const leftWords = left.split(' ');
  const rightWords = right.split(' ');
  return wordsSubsumedBy(leftWords, rightWords) || wordsSubsumedBy(rightWords, leftWords);
}

function wordsSubsumedBy(candidate: string[], parent: string[]) {
  if (candidate.length < parent.length || candidate.length > parent.length + 2) return false;
  return candidate.every((word) => (
    GENERIC_SUBCONCEPT_WORDS.has(word)
    || parent.some((parentWord) => sameWordFamily(word, parentWord))
  ));
}

function sameWordFamily(left: string, right: string) {
  if (left === right) return true;
  if (left.length < 6 || right.length < 6) return false;
  return left.startsWith(right.slice(0, 7)) || right.startsWith(left.slice(0, 7));
}

type ExtractedTarget = {
  term: string;
  detail: string;
  sourceText: string;
  targetType: ConceptTargetType;
  frontStyle: ConceptFrontStyle;
};

function upsertConcept(
  conceptMap: Map<string, ConceptEntry>,
  segment: ParsedSegment,
  extracted: ExtractedTarget,
) {
  const term = cleanTerm(extracted.term);
  const detail = cleanSentence(extracted.detail);
  const key = normalizeKey(term);
  if (term.endsWith('?') && extracted.targetType !== 'myth') return;
  if (!key || key.length < 3 || !isUsefulTerm(term) || !isUsefulDetail(detail)) return;
  const importance = classifyImportance(extracted.sourceText, term, segment.sectionPath);
  const emphasis = extracted.targetType === 'safety'
    ? 'safety'
    : classifyEmphasis(extracted.sourceText, segment.sectionPath);
  const isDedicated = isDedicatedSection(segment.sectionPath, term);
  const score = importanceScore(importance) + emphasisScore(emphasis) + medicalTermBoost(term)
    + (isDedicated ? 2.5 : extracted.targetType === 'named-concept' ? 0.7 : extracted.targetType === 'myth' || extracted.targetType === 'safety' ? 1.2 : 0);
  const existing = conceptMap.get(key);
  if (existing) {
    existing.segmentIds.add(segment.id);
    if (isDedicated) {
      existing.term = term;
      existing.detail = detail;
      existing.locator = segment.locator;
      existing.score = score;
      existing.targetType = extracted.targetType;
      existing.frontStyle = extracted.frontStyle;
      existing.segmentIds = new Set([segment.id, ...existing.segmentIds]);
      return;
    }
    if (score > existing.score) {
      Object.assign(existing, { term, detail, importance, emphasis, locator: segment.locator, score, targetType: extracted.targetType, frontStyle: extracted.frontStyle });
    }
    return;
  }
  conceptMap.set(key, { term, detail, importance, emphasis, segmentIds: new Set([segment.id]), locator: segment.locator, score, targetType: extracted.targetType, frontStyle: extracted.frontStyle });
}

function extractLineTargets(segment: ParsedSegment): ExtractedTarget[] {
  const lines = segment.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const targets: ExtractedTarget[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const bullet = raw.match(/^[•▪*-]\s+(.{3,90}?)(?:\s*\*)?$/);
    const colon = raw.match(/^([^:]{3,80}):\s*(.*)$/);
    const label = cleanTerm((bullet?.[1] ?? colon?.[1] ?? '').replace(/\s*\*$/, ''));
    if (bullet && /\?$/.test(label)) continue;
    if (!label || !isUsefulTerm(label)) continue;
    const inlineDetail = colon?.[2]?.trim() ?? '';
    if (bullet && !inlineDetail) continue;
    const following = lines.slice(index + 1, index + 4).filter((line) => !looksLikeLabel(line)).join(' ');
    const detail = inlineDetail || following;
    if (!detail || !isUsefulDetail(cleanSentence(detail))) continue;
    targets.push({ term: label, detail, sourceText: `${raw} ${following}`, targetType: 'named-concept', frontStyle: 'term' });
  }
  return targets;
}

function looksLikeLabel(value: string) {
  return /^[•▪*-]\s+/.test(value) || /^([^:]{3,80}):\s*/.test(value);
}

function extractMythTarget(text: string): ExtractedTarget | null {
  const mythMatch = text.match(/(?:you may have heard that\s+)?["“]([^"”]{5,120})["”]\s*[.!?]?\s*(?:this|that)\s+is\s+(?:a\s+)?myth/i)
    ?? text.match(/([^.!?\n]{5,100}[.!?])\s*(?:this|that)\s+is\s+(?:a\s+)?myth/i);
  if (!mythMatch) return null;
  const rawTerm = mythMatch[1].replace(/[.!?]+$/, '').trim();
  const term = /you can't|cannot/i.test(rawTerm)
    ? 'Can you get pregnant the first time?'
    : rawTerm;
  return {
    term,
    detail: `It is a myth that ${rawTerm.toLowerCase()}. Fertilization can take place any time sperm are present in a woman's genital tract when an egg is present.`,
    sourceText: text.slice(0, 400),
    targetType: 'myth',
    frontStyle: 'question',
  };
}

function extractSafetyTarget(sentence: string): ExtractedTarget | null {
  if (/\b(?:do not|does not|cannot|no)\s+(?:offer|provide)?\s*protection\s+from\s+(?:stis|stds|sexually transmitted)/i.test(sentence)) {
    if (/\bhormonal\b/i.test(sentence)) {
      return { term: 'STIs and Hormonal Contraception', detail: sentence, sourceText: sentence, targetType: 'safety', frontStyle: 'term' };
    }
  }
  const match = sentence.match(/^(.{3,100}?)\s+(?:do|does) not\s+(.{8,180})$/i);
  if (!match) return null;
  const subject = cleanTerm(match[1].replace(/,?\s+such as\s+.+$/i, ''));
  if (!isUsefulTerm(subject)) return null;
  return { term: subject, detail: sentence, sourceText: sentence, targetType: 'safety', frontStyle: 'question' };
}
export function selectSegmentsForConcept(concept: ConceptTarget, allSegments: ParsedSegment[], maxSegments: number = 3): ParsedSegment[] {
  const relevantById = new Set(concept.segmentIds);
  const termLower = concept.term.toLowerCase();
  const termWords = termLower.split(/\s+/).filter((w) => w.length > 2);
  const scored = allSegments.map((segment) => {
    let score = 0;
    if (relevantById.has(segment.id)) score += 10;
    const textLower = segment.text.toLowerCase();
    if (textLower.includes(termLower)) score += 5;
    for (const word of termWords) { if (textLower.includes(word)) score += 1; }
    if (normalizeKey(segment.sectionPath).includes(normalizeKey(concept.term))) score += 3;
    return { segment, score };
  });
  return scored.filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, maxSegments).map((item) => item.segment);
}
function extractConcept(sentence: string): { term: string; detail: string } | null {
  if (/^(if|when|where|while|although|because|since|as you|even if|both|all visits|statistics show|you may|there are)\b/i.test(sentence)) {
    return null;
  }
  const definition = sentence.match(DEFINITION_PATTERN);
  if (definition) {
    const rawTerm = definition[1];
    const rawDetail = definition[2];
    if (!NON_DEFINITION_PREDICATE.test(rawDetail) && !/^(the\s+following|fact\s+sheets|some\s+|both\s+|all\s+|there\s+)/i.test(rawTerm)) {
      const term = cleanTerm(rawTerm);
      const detail = cleanSentence(rawDetail);
      if (isUsefulTerm(term) && isUsefulDetail(detail)) return { term, detail };
    }
  }
  const criteria = sentence.match(CRITERIA_PATTERN);
  if (criteria) { const term = cleanTerm(criteria[1]); const detail = cleanSentence(criteria[2]); if (isUsefulTerm(term) && isUsefulDetail(detail)) return { term, detail: `Includes ${lowercaseFirst(detail)}` }; }
  const colon = sentence.match(COLON_PATTERN);
  if (colon) { const term = cleanTerm(colon[1]); const detail = cleanSentence(colon[2]); if (isUsefulTerm(term) && isUsefulDetail(detail)) return { term, detail }; }
  return null;
}
function extractSectionConcept(segment: ParsedSegment): ExtractedTarget | null {
  const path = (segment.sectionPath || '').trim();
  if (!path || path.length < 3 || path.length > 80 || path.toLowerCase() === 'methods of birth control') return null;
  const term = cleanTerm(path);
  if (!isUsefulTerm(term)) return null;
  const detail = structuredSectionDetail(segment.text)
    || segment.text.slice(0, 240).replace(/\s+/g, ' ').trim();
  if (detail.length < 12) return null;
  return { term, detail, sourceText: segment.text, targetType: 'section', frontStyle: 'term' };
}

function structuredSectionDetail(text: string) {
  const fields = new Map<string, string>();
  for (const paragraph of text.split(/\n{2,}/)) {
    const match = paragraph.trim().match(/^(Availability|How it works|How it is used|Effectiveness|Advantages|Disadvantages):\s*(.+)$/is);
    if (match) fields.set(match[1].toLowerCase(), cleanSentence(match[2]));
  }
  const values = [
    fields.get('how it works'),
    fields.get('how it is used'),
    fields.get('effectiveness'),
  ].filter((value): value is string => Boolean(value));
  if (!values.length) return '';
  return values.join(' ').slice(0, 260).trim();
}
function classifyImportance(sentence: string, term: string, sectionPath: string): ConceptImportance {
  const combined = (sentence + ' ' + term + ' ' + sectionPath).toLowerCase();
  if (CRITICAL_SIGNALS.some((signal) => combined.includes(signal))) return 'critical';
  if (HIGH_SIGNALS.some((signal) => combined.includes(signal))) return 'high';
  return 'standard';
}
function classifyEmphasis(sentence: string, sectionPath: string): ConceptEmphasis {
  const combined = (sentence + ' ' + sectionPath).toLowerCase();
  if (/\b(contraindication|avoid|toxicity|overdose|safety|fatal|emergency)\b/i.test(combined)) return 'safety';
  if (/\b(treatment|therapy|management|intervention|medication|nursing action)\b/i.test(combined)) return 'treatment';
  if (/\b(symptom|sign|finding|criteria|diagnos|manifestation|presents)\b/i.test(combined)) return 'clinical';
  if (/\b(mechanism|pathophysiology|inhibits|blocks|activates|binds)\b/i.test(combined)) return 'mechanism';
  if (/\b(defined as|refers to|means|classification|type|phase)\b/i.test(combined)) return 'definition';
  return 'overview';
}
function importanceScore(importance: ConceptImportance): number { if (importance === 'critical') return 3; if (importance === 'high') return 2; return 1; }
function emphasisScore(emphasis: ConceptEmphasis): number { if (emphasis === 'safety') return 0.5; if (emphasis === 'treatment') return 0.4; if (emphasis === 'clinical') return 0.35; if (emphasis === 'mechanism') return 0.3; if (emphasis === 'definition') return 0.25; return 0.1; }
function medicalTermBoost(term: string): number { return MEDICAL_TERMS.some((t) => term.toLowerCase().includes(t)) ? 0.8 : 0; }
function isUsefulTerm(value: string): boolean {
  const trimmed = value.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (trimmed.length < 3 || trimmed.length > 90 || words.length > 10) return false;
  if (!hasBalancedDelimiters(trimmed)) return false;
  if (/\b(?:and|or|with|without|when|unless|usually|including|such as|because|than|of|to|for|the|a|an)$/i.test(trimmed)) return false;
  if (INVALID_TERM_EXACT.test(trimmed)) return false;
  if (INVALID_TERM_PREFIX.test(trimmed)) return false;
  if (/\b(?:such as|which|that|who|whom|whose)\b/i.test(trimmed)) return false;
  if (!trimmed.endsWith('?')) {
    if (/^(can|could|should|would|may|might|must|is|are|was|were|do|does|did)\b/i.test(trimmed)) return false;
    if (/\b(can|could|would|should|may|might|must|take|takes|taking|occur|occurs|occurring|cause|causes|causing|prevent|prevents|preventing|have|has|having)\b/i.test(trimmed)) return false;
    if (/^(first|second|third|fourth|fifth|last|next)\s+(week|month|day|year|time|step|phase|stage|part)\b/i.test(trimmed)) return false;
    if (words.length > 6) return false;
  }
  return true;
}

function hasBalancedDelimiters(value: string) {
  return delimiterBalance(value, '(', ')') === 0
    && delimiterBalance(value, '[', ']') === 0
    && delimiterBalance(value, '{', '}') === 0;
}

function delimiterBalance(value: string, open: string, close: string) {
  let balance = 0;
  for (const character of value) {
    if (character === open) balance += 1;
    if (character === close) balance -= 1;
    if (balance < 0) return -1;
  }
  return balance;
}
function isUsefulDetail(value: string): boolean { return value.length >= 12 && value.length <= 260 && !isReferenceNoise(value); }
function isReferenceNoise(value: string): boolean { return /^(references|bibliography|copyright|doi:|http|www\.|figure\s+\d+|table\s+\d+)/i.test(value); }
function splitSentences(text: string): string[] {
  return text.split(/\n+/).flatMap((line) => line.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [line]).map(cleanSentence).filter((s) => s.length >= 35 && s.length <= 320 && !isReferenceNoise(s));
}
function cleanSentence(value: string): string {
  return value.replace(/\[[^\]]+\]/g, '').replace(/\s*\([^)]*(figure|table|see|page)[^)]*\)/gi, '').replace(/\s+/g, ' ').replace(/^[,;:\-\s]+/, '').replace(/[,;:\-\s]+$/, '').trim();
}
function stripEnclosingParens(value: string): string {
  let v = value.trim();
  while (
    (v.startsWith('(') && v.endsWith(')')) ||
    (v.startsWith('[') && v.endsWith(']')) ||
    (v.startsWith('{') && v.endsWith('}'))
  ) {
    v = v.slice(1, -1).trim();
  }
  if (v.startsWith('(') && !v.includes(')')) v = v.slice(1).trim();
  if (v.endsWith(')') && !v.includes('(')) v = v.slice(0, -1).trim();
  return v;
}

function cleanTerm(value: string): string {
  let cleaned = stripEnclosingParens(cleanSentence(value).replace(/^(the|a|an)\s+/i, '').replace(/^(in|for|among|with)\s+[^,]{3,80},\s*/i, '')).trim();
  const colonMatch = cleaned.match(/^([^:]+):\s*(?:(?:since|with)\s+)?(.*)$/i);
  if (colonMatch) {
    cleaned = colonMatch[1].trim();
  }
  const appositiveMatch = cleaned.match(/^([^,]{3,60}),\s*(?:the|a|an)\s+[^,]{5,80}$/i);
  if (appositiveMatch) {
    cleaned = appositiveMatch[1].trim();
  }
  return stripEnclosingParens(cleaned.replace(/^[-*•▪\s]+/, '').replace(/[-*•▪\s]+$/, '')).trim();
}

function isDedicatedSection(sectionPath: string, term: string): boolean {
  const np = normalizeKey(sectionPath);
  const nt = normalizeKey(term);
  return Boolean(np && nt && (np === nt || np.includes(nt) || nt.includes(np)));
}
function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function lowercaseFirst(value: string): string { return value ? value.charAt(0).toLowerCase() + value.slice(1) : value; }
