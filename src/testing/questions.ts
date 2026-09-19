import { learnerAnswer } from '@/cards/answerView';
import type { StudyCard, StudyDifficulty, TestDirection, TestFormat, TestQuestion } from '@/domain/types';

const CLINICAL_TYPES = /clinical|contraindication|treatment|risk|diagnostic|mechanism/i;
const LIST_PATTERN = /[,;]|\band\b/i;
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?\s*(?:%|mg|mcg|g|ml|mmhg|bpm|days?|weeks?|months?|years?)?\b/i;
const NEGATION_PATTERN = /\b(?:no|not|never|avoid|contraindicated|without)\b/i;

type AnswerShape = 'number' | 'list' | 'phrase' | 'sentence';

type AnswerCandidate = {
  answer: string;
  card: StudyCard;
  shape: AnswerShape;
};

export function buildTestQuestions(
  cards: StudyCard[],
  format: TestFormat,
  difficulty: StudyDifficulty,
  direction: TestDirection = 'front-to-back',
): TestQuestion[] {
  const ordered = [...cards].sort((left, right) => {
    if (format === 'adaptive') return (right.weakScore ?? 0) - (left.weakScore ?? 0);
    if (format === 'clinical') {
      return Number(CLINICAL_TYPES.test(right.cardType)) - Number(CLINICAL_TYPES.test(left.cardType));
    }
    return 0;
  });
  return ordered.map((card, index) => {
    const reverse = shouldReverse(direction, card, index);
    const correctAnswer = reverse ? card.prompt.trim() : directAnswer(card.answer);
    const prompt = reverse ? directAnswer(card.answer) : card.prompt;
    const correct: AnswerCandidate = { answer: correctAnswer, card, shape: answerShape(correctAnswer) };
    const answerPool = uniqueCandidates(
      ordered.map((candidateCard) => {
        const answer = reverse ? candidateCard.prompt.trim() : directAnswer(candidateCard.answer);
        return { answer, card: candidateCard, shape: answerShape(answer) };
      }),
    );
    const compatiblePool = answerPool.filter((candidate) => isCompatibleDistractor(correct, candidate));
    const distractors = deterministicPick(compatiblePool, 3, hash(`${card.id}:${index}`));
    const trueFalse = maybeTrueFalseQuestion(card, prompt, correctAnswer, reverse, format, difficulty, index, compatiblePool);
    if (trueFalse) return trueFalse;

    // Recognition is only useful when every option is the same kind of answer.
    // Otherwise Barion uses written recall instead of producing a misleading medical MCQ.
    if (distractors.length < 3 || (difficulty === 'challenging' && index % 2 === 0)) {
      return writtenQuestion(card, prompt, correctAnswer, reverse);
    }

    const correctIndex = hash(card.id) % 4;
    const labels = distractors.map((candidate) => candidate.answer);
    labels.splice(correctIndex, 0, correctAnswer);
    const options = labels.map((label, optionIndex) => ({ id: `${card.id}-${optionIndex}`, label }));

    return {
      id: `question-${card.id}`,
      card,
      type: 'multiple-choice',
      prompt,
      options,
      correctOptionId: options[correctIndex].id,
      correctAnswer,
      direction: reverse ? 'back-to-front' : 'front-to-back',
    };
  });
}

function maybeTrueFalseQuestion(
  card: StudyCard,
  prompt: string,
  correctAnswer: string,
  reverse: boolean,
  format: TestFormat,
  difficulty: StudyDifficulty,
  index: number,
  compatiblePool: AnswerCandidate[],
): TestQuestion | null {
  if (format !== 'clinical' || difficulty === 'challenging' || reverse) return null;
  if (!CLINICAL_TYPES.test(card.cardType) || index % 3 !== 1) return null;

  const falseCandidate = deterministicPick(compatiblePool, 1, hash(`${card.id}:${index}:true-false`))[0];
  const useCorrectProposal = !falseCandidate || hash(`${card.id}:truth`) % 2 === 0;
  const proposedAnswer = useCorrectProposal ? correctAnswer : falseCandidate.answer;
  const correctOptionId = useCorrectProposal ? `${card.id}-tf-correct` : `${card.id}-tf-not-correct`;

  return {
    id: `question-${card.id}-true-false`,
    card,
    type: 'true-false',
    prompt,
    proposedAnswer,
    options: [
      { id: `${card.id}-tf-correct`, label: 'Correct' },
      { id: `${card.id}-tf-not-correct`, label: 'Not correct' },
    ],
    correctOptionId,
    correctAnswer,
    direction: 'front-to-back',
  };
}

function writtenQuestion(card: StudyCard, prompt: string, correctAnswer: string, reverse: boolean): TestQuestion {
  return {
    id: `question-${card.id}-${reverse ? 'reverse' : 'forward'}`,
    card,
    type: 'written-recall',
    prompt,
    options: [],
    correctAnswer,
    direction: reverse ? 'back-to-front' : 'front-to-back',
  };
}

function shouldReverse(direction: TestDirection, card: StudyCard, index: number) {
  if (direction === 'back-to-front') return true;
  if (direction === 'front-to-back') return false;
  const suitable = /definition|term|classification|anatomy|cloze/i.test(card.cardType)
    || (wordCount(card.prompt) <= 12 && wordCount(directAnswer(card.answer)) <= 14);
  return suitable && (hash(`${card.id}:${index}:direction`) % 2 === 1);
}

function isCompatibleDistractor(correct: AnswerCandidate, candidate: AnswerCandidate) {
  if (candidate.card.id === correct.card.id) return false;
  if (normalize(candidate.answer) === normalize(correct.answer)) return false;
  if (normalizeCardType(candidate.card.cardType) !== normalizeCardType(correct.card.cardType)) return false;
  if (candidate.shape !== correct.shape) return false;
  if (NEGATION_PATTERN.test(candidate.answer) !== NEGATION_PATTERN.test(correct.answer)) return false;

  const correctWords = wordCount(correct.answer);
  const candidateWords = wordCount(candidate.answer);
  const lengthRatio = Math.max(correctWords, candidateWords) / Math.max(1, Math.min(correctWords, candidateWords));
  if (lengthRatio > 2.25) return false;

  // Near-duplicate options can both appear correct, so they are never safe distractors.
  return tokenSimilarity(correct.answer, candidate.answer) < 0.72;
}

function answerShape(answer: string): AnswerShape {
  if (NUMBER_PATTERN.test(answer)) return 'number';
  if (LIST_PATTERN.test(answer)) return 'list';
  const words = wordCount(answer);
  if (words <= 8 && !/[.!?]$/.test(answer)) return 'phrase';
  return 'sentence';
}

function normalizeCardType(value: string) {
  const normalized = normalize(value);
  if (/clinical finding|sign|symptom/.test(normalized)) return 'clinical-finding';
  if (/contraindication|safety|adverse/.test(normalized)) return 'safety';
  if (/diagnostic|diagnosis/.test(normalized)) return 'diagnostic';
  if (/treatment|management|therapy/.test(normalized)) return 'treatment';
  if (/mechanism|action/.test(normalized)) return 'mechanism';
  if (/risk/.test(normalized)) return 'risk-factor';
  if (/definition/.test(normalized)) return 'definition';
  if (/classification/.test(normalized)) return 'classification';
  if (/comparison/.test(normalized)) return 'comparison';
  if (/algorithm/.test(normalized)) return 'algorithm';
  if (/cloze/.test(normalized)) return 'cloze';
  return normalized;
}

function directAnswer(answer: string) {
  return learnerAnswer(answer);
}

function deterministicPick(values: AnswerCandidate[], count: number, seed: number) {
  if (values.length <= count) return values;
  const result: AnswerCandidate[] = [];
  let cursor = seed;
  const remaining = [...values];
  while (result.length < count && remaining.length) {
    cursor = (cursor * 1664525 + 1013904223) >>> 0;
    result.push(remaining.splice(cursor % remaining.length, 1)[0]);
  }
  return result;
}

function uniqueCandidates(values: AnswerCandidate[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalize(value.answer);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function tokenSimilarity(left: string, right: string) {
  const leftTokens = new Set(normalize(left).split(' ').filter((token) => token.length > 2));
  const rightTokens = new Set(normalize(right).split(' ').filter((token) => token.length > 2));
  if (!leftTokens.size || !rightTokens.size) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function wordCount(value: string) {
  return normalize(value).split(' ').filter(Boolean).length;
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
