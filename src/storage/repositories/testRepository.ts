import { createId, nowIso } from '@/domain/ids';
import type {
  ActiveTestSession,
  StudyCard,
  TestConfidence,
  TestDirection,
  TestFormat,
  TestQuestion,
  TestScope,
  TestSessionSummary,
} from '@/domain/types';
import { getDatabase } from '@/storage/database';
import { decideTestEvidence } from '@/testing/evidencePolicy';
import {
  burySiblingCards,
  hydrateCards,
  normalizeLimit,
  runWriteTransaction,
  writeReviewState,
  type WritableDatabase,
} from './shared';

export async function getTestCards({
  deckId,
  moduleId,
  scope,
  limit,
}: {
  deckId?: string;
  moduleId?: string;
  scope: TestScope;
  limit: number;
}): Promise<StudyCard[]> {
  const db = await getDatabase();
  const now = nowIso();
  const params: (string | number)[] = [];
  const deckFilter = deckId
    ? 'AND cards.deck_id = ?'
    : moduleId
      ? `AND cards.deck_id IN (
           SELECT module_decks.deck_id
           FROM module_decks
           JOIN course_modules ON course_modules.id = module_decks.module_id
           JOIN courses ON courses.id = course_modules.course_id
           WHERE module_decks.module_id = ?
             AND courses.deleted_at IS NULL
             AND courses.archived_at IS NULL
         )`
      : '';
  const scopeFilter =
    scope === 'due'
      ? 'AND memory_states.due_at <= ?'
      : scope === 'weak'
        ? 'AND COALESCE(card_learning_state.weak_score, 0) > 0'
        : '';

  if (deckId) params.push(deckId);
  else if (moduleId) params.push(moduleId);
  if (scope === 'due') params.push(now);
  params.push(now);
  params.push(now);
  params.push(limit === 0 ? 500 : normalizeLimit(limit, 100));

  const cards = await db.getAllAsync<StudyCard>(
    `SELECT
       cards.id,
       cards.deck_id AS deckId,
       decks.title AS deckTitle,
       cards.prompt,
       cards.answer,
       cards.card_type AS cardType,
       cards.status,
       cards.is_starred AS isStarred,
       memory_states.due_at AS dueAt,
       memory_states.fsrs_card_json AS fsrsCardJson,
       memory_states.last_reviewed_at AS lastReviewedAt,
       card_quality.learning_objective AS learningObjective,
       card_quality.quality_score AS qualityScore,
       card_quality.quality_notes AS qualityNotes,
       COALESCE(card_learning_state.weak_score, 0) AS weakScore,
       COALESCE(card_learning_state.is_flagged, 0) AS isFlagged,
       COALESCE(card_learning_state.is_suspended, 0) AS isSuspended,
       COALESCE(card_learning_state.is_leech, 0) AS isLeech,
       COALESCE(card_learning_state.lapse_count, 0) AS lapseCount
     FROM cards
     JOIN decks ON decks.id = cards.deck_id
     JOIN memory_states ON memory_states.card_id = cards.id
     LEFT JOIN card_quality ON card_quality.card_id = cards.id
     LEFT JOIN card_learning_state ON card_learning_state.card_id = cards.id
     WHERE cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL
       AND cards.status != 'needs_review'
       AND COALESCE(card_learning_state.is_suspended, 0) = 0
       ${deckFilter}
       ${scopeFilter}
       AND (card_learning_state.buried_until IS NULL OR card_learning_state.buried_until <= ?)
     ORDER BY
       COALESCE(card_learning_state.weak_score, 0) DESC,
       CASE WHEN memory_states.due_at <= ? THEN 0 ELSE 1 END,
       memory_states.due_at ASC,
       cards.updated_at DESC
     LIMIT ?`,
    params,
  );

  return hydrateCards(cards);
}

export async function startTestSession({
  deckId,
  format,
  direction,
  scope,
  questionLimit,
  questions,
}: {
  deckId?: string;
  format: TestFormat;
  direction: TestDirection;
  scope: TestScope;
  questionLimit: number;
  questions: TestQuestion[];
}) {
  const db = await getDatabase();
  const id = createId('test');
  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      `UPDATE test_sessions
       SET status = 'abandoned', updated_at = ?
       WHERE status = 'active'`,
      now,
    );
    await txn.runAsync(
      `INSERT INTO test_sessions
       (id, deck_id, format, direction, scope, question_limit, total_count, answered_count, correct_count,
        questions_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'active', ?, ?)`,
      id,
      deckId ?? null,
      format,
      direction,
      scope,
      questionLimit,
      questions.length,
      JSON.stringify(questions),
      now,
      now,
    );
  });
  return id;
}

export async function getLatestActiveTestSession(): Promise<ActiveTestSession | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    id: string;
    deckId: string | null;
    deckTitle: string | null;
    format: TestFormat;
    direction: TestDirection;
    scope: TestScope;
    questionLimit: number;
    totalCount: number;
    answeredCount: number;
    correctCount: number;
    questionsJson: string;
    createdAt: string;
  }>(
    `SELECT test_sessions.id,
            test_sessions.deck_id AS deckId,
            decks.title AS deckTitle,
            test_sessions.format,
            test_sessions.direction,
            test_sessions.scope,
            test_sessions.question_limit AS questionLimit,
            test_sessions.total_count AS totalCount,
            test_sessions.answered_count AS answeredCount,
            test_sessions.correct_count AS correctCount,
            test_sessions.questions_json AS questionsJson,
            test_sessions.created_at AS createdAt
     FROM test_sessions
     LEFT JOIN decks ON decks.id = test_sessions.deck_id
     WHERE test_sessions.status = 'active'
       AND test_sessions.answered_count < test_sessions.total_count
       AND test_sessions.questions_json != '[]'
     ORDER BY COALESCE(test_sessions.updated_at, test_sessions.created_at) DESC
     LIMIT 1`,
  );

  if (!row) return null;
  const questions = parseQuestionSnapshot(row.questionsJson);
  if (!questions.length) {
    await abandonTestSession(row.id);
    return null;
  }

  const responses = await db.getAllAsync<{ cardId: string | null; isCorrect: number }>(
    `SELECT card_id AS cardId, is_correct AS isCorrect
     FROM test_responses
     WHERE session_id = ?
     ORDER BY answered_at ASC`,
    row.id,
  );
  const missedIds = new Set(
    responses
      .filter((response) => !Number(response.isCorrect) && response.cardId)
      .map((response) => response.cardId as string),
  );
  const missedCards = questions
    .map((question) => question.card)
    .filter(
      (card, index, cards) =>
        missedIds.has(card.id) && cards.findIndex((candidate) => candidate.id === card.id) === index,
    );

  return {
    id: row.id,
    deckId: row.deckId,
    deckTitle: row.deckTitle,
    format: row.format,
    direction: row.direction,
    scope: row.scope,
    questionLimit: Number(row.questionLimit),
    totalCount: Number(row.totalCount),
    answeredCount: Number(row.answeredCount),
    correctCount: Number(row.correctCount),
    questions,
    missedCards,
    createdAt: row.createdAt,
  };
}

export async function abandonTestSession(sessionId: string) {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE test_sessions
     SET status = 'abandoned', updated_at = ?
     WHERE id = ? AND status = 'active'`,
    nowIso(),
    sessionId,
  );
}

export async function recordTestAnswer({
  sessionId,
  card,
  isCorrect,
  confidence,
  responseText,
  responseTimeMs,
}: {
  sessionId: string;
  card: StudyCard;
  isCorrect: boolean;
  confidence: TestConfidence;
  responseText: string;
  responseTimeMs: number;
}) {
  const db = await getDatabase();
  const reviewedAt = nowIso();
  const { rating, weakDelta, confidentMiss } = decideTestEvidence(isCorrect, confidence);

  await runWriteTransaction(db, async (txn) => {
    const session = await txn.getFirstAsync<{ status: string }>(
      'SELECT status FROM test_sessions WHERE id = ?',
      sessionId,
    );
    if (!session || session.status !== 'active') {
      throw new Error('This test is no longer active. Start or resume a test from Test Mode.');
    }
    const existingResponse = await txn.getFirstAsync<{ id: string }>(
      'SELECT id FROM test_responses WHERE session_id = ? AND card_id = ?',
      sessionId,
      card.id,
    );
    if (existingResponse) return;

    await writeReviewState(txn, card, rating, responseTimeMs, 'practice-test', reviewedAt, !isCorrect);
    await txn.runAsync(
      `INSERT INTO test_responses
       (id, session_id, card_id, response_text, is_correct, confidence, rating, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      createId('response'),
      sessionId,
      card.id,
      responseText.trim(),
      isCorrect ? 1 : 0,
      confidence,
      rating,
      reviewedAt,
    );
    await txn.runAsync(
      `UPDATE test_sessions SET
         answered_count = answered_count + 1,
         correct_count = correct_count + ?,
         updated_at = ?
       WHERE id = ?`,
      isCorrect ? 1 : 0,
      reviewedAt,
      sessionId,
    );
    await txn.runAsync(
      `INSERT INTO card_learning_state
       (card_id, weak_score, test_correct_count, test_incorrect_count, last_tested_at, lapse_count,
        is_leech, is_flagged, misconception_count, last_confident_miss_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
       ON CONFLICT(card_id) DO UPDATE SET
         weak_score = MAX(0, card_learning_state.weak_score + ?),
         test_correct_count = card_learning_state.test_correct_count + excluded.test_correct_count,
         test_incorrect_count = card_learning_state.test_incorrect_count + excluded.test_incorrect_count,
         lapse_count = card_learning_state.lapse_count + excluded.lapse_count,
         is_leech = CASE WHEN card_learning_state.lapse_count + excluded.lapse_count >= 8 THEN 1 ELSE card_learning_state.is_leech END,
         is_flagged = CASE WHEN card_learning_state.lapse_count + excluded.lapse_count >= 8 THEN 1 ELSE card_learning_state.is_flagged END,
         misconception_count = card_learning_state.misconception_count + excluded.misconception_count,
         last_confident_miss_at = COALESCE(excluded.last_confident_miss_at, card_learning_state.last_confident_miss_at),
         last_tested_at = excluded.last_tested_at`,
      card.id,
      Math.max(0, weakDelta),
      isCorrect ? 1 : 0,
      isCorrect ? 0 : 1,
      reviewedAt,
      isCorrect ? 0 : 1,
      confidentMiss ? 1 : 0,
      confidentMiss ? reviewedAt : null,
      weakDelta,
    );
    await burySiblingCards(txn, card.id, reviewedAt);
  });

  return rating;
}

export async function completeTestSession(sessionId: string): Promise<TestSessionSummary | null> {
  const db = await getDatabase();
  const completedAt = nowIso();
  await db.runAsync(
    "UPDATE test_sessions SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
    completedAt,
    completedAt,
    sessionId,
  );
  const result = await db.getFirstAsync<TestSessionSummary>(
    `SELECT id, total_count AS totalCount, answered_count AS answeredCount,
            correct_count AS correctCount, created_at AS createdAt
     FROM test_sessions WHERE id = ?`,
    sessionId,
  );
  return result
    ? {
        ...result,
        totalCount: Number(result.totalCount),
        answeredCount: Number(result.answeredCount),
        correctCount: Number(result.correctCount),
      }
    : null;
}

function parseQuestionSnapshot(value: string): TestQuestion[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((question): question is TestQuestion => {
      if (!question || typeof question !== 'object') return false;
      const candidate = question as Partial<TestQuestion>;
      return Boolean(
        typeof candidate.id === 'string' &&
          typeof candidate.prompt === 'string' &&
          typeof candidate.correctAnswer === 'string' &&
          candidate.card &&
          typeof candidate.card.id === 'string' &&
          Array.isArray(candidate.options) &&
          (
            candidate.type === 'multiple-choice' ||
            candidate.type === 'written-recall' ||
            candidate.type === 'true-false'
          ),
      );
    });
  } catch {
    return [];
  }
}
