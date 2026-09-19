import type * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import { createId, nowIso } from '@/domain/ids';
import type {
  StudyActivityOutcome,
  StudyCard,
  StudyEngineMode,
  StudyLearningGoal,
} from '@/domain/types';
import { modeCanRepeatMisses, nextShortTermDue } from '@/study/engine';
import { getDatabase } from '@/storage/database';

type ActivityResult = {
  requeue: boolean;
  nextDueAt: string | null;
};

export async function recordStudyActivity({
  sessionId,
  card,
  engineMode,
  learningGoal,
  outcome,
  responseTimeMs,
}: {
  sessionId: string;
  card: StudyCard;
  engineMode: StudyEngineMode;
  learningGoal: StudyLearningGoal;
  outcome: StudyActivityOutcome;
  responseTimeMs: number;
}): Promise<ActivityResult> {
  const db = await getDatabase();
  const occurredAt = nowIso();
  const shouldRepeat =
    modeCanRepeatMisses(engineMode, learningGoal) &&
    (outcome === 'learning' || outcome === 'again');
  const nextDueAt = nextShortTermDue(outcome, new Date(occurredAt));

  await runWriteTransaction(db, async (txn) => {
    const item = await txn.getFirstAsync<{ status: string }>(
      'SELECT status FROM study_session_items WHERE session_id = ? AND card_id = ?',
      sessionId,
      card.id,
    );
    if (!item || item.status !== 'pending') {
      throw new Error('This card has already been completed in the saved session.');
    }

    await txn.runAsync(
      `INSERT INTO study_activity_events
       (id, session_id, card_id, activity_mode, outcome, response_time_ms, affects_fsrs, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      createId('activity'),
      sessionId,
      card.id,
      engineMode,
      outcome,
      Math.max(0, Math.round(responseTimeMs)),
      occurredAt,
    );

    if (engineMode !== 'browse') {
      const familiarityDelta = outcomeDelta(outcome);
      const learningIncrement = outcome === 'learning' || outcome === 'again' ? 1 : 0;
      const knownIncrement = outcome === 'known' || outcome === 'good' || outcome === 'easy' ? 1 : 0;
      await txn.runAsync(
        `INSERT INTO card_mode_mastery
         (card_id, familiarity, short_due_at, learning_count, known_count, last_outcome, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(card_id) DO UPDATE SET
           familiarity = MAX(-10, MIN(10, card_mode_mastery.familiarity + excluded.familiarity)),
           short_due_at = excluded.short_due_at,
           learning_count = card_mode_mastery.learning_count + excluded.learning_count,
           known_count = card_mode_mastery.known_count + excluded.known_count,
           last_outcome = excluded.last_outcome,
           updated_at = excluded.updated_at`,
        card.id,
        familiarityDelta,
        nextDueAt,
        learningIncrement,
        knownIncrement,
        outcome,
        occurredAt,
      );
    }

    if (shouldRepeat) {
      await txn.runAsync(
        `UPDATE study_session_items
         SET attempt_count = attempt_count + 1,
             learning_state = 'learning',
             last_outcome = ?,
             available_at = ?,
             position = (SELECT COALESCE(MAX(position), 0) + 1 FROM study_session_items WHERE session_id = ?)
         WHERE session_id = ? AND card_id = ? AND status = 'pending'`,
        outcome,
        nextDueAt,
        sessionId,
        sessionId,
        card.id,
      );
      await txn.runAsync('UPDATE study_sessions SET updated_at = ? WHERE id = ?', occurredAt, sessionId);
      return;
    }

    await txn.runAsync(
      `UPDATE study_session_items
       SET status = 'completed', attempt_count = attempt_count + 1,
           learning_state = ?, last_outcome = ?, available_at = ?, completed_at = ?
       WHERE session_id = ? AND card_id = ? AND status = 'pending'`,
      outcome === 'learning' || outcome === 'again' ? 'learning' : 'known',
      outcome,
      nextDueAt,
      occurredAt,
      sessionId,
      card.id,
    );
    await txn.runAsync(
      `UPDATE study_sessions
       SET completed_count = completed_count + 1,
           status = CASE WHEN completed_count + 1 >= total_count THEN 'completed' ELSE status END,
           completed_at = CASE WHEN completed_count + 1 >= total_count THEN ? ELSE completed_at END,
           updated_at = ?
       WHERE id = ? AND status = 'active'`,
      occurredAt,
      occurredAt,
      sessionId,
    );
  });

  return { requeue: shouldRepeat, nextDueAt };
}

function outcomeDelta(outcome: StudyActivityOutcome) {
  switch (outcome) {
    case 'learning':
    case 'again':
      return -1;
    case 'hard':
      return -0.25;
    case 'known':
    case 'good':
      return 1;
    case 'easy':
      return 2;
    case 'viewed':
      return 0;
  }
}

async function runWriteTransaction(
  db: SQLite.SQLiteDatabase,
  task: (txn: SQLite.SQLiteDatabase) => Promise<void>,
) {
  if (Platform.OS === 'web') {
    await db.withTransactionAsync(async () => task(db));
    return;
  }
  await db.withExclusiveTransactionAsync(task);
}
