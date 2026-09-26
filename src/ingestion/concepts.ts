import type { ParsedSegment } from './types';

export type ConceptImportance = 'critical' | 'high' | 'standard';

export type ConceptEmphasis =
  | 'safety'
  | 'treatment'
  | 'clinical'
  | 'definition'
  | 'mechanism'
  | 'overview';

export type ConceptTarget = {
  id: string;
  term: string;
  detail: string;
  importance: ConceptImportance;
  emphasis: ConceptEmphasis;
  segmentIds: string[];
  locator: string;
};
const MAX_CONCEPTS = 40;
const CRITICAL_SIGNALS = ['contraindicated','contraindication','fatal','toxicity','overdose','emergency','anaphylaxis','life-threatening','do not','never','avoid','black box'];
const HIGH_SIGNALS = ['diagnosis','diagnostic criteria','treatment','management','first-line','hallmark','mechanism','pathophysiology','risk factor','side effect','adverse','indication','nursing action','priority'];
const MEDICAL_TERMS = ['aldosterone','anhedonia','antipsychotic','benzodiazepine','beta blocker','bipolar','clozapine','cortisol','delirium','delusion','dementia','depression','diabetes','dopamine','dyskinesia','epinephrine','extrapyramidal','flumazenil','glucose','hallucination','hypertension','hyperthyroidism','hypothyroidism','insulin','lithium','mania','metformin','naloxone','neuroleptic','norepinephrine','olanzapine','pcos','quetiapine','risperidone','schizoaffective','schizophrenia','serotonin','tardive dyskinesia','thyroid','warfarin'];
const DEFINITION_PATTERN = /^(.{3,90}?)\s+(?:is|are|refers to|means|is defined as|are defined as)\s+(.{12,240})$/i;
const CRITERIA_PATTERN = /^(?:diagnostic criteria for\s+)?(.{3,90}?)\s+(?:include|includes|require|requires)\s+(.{12,240})$/i;
const COLON_PATTERN = /^([^:]{3,80}):\s*(.{12,240})$/;
export function extractConceptTargets(segments: ParsedSegment[]): ConceptTarget[] {
  const conceptMap = new Map<string, { term: string; detail: string; importance: ConceptImportance; emphasis: ConceptEmphasis; segmentIds: Set<string>; locator: string; score: number; }>();
  for (const segment of segments) {
    const sentences = splitSentences(segment.text);
    for (const sentence of sentences) {
      const extracted = extractConcept(sentence);
      if (!extracted) continue;
      const key = normalizeKey(extracted.term);
      if (!key || key.length < 3) continue;
      const existing = conceptMap.get(key);
      const importance = classifyImportance(sentence, extracted.term, segment.sectionPath);
      const emphasis = classifyEmphasis(sentence, segment.sectionPath);
      const score = importanceScore(importance) + emphasisScore(emphasis) + medicalTermBoost(extracted.term);
      if (existing) {
        existing.segmentIds.add(segment.id);
        if (score > existing.score) { existing.detail = extracted.detail; existing.importance = importance; existing.emphasis = emphasis; existing.score = score; existing.locator = segment.locator; }
      } else {
        conceptMap.set(key, { term: extracted.term, detail: extracted.detail, importance, emphasis, segmentIds: new Set([segment.id]), locator: segment.locator, score });
      }
    }
    const sectionConcept = extractSectionConcept(segment);
    if (sectionConcept) {
      const key = normalizeKey(sectionConcept.term);
      if (key && key.length >= 3 && !conceptMap.has(key)) {
        conceptMap.set(key, { term: sectionConcept.term, detail: sectionConcept.detail, importance: classifyImportance('', sectionConcept.term, segment.sectionPath), emphasis: classifyEmphasis('', segment.sectionPath), segmentIds: new Set([segment.id]), locator: segment.locator, score: importanceScore('standard') + medicalTermBoost(sectionConcept.term) });
      }
    }
  }
  return [...conceptMap.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, MAX_CONCEPTS)
    .map(([, entry], index) => ({ id: `concept-${index + 1}`, term: entry.term, detail: entry.detail, importance: entry.importance, emphasis: entry.emphasis, segmentIds: [...entry.segmentIds], locator: entry.locator }));
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
  const definition = sentence.match(DEFINITION_PATTERN);
  if (definition) { const term = cleanTerm(definition[1]); const detail = cleanSentence(definition[2]); if (isUsefulTerm(term) && isUsefulDetail(detail)) return { term, detail }; }
  const criteria = sentence.match(CRITERIA_PATTERN);
  if (criteria) { const term = cleanTerm(criteria[1]); const detail = cleanSentence(criteria[2]); if (isUsefulTerm(term) && isUsefulDetail(detail)) return { term, detail: `Includes ${lowercaseFirst(detail)}` }; }
  const colon = sentence.match(COLON_PATTERN);
  if (colon) { const term = cleanTerm(colon[1]); const detail = cleanSentence(colon[2]); if (isUsefulTerm(term) && isUsefulDetail(detail)) return { term, detail }; }
  return null;
}
function extractSectionConcept(segment: ParsedSegment): { term: string; detail: string } | null {
  const path = (segment.sectionPath || '').trim();
  if (!path || path.length < 3 || path.length > 80) return null;
  const detail = segment.text.slice(0, 200).replace(/\s+/g, ' ').trim();
  if (detail.length < 12) return null;
  const term = cleanTerm(path);
  if (!isUsefulTerm(term)) return null;
  return { term, detail };
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
  const words = value.split(/\s+/).filter(Boolean);
  return value.length >= 3 && value.length <= 90 && words.length <= 10 && !/^(it|they|this|these|those|there|he|she|we|you|example|condition|problem|topic|note|summary|overview|introduction)$/i.test(value);
}
function isUsefulDetail(value: string): boolean { return value.length >= 12 && value.length <= 260 && !isReferenceNoise(value); }
function isReferenceNoise(value: string): boolean { return /^(references|bibliography|copyright|doi:|http|www\.|figure\s+\d+|table\s+\d+)/i.test(value); }
function splitSentences(text: string): string[] {
  return text.split(/\n+/).flatMap((line) => line.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [line]).map(cleanSentence).filter((s) => s.length >= 35 && s.length <= 320 && !isReferenceNoise(s));
}
function cleanSentence(value: string): string {
  return value.replace(/\[[^\]]+\]/g, '').replace(/\s*\([^)]*(figure|table|see|page)[^)]*\)/gi, '').replace(/\s+/g, ' ').replace(/^[,;:\-\s]+/, '').replace(/[,;:\-\s]+$/, '').trim();
}
function cleanTerm(value: string): string {
  return cleanSentence(value).replace(/^(the|a|an)\s+/i, '').replace(/^(in|for|among|with)\s+[^,]{3,80},\s*/i, '').trim();
}
function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function lowercaseFirst(value: string): string { return value ? value.charAt(0).toLowerCase() + value.slice(1) : value; }
