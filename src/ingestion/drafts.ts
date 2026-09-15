import type { ParsedSegment } from './types';

export type MedicalCardType =
  | 'definition'
  | 'mechanism'
  | 'clinical-finding'
  | 'contraindication'
  | 'comparison'
  | 'cloze-recall'
  | 'risk-factor'
  | 'treatment-reasoning'
  | 'diagnostic-reasoning'
  | 'algorithm-step'
  | 'classification';

export type ExtractiveDraft = {
  segmentId: string;
  locator: string;
  cardType: MedicalCardType;
  learningObjective: string;
  qualityScore: number;
  qualityNotes: string;
  question: string;
  answer: string;
  evidenceText: string;
};

type DraftSeed = {
  cardType: MedicalCardType;
  focusKey: string;
  sourceIndex: number;
  question: string;
  directAnswer: string;
  whyItMatters: string;
  learningObjective: string;
};

type ScoredDraft = ExtractiveDraft & {
  focusKey: string;
  sourceIndex: number;
};

const MAX_DRAFTS = 56;
const MAX_DRAFTS_PER_SEGMENT = 8;
const MAX_ANSWER_CHARS = 560;
const MAX_EVIDENCE_CHARS = 720;
const MIN_QUALITY_SCORE = 0.68;
export const AUTO_PUBLISH_QUALITY_SCORE = 0.82;
const CARD_TYPE_PRIORITY: Record<MedicalCardType, number> = {
  contraindication: 0.2,
  'diagnostic-reasoning': 0.19,
  'clinical-finding': 0.18,
  'algorithm-step': 0.18,
  classification: 0.17,
  'treatment-reasoning': 0.17,
  mechanism: 0.16,
  definition: 0.15,
  'risk-factor': 0.15,
  comparison: 0.14,
  'cloze-recall': 0.04,
};

const DEFINITION_PATTERN = /^(.{3,96}?)\s+(is|are|refers to|means|is defined as|are defined as)\s+(.{12,260})$/i;
const ACTION_PATTERN =
  /^(.{3,96}?)\s+(inhibits|blocks|reduces|decreases|lowers|increases|raises|stimulates|causes|prevents|binds|activates|suppresses|promotes|enhances|improves|worsens)\s+(.{8,240})$/i;
const FINDING_PATTERN =
  /^(.{3,110}?)\s+(presents with|is characterized by|is associated with|symptoms include|features include|signs include|findings include)\s+(.{8,240})$/i;
const GENERIC_QUESTION_PATTERN = /key takeaway|main point|this section|this paragraph|what does the source say/i;
const PERSONAL_ADVICE_PATTERN = /\b(you should|you must|take \d|start taking|stop taking|your doctor)\b/i;

const MEDICAL_TERMS = [
  'abdomen',
  'absorption',
  'ace inhibitor',
  'adverse',
  'alveoli',
  'anatomy',
  'antibiotic',
  'antibody',
  'artery',
  'assessment',
  'contraindicated',
  'contraindication',
  'clot',
  'diagnosis',
  'diabetes',
  'disease',
  'dose',
  'drug',
  'edema',
  'endocrine',
  'enzyme',
  'estrogen',
  'glucose',
  'heart',
  'hepatic',
  'hormone',
  'hyperandrogenism',
  'hirsutism',
  'infection',
  'inflammation',
  'infertility',
  'insulin',
  'kidney',
  'lab',
  'lesion',
  'liver',
  'management',
  'mechanism',
  'medication',
  'menstrual',
  'menstruation',
  'metformin',
  'metabolism',
  'neuron',
  'oral contraceptive',
  'ovarian',
  'ovary',
  'ovulation',
  'pathophysiology',
  'pcos',
  'pharmacology',
  'physiology',
  'pregnancy',
  'progesterone',
  'receptor',
  'renal',
  'risk',
  'symptom',
  'syndrome',
  'therapy',
  'thrombosis',
  'treatment',
  'toxicity',
  'type 2 diabetes',
  'vein',
];

const LOW_VALUE_SUBJECTS = new Set([
  'a patient',
  'an example',
  'it',
  'patient',
  'patients',
  'people',
  'she',
  'the patient',
  'the study',
  'there',
  'they',
  'this',
  'these',
  'those',
  'we',
  'you',
]);

export function createExtractiveDrafts(segments: ParsedSegment[]): ExtractiveDraft[] {
  const drafts: ExtractiveDraft[] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    if (drafts.length >= MAX_DRAFTS) break;

    const segmentDrafts = createSegmentDrafts(segment);
    for (const draft of segmentDrafts) {
      if (drafts.length >= MAX_DRAFTS) break;

      const key = normalizeKey(`${draft.cardType}:${draft.focusKey}:${draft.question}`);
      if (seen.has(key)) continue;
      if (drafts.some((existing) => factSimilarity(existing.answer, draft.answer) >= 0.82)) continue;

      seen.add(key);
      drafts.push({
        segmentId: draft.segmentId,
        locator: draft.locator,
        cardType: draft.cardType,
        learningObjective: draft.learningObjective,
        qualityScore: draft.qualityScore,
        qualityNotes: draft.qualityNotes,
        question: draft.question,
        answer: draft.answer,
        evidenceText: draft.evidenceText,
      });
    }
  }

  return drafts;
}

function createSegmentDrafts(segment: ParsedSegment): ScoredDraft[] {
  const text = normalizeSourceText(segment.text);
  if (text.length < 80 || isMostlyReferenceText(text)) {
    return [];
  }

  const sentences = splitSentences(text);
  const seeds: DraftSeed[] = [];

  for (let index = 0; index < sentences.length; index += 1) {
    const sentence = sentences[index];
    seeds.push(...createClassificationSeeds(sentences, index));
    seeds.push(...createDefinitionSeeds(segment, sentences, index));
    seeds.push(...createActionSeeds(segment, sentences, index));
    seeds.push(...createFindingSeeds(segment, sentences, index));
    seeds.push(...createContraindicationSeeds(sentences, index));
    seeds.push(...createComparisonSeeds(sentences, index));
    seeds.push(...createRiskSeeds(sentences, index));
    seeds.push(...createTreatmentSeeds(segment, sentences, index));
    seeds.push(...createDiagnosticSeeds(segment, sentences, index));
    seeds.push(...createAlgorithmSeeds(segment, sentences, index));

    if (hasStrongMedicalSignal(sentence)) {
      seeds.push(...createClozeSeeds(sentences, index));
    }
  }

  return seeds
    .map((seed) => scoreDraft(segment, sentences, seed))
    .filter((draft): draft is ScoredDraft => Boolean(draft))
    .sort((left, right) => selectionScore(right) - selectionScore(left))
    .reduce<ScoredDraft[]>((unique, draft) => {
      const key = normalizeKey(`${draft.cardType}:${draft.focusKey}:${draft.question}`);
      const answerKey = recallAnswerKey(draft.answer);
      const typeCount = unique.filter((item) => item.cardType === draft.cardType).length;

      if (
        !unique.some((item) => item.sourceIndex === draft.sourceIndex) &&
        !unique.some((item) => normalizeKey(`${item.cardType}:${item.focusKey}:${item.question}`) === key) &&
        !unique.some((item) => recallAnswerKey(item.answer) === answerKey)
      ) {
        if (draft.cardType === 'cloze-recall' && typeCount >= 1) return unique;
        if (typeCount >= 2) return unique;
        unique.push(draft);
      }
      return unique;
    }, [])
    .slice(0, MAX_DRAFTS_PER_SEGMENT);
}

function createDefinitionSeeds(segment: ParsedSegment, sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  const match = sentence.match(DEFINITION_PATTERN);
  if (!match) return [];

  const subject = cleanSubject(match[1]);
  const definition = cleanClause(match[3]);
  if (subject.includes(':') || /^(contraindicated|not recommended|treated|managed|used)\b/i.test(definition)) return [];
  if (!isUsefulSubject(subject) || !isUsefulClause(definition)) return [];

  return [
    {
      cardType: 'definition',
      focusKey: subject,
      sourceIndex: index,
      question: `What does ${questionConcept(subject)} mean in this topic?`,
      directAnswer: `${capitalize(subject)} ${definitionVerb(match[2])} ${definition}`,
      whyItMatters: 'This gives the learner a stable anchor before connecting mechanisms, findings, and management.',
      learningObjective: `Define ${subject} and connect it to the section "${sectionLabel(segment)}".`,
    },
  ];
}

function createClassificationSeeds(sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  const match = sentence.match(/^([^:]{3,70}):\s*(.{3,70}?)\s+(?:is|are)\s+(.{8,220})$/i);
  if (!match) return [];

  const category = cleanClause(match[1]);
  const entity = cleanSubject(match[2]);
  const detail = cleanClause(match[3]);
  if (!isUsefulSubject(category) || !isUsefulSubject(entity) || !isUsefulClause(detail)) return [];

  return [{
    cardType: 'classification',
    focusKey: `${category}:${entity}`,
    sourceIndex: index,
    question: `How is ${questionConcept(entity)} classified in this source?`,
    directAnswer: `${capitalize(entity)} is grouped under ${category}; ${detail}`,
    whyItMatters: 'Classification cards provide a clean category anchor before deeper mechanism or management recall.',
    learningObjective: `Classify ${entity} under ${category}.`,
  }];
}

function createActionSeeds(segment: ParsedSegment, sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  const seeds: DraftSeed[] = [];

  for (const clause of extractRecallClauses(sentence)) {
    const match = clause.match(ACTION_PATTERN);
    if (!match) continue;

    const subject = cleanSubject(match[1]);
    const verb = match[2].toLowerCase();
    const object = cleanClause(match[3]);
    if (!isUsefulSubject(subject) || !isUsefulClause(object)) continue;
    if (/\brisk of\b/i.test(object)) continue;

    const cardType: MedicalCardType = isDrugLike(subject) || isMechanismVerb(verb) ? 'mechanism' : 'treatment-reasoning';
    const focus = focusPhrase(object);

    seeds.push({
      cardType,
      focusKey: `${subject}:${verb}:${focus}`,
      sourceIndex: index,
      question: `How does ${questionConcept(subject)} affect ${focus}?`,
      directAnswer: `${capitalize(subject)} ${verb} ${object}`,
      whyItMatters:
        cardType === 'mechanism'
          ? 'Mechanism cards help the learner explain cause and effect instead of memorizing isolated facts.'
          : 'Treatment-reasoning cards connect an action to the practical decision a learner may need later.',
      learningObjective: `Explain the effect of ${subject} on ${focus}.`,
    });
  }

  return seeds;
}

function createFindingSeeds(segment: ParsedSegment, sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  const match = sentence.match(FINDING_PATTERN);
  if (!match) return [];

  const subject = cleanSubject(match[1]);
  const findings = cleanClause(match[3]);
  if (!isUsefulSubject(subject) || !isUsefulClause(findings)) return [];

  return [
    {
      cardType: 'clinical-finding',
      focusKey: `${subject}:findings`,
      sourceIndex: index,
      question: `Which findings should make you think of ${questionConcept(subject)}?`,
      directAnswer: `Look for ${findings}`,
      whyItMatters: 'Finding cards train recognition of patterns while still requiring active recall.',
      learningObjective: `Recall the key findings linked to ${subject} in "${sectionLabel(segment)}".`,
    },
  ];
}

function createContraindicationSeeds(sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  if (!/\b(avoid|avoided|contraindicated|contraindication|should not be used|should be avoided|not recommended)\b/i.test(sentence)) {
    return [];
  }

  const subject = extractContraindicationSubject(sentence);
  const condition = extractContraindicationCondition(sentence);
  const reason = extractReason(sentence);
  const cleanedSubject = cleanSubject(subject || condition || sentence);
  if (!isUsefulSubject(cleanedSubject)) return [];

  const direct = reason
    ? `${capitalize(cleanedSubject)} should be avoided because ${cleanClause(reason)}`
    : summarizeSentence(sentence, 220);

  return [
    {
      cardType: 'contraindication',
      focusKey: `${cleanedSubject}:avoid`,
      sourceIndex: index,
      question: condition
        ? `Why should ${cleanedSubject} be avoided ${conditionPrefix(condition)}?`
        : `When should ${cleanedSubject} be avoided?`,
      directAnswer: direct,
      whyItMatters: 'Contraindication cards protect against unsafe recall by tying the rule to its reason.',
      learningObjective: `Identify when ${cleanedSubject} should not be used.`,
    },
  ];
}

function createComparisonSeeds(sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  const parts = sentence.split(/\b(whereas|while|unlike|compared with|compared to|but)\b/i);
  if (parts.length < 3) return [];

  const left = parseComparisonClause(parts[0]);
  const right = parseComparisonClause(parts.slice(2).join(' '));
  if (!left || !right || normalizeKey(left.subject) === normalizeKey(right.subject)) return [];

  return [
    {
      cardType: 'comparison',
      focusKey: `${left.subject}:${right.subject}`,
      sourceIndex: index,
      question: `How do ${left.subject} and ${right.subject} differ?`,
      directAnswer: `${capitalize(left.subject)} ${left.action}; ${right.subject} ${right.action}`,
      whyItMatters: 'Comparison cards stop look-alike concepts from blending together during review.',
      learningObjective: `Differentiate ${left.subject} from ${right.subject}.`,
    },
  ];
}

function parseComparisonClause(value: string) {
  const cleaned = cleanClause(value).replace(/^(whereas|while|unlike|compared with|compared to|but)\s+/i, '');
  const match = cleaned.match(
    /^(.{3,72}?)\s+(prevents?|blocks?|inhibits?|antagonizes?|reduces?|decreases?|increases?|stimulates?|activates?|suppresses?|promotes?|enhances?)\s+(.{5,190})$/i,
  );
  if (!match) return null;
  const subject = cleanSubject(match[1]);
  const action = cleanClause(`${match[2].toLowerCase()} ${match[3]}`);
  return isUsefulSubject(subject) && isUsefulClause(action) ? { subject, action } : null;
}

function createRiskSeeds(sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  const riskFactors = sentence.match(/\brisk factors for\s+(.{3,90}?)\s+include\s+(.{8,220})$/i);
  if (riskFactors) {
    const outcome = cleanClause(riskFactors[1]);
    const factors = cleanClause(riskFactors[2]);
    if (isUsefulClause(outcome) && isUsefulClause(factors)) {
      return [
        {
          cardType: 'risk-factor',
          focusKey: `${outcome}:risk`,
          sourceIndex: index,
          question: `Which risk factors are linked to ${outcome}?`,
          directAnswer: `The linked risk factors are ${factors}`,
          whyItMatters: 'Risk-factor cards help the learner predict who is more likely to develop a condition.',
          learningObjective: `Recall risk factors for ${outcome}.`,
        },
      ];
    }
  }

  const increasesRisk = sentence.match(/^(.{3,110}?)\s+(increases|raises|is associated with increased)\s+(?:the\s+)?risk of\s+(.{8,220})$/i);
  if (!increasesRisk) return [];

  const factor = cleanSubject(increasesRisk[1]);
  const outcome = cleanClause(increasesRisk[3]);
  if (!isUsefulSubject(factor) || !isUsefulClause(outcome)) return [];

  return [
    {
      cardType: 'risk-factor',
      focusKey: `${factor}:${outcome}`,
      sourceIndex: index,
      question: `What condition or outcome is more likely with ${questionConcept(factor)}?`,
      directAnswer: `${capitalize(factor)} increases the risk of ${outcome}`,
      whyItMatters: 'Risk-factor cards connect patient context to likely outcomes.',
      learningObjective: `Connect ${factor} with its associated risk.`,
    },
  ];
}

function createTreatmentSeeds(segment: ParsedSegment, sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  if (!/\b(first-line|treatment|therapy|management|treated with|managed with|drug of choice)\b/i.test(sentence)) {
    return [];
  }
  if (extractRecallClauses(sentence).some((clause) => ACTION_PATTERN.test(clause))) {
    return [];
  }

  const topic = bestTopicLabel(segment, sentence);
  const direct = summarizeSentence(sentence, 230);
  if (!topic || !isUsefulClause(direct)) return [];

  return [
    {
      cardType: 'treatment-reasoning',
      focusKey: `${topic}:treatment`,
      sourceIndex: index,
      question: `What treatment or management point matters for ${topic}?`,
      directAnswer: direct,
      whyItMatters: 'Management cards turn source text into a decision-oriented recall task.',
      learningObjective: `Recall a management point from ${sectionLabel(segment)}.`,
    },
  ];
}

function createDiagnosticSeeds(segment: ParsedSegment, sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  const directPattern = sentence.match(
    /^(.{3,110}?)\s+(?:is diagnosed by|is diagnosed when|is confirmed by|diagnosis requires|diagnostic criteria include)\s+(.{8,240})$/i,
  );
  const forPattern = sentence.match(/^diagnostic criteria for\s+(.{3,90}?)\s+include\s+(.{8,240})$/i);
  const match = directPattern || forPattern;
  if (!match) return [];

  const topic = cleanSubject(match[1]);
  const criteria = cleanClause(match[2]);
  if (!isUsefulSubject(topic) || !isUsefulClause(criteria)) return [];

  return [{
    cardType: 'diagnostic-reasoning',
    focusKey: `${topic}:diagnosis`,
    sourceIndex: index,
    question: `Which evidence supports the diagnosis of ${questionConcept(topic)}?`,
    directAnswer: `${capitalize(topic)} is supported by ${criteria}`,
    whyItMatters: 'Diagnostic cards connect findings to a conclusion without inventing facts beyond the source.',
    learningObjective: `Recall the source criteria used to identify ${topic}.`,
  }];
}

function createAlgorithmSeeds(segment: ParsedSegment, sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  if (!/\b(first|initially|before)\b.{8,180}\b(then|next|followed by|after)\b/i.test(sentence)) return [];
  if (!hasStrongMedicalSignal(sentence)) return [];

  const topic = bestTopicLabel(segment, sentence);
  if (!topic) return [];

  return [{
    cardType: 'algorithm-step',
    focusKey: `${topic}:sequence`,
    sourceIndex: index,
    question: `What sequence should you recall for ${questionConcept(topic)}?`,
    directAnswer: summarizeSentence(sentence, 250),
    whyItMatters: 'Sequence cards preserve order for multi-step clinical reasoning and management.',
    learningObjective: `Recall the ordered steps described in ${sectionLabel(segment)}.`,
  }];
}

function createClozeSeeds(sentences: string[], index: number): DraftSeed[] {
  const sentence = sentences[index];
  if (sentence.length < 70 || sentence.length > 260) return [];

  const term = findBestClozeTerm(sentence);
  if (!term) return [];

  const cloze = maskTerm(sentence, term);
  if (normalizeKey(cloze) === normalizeKey(sentence)) return [];

  return [
    {
      cardType: 'cloze-recall',
      focusKey: term,
      sourceIndex: index,
      question: `Fill in the missing concept: ${cloze}`,
      directAnswer: term,
      whyItMatters: 'Cloze cards force exact term retrieval while preserving the clinical context around it.',
      learningObjective: `Recall the missing concept in context: ${term}.`,
    },
  ];
}

function scoreDraft(segment: ParsedSegment, sentences: string[], seed: DraftSeed): ScoredDraft | null {
  const evidenceText = focusedEvidence(sentences, seed.sourceIndex);
  const answer = formatAnswer(seed.directAnswer, seed.whyItMatters, segment.locator);
  const combined = `${segment.sectionPath} ${seed.question} ${answer} ${evidenceText}`;
  const evidenceCoverage = sourceEvidenceCoverage(seed.directAnswer, evidenceText);
  let score = 0.28;

  score += Math.min(countMedicalSignals(combined) * 0.035, 0.16);
  score += seed.cardType === 'cloze-recall' ? 0.04 : 0.1;
  score += /^(how|why|which|when|fill)\b/i.test(seed.question) ? 0.08 : 0;
  score += answer.length >= 70 && answer.length <= MAX_ANSWER_CHARS ? 0.07 : -0.1;
  score += evidenceText.length >= 80 && evidenceText.length <= MAX_EVIDENCE_CHARS ? 0.06 : -0.08;
  score += segment.sectionPath && segment.sectionPath !== segment.locator ? 0.03 : 0;
  score += seed.learningObjective ? 0.04 : 0;
  score += evidenceCoverage >= 0.82 ? 0.12 : evidenceCoverage >= 0.65 ? 0.05 : -0.28;

  if (GENERIC_QUESTION_PATTERN.test(seed.question)) score -= 0.35;
  if (hasLongCopiedRun(answer, evidenceText)) score -= 0.15;
  if (!hasStrongMedicalSignal(combined)) score -= 0.18;
  if (!isUsefulClause(seed.directAnswer)) score -= 0.2;
  if (PERSONAL_ADVICE_PATTERN.test(seed.directAnswer)) score -= 0.35;
  if (seed.question.split(/\s+/).length > 34) score -= 0.12;

  const qualityScore = clampScore(score);
  if (qualityScore < MIN_QUALITY_SCORE) {
    return null;
  }

  return {
    segmentId: segment.id,
    locator: segment.locator,
    cardType: seed.cardType,
    learningObjective: seed.learningObjective,
    qualityScore,
    qualityNotes: describeQuality(seed.cardType, qualityScore, evidenceCoverage),
    question: trimToSentence(seed.question, 260),
    answer,
    evidenceText,
    focusKey: seed.focusKey,
    sourceIndex: seed.sourceIndex,
  };
}

function formatAnswer(directAnswer: string, whyItMatters: string, locator: string) {
  return [
    `Answer: ${ensureSentence(cleanClause(directAnswer))}`,
    `Why it matters: ${ensureSentence(whyItMatters)}`,
    `Source linked: ${locator}.`,
  ].join('\n');
}

function focusedEvidence(sentences: string[], index: number) {
  const window = [sentences[index - 1], sentences[index], sentences[index + 1]].filter(Boolean).join(' ');
  return trimToSentence(window || sentences[index] || '', MAX_EVIDENCE_CHARS);
}

function splitSentences(text: string) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const chunks = lines.length > 1 ? lines : [text];

  return chunks
    .flatMap((chunk) => chunk.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [chunk])
    .map((sentence) => cleanClause(sentence))
    .filter((sentence) => sentence.length >= 35 && !isMostlyReferenceText(sentence));
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

function isMostlyReferenceText(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return true;
  if (/^(references|bibliography|acknowledg|copyright|doi:|http|www\.)\b/i.test(cleaned)) return true;
  const citationLike = (cleaned.match(/\bdoi\b|https?:\/\/|\bet al\.\b|\bvol\.|\bpp\./gi) ?? []).length;
  return citationLike >= 3 && cleaned.length < 900;
}

function cleanSubject(value: string) {
  return cleanClause(value)
    .replace(/^(in|for|among|with)\s+[^,]{3,80},\s*/i, '')
    .replace(/^(but|however)\s+/i, '')
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/^[-*]\s*/, '')
    .replace(/\s*\([^)]{80,}\)\s*/g, ' ')
    .trim();
}

function cleanClause(value: string) {
  return value
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\s*\([^)]*(figure|table|see|page)[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,;:\-\s]+/, '')
    .replace(/[,;:\-\s]+$/, '')
    .trim();
}

function isUsefulSubject(subject: string) {
  const normalized = normalizeKey(subject);
  const words = subject.split(/\s+/).filter(Boolean);
  return (
    subject.length >= 3 &&
    subject.length <= 90 &&
    words.length <= 12 &&
    !LOW_VALUE_SUBJECTS.has(normalized) &&
    !/^(it|they|this|these|those|there|he|she|we|you)\b/i.test(subject) &&
    !/\b(figure|table|chapter|page)\s+\d+\b/i.test(subject)
  );
}

function isUsefulClause(value: string) {
  const cleaned = cleanClause(value);
  return cleaned.length >= 3 && cleaned.length <= 360 && !/^(figure|table|copyright|doi|references)\b/i.test(cleaned);
}

function definitionVerb(value: string) {
  return value.toLowerCase().includes('are') ? 'are' : 'is';
}

function extractRecallClauses(sentence: string) {
  const clauses = sentence
    .split(/;|\b(?:whereas|while|but)\b/i)
    .map((clause) => cleanClause(clause))
    .filter((clause) => clause.length >= 35);

  return clauses.length > 1 ? clauses : [sentence];
}

function focusPhrase(value: string) {
  const cleaned = cleanClause(value);
  const riskOutcome = extractRiskOutcome(cleaned);
  if (riskOutcome) return riskOutcome;

  const first = cleaned
    .split(/,|;|\bbecause\b|\bby\b/i)[0]
    .replace(/\s+and\s+(?:inhibits|blocks|reduces|decreases|lowers|increases|raises|stimulates|causes|prevents|binds|activates|suppresses|promotes|enhances|improves|worsens)\s+/i, ' and ')
    .replace(/\b(primarily|mainly|largely|mostly)$/i, '')
    .replace(/[.!?]+$/g, '')
    .trim();
  return trimToWords(first, 12).toLowerCase();
}

function comparisonFocus(value: string) {
  const cleaned = cleanClause(value)
    .replace(/^(however|therefore|thereby|in contrast|whereas|while|unlike)\s+/i, '')
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length < 1) return null;
  const focus = trimToWords(words.slice(0, Math.min(words.length, 7)).join(' '), 7);
  return isUsefulSubject(focus) ? focus : null;
}

function extractBeforeKeyword(sentence: string, keyword: RegExp) {
  const parts = sentence.split(keyword);
  return parts[0] ? cleanSubject(parts[0]) : '';
}

function extractContraindicationSubject(sentence: string) {
  const focused = sentence.match(
    /(?:^|[.;,]\s*|\bbut\s+)([^.;,]{3,110}?)\s+(?:is|are)?\s*(?:contraindicated|not recommended|should not be used|should be avoided|avoid)\b/i,
  );
  if (focused?.[1]) return cleanSubject(focused[1]);

  return extractBeforeKeyword(
    sentence,
    /(?:is|are)?\s*(?:contraindicated|not recommended|should not be used|should be avoided|avoid)\b/i,
  );
}

function extractContraindicationCondition(sentence: string) {
  const afterAvoidance = sentence.match(
    /\b(?:contraindicated|not recommended|should not be used|should be avoided|avoid(?:ed)?)\b\s+(.{0,180})/i,
  );
  const conditionText = cleanClause(afterAvoidance?.[1] ?? '').split(/\b(?:because|due to|since|as a result of)\b/i)[0];
  const match = conditionText.match(/\b(in|during|with|for)\b\s+(.{3,160})/i);
  if (match) return cleanClause(`${match[1]} ${match[2]}`).replace(/[.!?]+$/g, '');

  return extractAfterKeyword(sentence, /\b(in|during|with|for)\b/i).replace(/[.!?]+$/g, '');
}

function extractAfterKeyword(sentence: string, keyword: RegExp) {
  const match = sentence.match(keyword);
  if (!match || match.index == null) return '';
  const after = sentence.slice(match.index).trim();
  return cleanClause(after);
}

function extractReason(sentence: string) {
  const match = sentence.match(/\b(because|due to|as a result of|since)\b\s+(.{8,220})/i);
  return match ? match[2] : '';
}

function conditionPrefix(condition: string) {
  const cleaned = cleanClause(condition).replace(/[.!?]+$/g, '');
  if (/^(in|during|with|for)\b/i.test(cleaned)) return cleaned;
  return `in ${cleaned}`;
}

function summarizeSentence(sentence: string, maxLength: number) {
  return trimToSentence(cleanClause(sentence), maxLength);
}

function bestTopicLabel(segment: ParsedSegment, sentence: string) {
  const section = sectionLabel(segment);
  if (section && section !== segment.locator) return section;
  const term = findBestClozeTerm(sentence);
  return term || '';
}

function extractRiskOutcome(value: string) {
  const match = cleanClause(value).match(/(?:the\s+)?risk of\s+(.{3,180})/i);
  if (!match) return '';

  return trimToWords(match[1].split(/,|;|\bbecause\b|\bby\b/i)[0], 12).toLowerCase();
}

function sectionLabel(segment: ParsedSegment) {
  return cleanClause(segment.sectionPath || segment.locator);
}

function findBestClozeTerm(sentence: string) {
  const lower = sentence.toLowerCase();
  const sortedTerms = [...MEDICAL_TERMS].sort((left, right) => right.length - left.length);
  const term = sortedTerms.find((candidate) => new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'i').test(lower));
  if (!term || LOW_VALUE_SUBJECTS.has(term)) return '';

  const match = sentence.match(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i'));
  return match?.[0] ?? '';
}

function maskTerm(sentence: string, term: string) {
  return sentence.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i'), '_____');
}

function isDrugLike(value: string) {
  return /\b(metformin|insulin|inhibitor|blocker|agonist|antagonist|antibiotic|drug|therapy|medication)\b/i.test(value);
}

function isMechanismVerb(verb: string) {
  return /inhibits|blocks|reduces|decreases|lowers|increases|raises|stimulates|causes|prevents|binds|activates|suppresses|promotes|enhances/i.test(verb);
}

function hasStrongMedicalSignal(value: string) {
  return countMedicalSignals(value) >= 1;
}

function countMedicalSignals(value: string) {
  const lower = value.toLowerCase();
  return MEDICAL_TERMS.reduce((count, term) => {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i');
    return pattern.test(lower) ? count + 1 : count;
  }, 0);
}

function hasLongCopiedRun(answer: string, evidence: string) {
  const normalizedAnswer = normalizeKey(answer);
  const normalizedEvidence = normalizeKey(evidence);
  if (normalizedAnswer.length < 160 || normalizedEvidence.length < 160) return false;

  for (let index = 0; index + 160 <= normalizedAnswer.length; index += 40) {
    const slice = normalizedAnswer.slice(index, index + 160);
    if (normalizedEvidence.includes(slice)) {
      return true;
    }
  }
  return false;
}

function describeQuality(cardType: MedicalCardType, qualityScore: number, evidenceCoverage: number) {
  const typeLabel = cardType.replace(/-/g, ' ');
  const gate = qualityScore >= AUTO_PUBLISH_QUALITY_SCORE ? 'passes automatic publishing' : 'needs source attention';
  return `${Math.round(qualityScore * 100)}% quality · ${Math.round(evidenceCoverage * 100)}% answer-to-evidence coverage · ${typeLabel} · ${gate}.`;
}

function sourceEvidenceCoverage(answer: string, evidence: string) {
  const evidenceTokens = new Set(contentTokens(evidence));
  const answerTokens = contentTokens(answer);
  if (!answerTokens.length) return 0;
  const supported = answerTokens.filter((token) => evidenceTokens.has(token)).length;
  return supported / answerTokens.length;
}

function contentTokens(value: string) {
  const ignored = new Set(['about', 'after', 'also', 'because', 'before', 'from', 'have', 'into', 'should', 'that', 'their', 'there', 'these', 'this', 'those', 'when', 'where', 'which', 'with', 'would']);
  return normalizeKey(value).split(' ').filter((token) => token.length > 3 && !ignored.has(token));
}

function selectionScore(draft: ScoredDraft) {
  return draft.qualityScore + CARD_TYPE_PRIORITY[draft.cardType];
}

function recallAnswerKey(answer: string) {
  const match = answer.match(/^Answer:\s*(.+?)(?:\n|$)/i);
  return normalizeKey(match?.[1] ?? answer);
}

function questionConcept(value: string) {
  const cleaned = cleanSubject(value);
  if (!cleaned || /^[A-Z0-9 -]+$/.test(cleaned) || /^[A-Z]{2,}\b/.test(cleaned)) return cleaned;
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

function factSimilarity(left: string, right: string) {
  const leftTokens = new Set(contentTokens(recallAnswerKey(left)));
  const rightTokens = new Set(contentTokens(recallAnswerKey(right)));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function clampScore(value: number) {
  return Math.max(0, Math.min(0.99, Math.round(value * 100) / 100));
}

function trimToWords(value: string, maxWords: number) {
  return value.split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
}

function trimToSentence(value: string, maxLength: number) {
  const cleaned = cleanClause(value);
  if (cleaned.length <= maxLength) return ensureSentence(cleaned);
  const trimmed = cleaned.slice(0, maxLength).replace(/\s+\S*$/, '').trim();
  return ensureSentence(trimmed);
}

function ensureSentence(value: string) {
  const cleaned = cleanClause(value);
  if (!cleaned) return '';
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function capitalize(value: string) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
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
