import { createId, nowIso } from '@/domain/ids';
import type { ReviewRating, StudyCard, StudyEngineMode, StudyLearningGoal, StudyMode } from '@/domain/types';
import { applyFsrsReview, replayFsrsReviews, schedulerVersion } from '@/scheduler/fsrs';
import { getDatabase } from '@/storage/database';
import { nextLocalDayIso, runWriteTransaction, type WritableDatabase } from './shared';

export async function recordCardReview(
  card: StudyCard,
  rating: ReviewRating,
  responseTimeMs: number,
  studyMode: StudyMode = 'scheduled',
  studySessionId?: string,
) {
  const db = await getDatabase();
  const reviewedAt = nowIso();
  await runWriteTransaction(db, async (txn) => {
    if (studySessionId) {
      const item = await txn.getFirstAsync<{ status: string }>(
        'SELECT status FROM study_session_items WHERE session_id = ? AND card_id = ?',
        studySessionId,
        card.id,
      );
      if (!item || item.status !== 'pending') {
        throw new Error('This card has already been completed in the saved session.');
      }
    }

    await writeReviewState(txn, card, rating, responseTimeMs, studyMode, reviewedAt, false, studySessionId);
    await txn.runAsync(
      `INSERT INTO study_activity_events
       (id, session_id, card_id, activity_mode, outcome, response_time_ms, affects_fsrs, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      createId('activity'),
      studySessionId ?? null,
      card.id,
      studyMode === 'scheduled' ? 'fsrs' : studyMode,
      rating,
      Math.max(0, Math.round(responseTimeMs)),
      reviewedAt,
    );
    await updateLearningSafetyState(txn, card.id, rating, reviewedAt);

    if (studySessionId) {
      await txn.runAsync(
        `UPDATE study_session_items SET status = 'completed', completed_at = ?
         WHERE session_id = ? AND card_id = ? AND status = 'pending'`,
        reviewedAt,
        studySessionId,
        card.id,
      );
      await txn.runAsync(
        `UPDATE study_sessions
         SET completed_count = completed_count + 1,
             status = CASE WHEN completed_count + 1 >= total_count THEN 'completed' ELSE status END,
             completed_at = CASE WHEN completed_count + 1 >= total_count THEN ? ELSE completed_at END,
             updated_at = ?
         WHERE id = ? AND status = 'active'`,
        reviewedAt,
        reviewedAt,
        studySessionId,
      );
    }
  });
}

export async function undoLastReview(cardId: string, studySessionId?: string) {
  const db = await getDatabase();
  const now = nowIso();

  const memory = await db.getFirstAsync<{
    initialFsrsCardJson: string | null;
    fsrsCardJson: string;
  }>(
    `
    SELECT
      initial_fsrs_card_json AS initialFsrsCardJson,
      fsrs_card_json AS fsrsCardJson
    FROM memory_states
    WHERE card_id = ?
    `,
    cardId,
  );

  const latestReview = await db.getFirstAsync<{ id: string; rating: ReviewRating }>(
    `
      SELECT id, rating
    FROM review_events
    WHERE card_id = ? AND reverted_at IS NULL
    ORDER BY reviewed_at DESC
    LIMIT 1
    `,
    cardId,
  );

  if (!memory || !latestReview) {
    return false;
  }

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync('UPDATE review_events SET reverted_at = ? WHERE id = ?', now, latestReview.id);
    await txn.runAsync(
      `UPDATE study_activity_events
       SET reverted_at = ?
       WHERE id = (
         SELECT id FROM study_activity_events
         WHERE card_id = ? AND affects_fsrs = 1 AND reverted_at IS NULL
         ORDER BY occurred_at DESC LIMIT 1
       )`,
      now,
      cardId,
    );

    if (latestReview.rating === 'again') {
      await txn.runAsync(
        `UPDATE card_learning_state
         SET weak_score = MAX(0, weak_score - 2),
             lapse_count = MAX(0, lapse_count - 1),
             is_leech = CASE WHEN lapse_count - 1 >= 8 THEN 1 ELSE 0 END
         WHERE card_id = ?`,
        cardId,
      );
    }

    if (studySessionId) {
      const restoredItem = await txn.runAsync(
        `UPDATE study_session_items SET status = 'pending', completed_at = NULL
         WHERE session_id = ? AND card_id = ? AND status = 'completed'`,
        studySessionId,
        cardId,
      );
      if (restoredItem.changes) {
        await txn.runAsync(
          `UPDATE study_sessions
           SET completed_count = MAX(0, completed_count - 1), status = 'active',
               completed_at = NULL, updated_at = ?
           WHERE id = ?`,
          now,
          studySessionId,
        );
      }
    }

    const reviews = await txn.getAllAsync<{ rating: ReviewRating; reviewedAt: string }>(
      `
      SELECT rating, reviewed_at AS reviewedAt
      FROM review_events
      WHERE card_id = ? AND reverted_at IS NULL
      ORDER BY reviewed_at ASC
      `,
      cardId,
    );

    const initialCard = memory.initialFsrsCardJson ?? memory.fsrsCardJson;
    const next = replayFsrsReviews(initialCard, reviews);
    const last = reviews.at(-1)?.reviewedAt ?? null;

    await txn.runAsync(
      `UPDATE memory_states
       SET fsrs_card_json = ?,
           difficulty = ?,
           stability = ?,
           retrievability = ?,
           due_at = ?,
           last_reviewed_at = ?,
           scheduler_version = ?
       WHERE card_id = ?`,
      next.cardJson,
      next.difficulty,
      next.stability,
      next.retrievability,
      next.dueAt,
      last,
      schedulerVersion,
      cardId,
    );
  });

  return true;
}



async function writeReviewState(
  db: WritableDatabase,
  card: StudyCard,
  rating: ReviewRating,
  responseTimeMs: number,
  studyMode: StudyMode,
  reviewedAt: string,
  makeDueNow = false,
  studySessionId?: string,
) {
  const currentMemory = await db.getFirstAsync<{ fsrsCardJson: string }>(
    'SELECT fsrs_card_json AS fsrsCardJson FROM memory_states WHERE card_id = ?',
    card.id,
  );
  const scheduled = applyFsrsReview(currentMemory?.fsrsCardJson ?? card.fsrsCardJson, rating, new Date(reviewedAt));
  const nextCard = JSON.parse(scheduled.cardJson) as Record<string, unknown>;
  if (makeDueNow) nextCard.due = reviewedAt;
  const cardJson = JSON.stringify(nextCard);
  const dueAt = makeDueNow ? reviewedAt : scheduled.dueAt;

  await db.runAsync(
    `INSERT INTO review_events
     (id, card_id, deck_id, reviewed_at, rating, response_time_ms, study_mode, scheduler_version, study_session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    createId('review'),
    card.id,
    card.deckId,
    reviewedAt,
    rating,
    Math.max(0, Math.round(responseTimeMs)),
    studyMode,
    schedulerVersion,
    studySessionId ?? null,
  );

  await db.runAsync(
    `UPDATE memory_states
     SET fsrs_card_json = ?, difficulty = ?, stability = ?, retrievability = ?,
         due_at = ?, last_reviewed_at = ?, scheduler_version = ?
     WHERE card_id = ?`,
    cardJson,
    scheduled.difficulty,
    scheduled.stability,
    scheduled.retrievability,
    dueAt,
    reviewedAt,
    schedulerVersion,
    card.id,
  );
}

async function updateLearningSafetyState(
  db: WritableDatabase,
  cardId: string,
  rating: ReviewRating,
  reviewedAt: string,
) {
  if (rating === 'again') {
    await db.runAsync(
      `INSERT INTO card_learning_state (card_id, weak_score, lapse_count, is_leech, is_flagged)
       VALUES (?, 2, 1, 0, 0)
       ON CONFLICT(card_id) DO UPDATE SET
         weak_score = card_learning_state.weak_score + 2,
         lapse_count = card_learning_state.lapse_count + 1,
         is_leech = CASE WHEN card_learning_state.lapse_count + 1 >= 8 THEN 1 ELSE card_learning_state.is_leech END,
         is_flagged = CASE WHEN card_learning_state.lapse_count + 1 >= 8 THEN 1 ELSE card_learning_state.is_flagged END`,
      cardId,
    );
  }

  await burySiblingCards(db, cardId, reviewedAt);
}

async function burySiblingCards(db: WritableDatabase, cardId: string, reviewedAt: string) {
  const buriedUntil = nextLocalDayIso(reviewedAt);
  await db.runAsync(
    `INSERT INTO card_learning_state (card_id, buried_until)
     SELECT sibling.id, ?
     FROM cards AS reviewed
     JOIN cards AS sibling ON sibling.note_id = reviewed.note_id AND sibling.id != reviewed.id
     WHERE reviewed.id = ? AND sibling.deleted_at IS NULL
     ON CONFLICT(card_id) DO UPDATE SET buried_until = excluded.buried_until`,
    buriedUntil,
    cardId,
  );
}
