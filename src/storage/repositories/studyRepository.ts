import { createId, nowIso } from '@/domain/ids';
import type {
  ActiveStudySession,
  DailyPlan,
  DeckSummary,
  EvidenceSnippet,
  ReviewRating,
  StudyCard,
  StudyEngineMode,
  StudyLearningGoal,
  StudyMode,
  StudyProfile,
  StudyQueueResult,
} from '@/domain/types';
import { createInitialFsrsCard, schedulerVersion } from '@/scheduler/fsrs';
import { getDatabase } from '@/storage/database';
import { planReason, summarizePlanCards } from '@/planning/dailyPlan';
import {
  localDayStartIso,
  nextLocalDayIso,
  normalizeLimit,
  normalizeWeeklyStudyDays,
  parseWeeklyStudyDays,
  runWriteTransaction,
  upsertSearchIndex,
  type CountRow,
  type WritableDatabase,
} from './shared';
import { buildStudyQueueScope } from './studyQueueScope';

export async function getStudyProfile(): Promise<StudyProfile> {
  const db = await getDatabase();
  const profile = await db.getFirstAsync<StudyProfile>(
    `SELECT
       review_style AS reviewStyle,
       difficulty,
       session_length AS sessionLength,
       feedback_timing AS feedbackTiming,
       evidence_display AS evidenceDisplay,
       daily_new_limit AS dailyNewLimit,
       daily_review_limit AS dailyReviewLimit,
       exam_goal AS examGoal,
       workspace_mode AS workspaceMode,
       weekly_days_json AS weeklyStudyDaysJson,
       reminder_enabled AS reminderEnabled,
       reminder_hour AS reminderHour,
       updated_at AS updatedAt
     FROM study_profiles WHERE id = 'default'`,
  );

  if (!profile) {
    throw new Error('The Study Profile is unavailable. Restart Barion to repair local settings.');
  }

  const storedProfile = profile as StudyProfile & { weeklyStudyDaysJson?: string };
  return {
    ...profile,
    sessionLength: Number(profile.sessionLength),
    dailyNewLimit: Number(profile.dailyNewLimit),
    dailyReviewLimit: Number(profile.dailyReviewLimit),
    weeklyStudyDays: parseWeeklyStudyDays(storedProfile.weeklyStudyDaysJson),
    reminderEnabled: Boolean(Number(profile.reminderEnabled)),
    reminderHour: Math.max(0, Math.min(23, Number(profile.reminderHour ?? 19))),
  };
}

export async function updateStudyProfile(patch: Partial<StudyProfile>) {
  const db = await getDatabase();
  const current = await getStudyProfile();
  const next: StudyProfile = {
    ...current,
    ...patch,
    sessionLength: normalizeLimit(patch.sessionLength ?? current.sessionLength, 100),
    dailyNewLimit: normalizeLimit(patch.dailyNewLimit ?? current.dailyNewLimit, 200),
    dailyReviewLimit: normalizeLimit(patch.dailyReviewLimit ?? current.dailyReviewLimit, 500),
    weeklyStudyDays: normalizeWeeklyStudyDays(patch.weeklyStudyDays ?? current.weeklyStudyDays),
    reminderHour: Math.max(0, Math.min(23, Math.round(patch.reminderHour ?? current.reminderHour))),
    updatedAt: nowIso(),
  };

  await db.runAsync(
    `UPDATE study_profiles SET
       review_style = ?, difficulty = ?, session_length = ?, feedback_timing = ?,
       evidence_display = ?, daily_new_limit = ?, daily_review_limit = ?, exam_goal = ?,
       workspace_mode = ?, weekly_days_json = ?, reminder_enabled = ?, reminder_hour = ?, updated_at = ?
     WHERE id = 'default'`,
    next.reviewStyle,
    next.difficulty,
    next.sessionLength,
    next.feedbackTiming,
    next.evidenceDisplay,
    next.dailyNewLimit,
    next.dailyReviewLimit,
    next.examGoal,
    next.workspaceMode,
    JSON.stringify(next.weeklyStudyDays),
    next.reminderEnabled ? 1 : 0,
    next.reminderHour,
    next.updatedAt,
  );

  return next;
}

export async function getStudyQueue(
  deckId?: string,
  focus?: 'weak',
  limitOverride?: number,
  moduleId?: string,
): Promise<StudyCard[]> {
  return (await getStudyQueueResult(deckId, focus, limitOverride, moduleId)).cards;
}

type StudyQueueCounts = {
  totalCount: number;
  activeCount: number;
  dueActiveCount: number;
  dueReviewedCount: number;
  dueNewCount: number;
  notDueCount: number;
  weakDueCount: number;
  suspendedCount: number;
  buriedCount: number;
  needsReviewCount: number;
};

export async function getStudyQueueResult(
  deckId?: string,
  focus?: 'weak',
  limitOverride?: number,
  moduleId?: string,
): Promise<StudyQueueResult> {
  const db = await getDatabase();
  const now = nowIso();
  const profile = await getStudyProfile();
  const todayStart = localDayStartIso();
  const reviewedToday = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count FROM review_events
     WHERE reviewed_at >= ? AND reverted_at IS NULL AND study_mode != 'preview'`,
    todayStart,
  );
  const newReviewedToday = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count FROM (
       SELECT card_id, MIN(reviewed_at) AS first_reviewed
       FROM review_events WHERE reverted_at IS NULL
       GROUP BY card_id HAVING first_reviewed >= ?
     )`,
    todayStart,
  );
  const remainingDaily = profile.dailyReviewLimit === 0
    ? Number.MAX_SAFE_INTEGER
    : Math.max(profile.dailyReviewLimit - Number(reviewedToday?.count ?? 0), 0);
  const remainingNew = profile.dailyNewLimit === 0
    ? Number.MAX_SAFE_INTEGER
    : Math.max(profile.dailyNewLimit - Number(newReviewedToday?.count ?? 0), 0);
  const configuredLimit = limitOverride ?? profile.sessionLength;
  const sessionLimit = configuredLimit === 0 ? remainingDaily : Math.min(configuredLimit, remainingDaily);

  const scope = buildStudyQueueScope(deckId, moduleId);
  const focusFilter = focus === 'weak' ? 'AND COALESCE(card_learning_state.weak_score, 0) > 0' : '';

  const cards = sessionLimit <= 0 ? [] : await db.getAllAsync<StudyCard>(
    `
    SELECT
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
    WHERE memory_states.due_at <= ?
      AND cards.deleted_at IS NULL
      AND decks.deleted_at IS NULL
      AND decks.archived_at IS NULL
      AND cards.status != 'needs_review'
      AND COALESCE(card_learning_state.is_suspended, 0) = 0
      AND (card_learning_state.buried_until IS NULL OR card_learning_state.buried_until <= ?)
      ${scope.clause}
      ${focusFilter}
    ORDER BY COALESCE(card_learning_state.weak_score, 0) DESC, memory_states.due_at ASC, cards.created_at ASC
    LIMIT 500
    `,
    [now, ...scope.params, now],
  );

  let newCards = 0;
  const selected = cards.filter((card) => {
    if (card.lastReviewedAt) return true;
    if (newCards >= remainingNew) return false;
    newCards += 1;
    return true;
  }).slice(0, sessionLimit);

  const hydrated = await hydrateCards(selected);
  const counts = await db.getFirstAsync<StudyQueueCounts>(
    `SELECT
       COUNT(*) AS totalCount,
       SUM(CASE WHEN cards.status != 'needs_review' AND COALESCE(card_learning_state.is_suspended, 0) = 0 THEN 1 ELSE 0 END) AS activeCount,
       SUM(CASE WHEN cards.status != 'needs_review' AND COALESCE(card_learning_state.is_suspended, 0) = 0
                 AND memory_states.due_at <= ?
                 AND (card_learning_state.buried_until IS NULL OR card_learning_state.buried_until <= ?)
                THEN 1 ELSE 0 END) AS dueActiveCount,
       SUM(CASE WHEN cards.status != 'needs_review' AND COALESCE(card_learning_state.is_suspended, 0) = 0
                 AND memory_states.last_reviewed_at IS NOT NULL AND memory_states.due_at <= ?
                 AND (card_learning_state.buried_until IS NULL OR card_learning_state.buried_until <= ?)
                THEN 1 ELSE 0 END) AS dueReviewedCount,
       SUM(CASE WHEN cards.status != 'needs_review' AND COALESCE(card_learning_state.is_suspended, 0) = 0
                 AND memory_states.last_reviewed_at IS NULL AND memory_states.due_at <= ?
                 AND (card_learning_state.buried_until IS NULL OR card_learning_state.buried_until <= ?)
                THEN 1 ELSE 0 END) AS dueNewCount,
       SUM(CASE WHEN cards.status != 'needs_review' AND COALESCE(card_learning_state.is_suspended, 0) = 0
                 AND memory_states.due_at > ? THEN 1 ELSE 0 END) AS notDueCount,
       SUM(CASE WHEN cards.status != 'needs_review' AND COALESCE(card_learning_state.is_suspended, 0) = 0
                 AND COALESCE(card_learning_state.weak_score, 0) > 0 AND memory_states.due_at <= ?
                 AND (card_learning_state.buried_until IS NULL OR card_learning_state.buried_until <= ?)
                THEN 1 ELSE 0 END) AS weakDueCount,
       SUM(CASE WHEN COALESCE(card_learning_state.is_suspended, 0) = 1 THEN 1 ELSE 0 END) AS suspendedCount,
       SUM(CASE WHEN cards.status != 'needs_review' AND COALESCE(card_learning_state.is_suspended, 0) = 0
                 AND card_learning_state.buried_until > ? THEN 1 ELSE 0 END) AS buriedCount,
       SUM(CASE WHEN cards.status = 'needs_review' THEN 1 ELSE 0 END) AS needsReviewCount
     FROM cards
     JOIN decks ON decks.id = cards.deck_id
     JOIN memory_states ON memory_states.card_id = cards.id
     LEFT JOIN card_learning_state ON card_learning_state.card_id = cards.id
     WHERE cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL
       ${scope.clause}`,
    [now, now, now, now, now, now, now, now, now, now, ...scope.params],
  );
  const normalized = normalizeStudyQueueCounts(counts);
  const emptyReason = studyQueueEmptyReason({
    counts: normalized,
    focus,
    remainingDaily,
    remainingNew,
    selectedCount: hydrated.length,
  });
  const dailyLimitExcluded = remainingDaily <= 0
    ? normalized.dueActiveCount
    : Math.max(normalized.dueNewCount - remainingNew, 0);

  return {
    cards: hydrated,
    totalActive: normalized.activeCount,
    availableNow: hydrated.length,
    emptyReason,
    excluded: {
      notDue: normalized.notDueCount,
      suspended: normalized.suspendedCount,
      buried: normalized.buriedCount,
      needsReview: normalized.needsReviewCount,
      dailyLimit: dailyLimitExcluded,
    },
  };
}

function normalizeStudyQueueCounts(counts: StudyQueueCounts | null): StudyQueueCounts {
  return {
    totalCount: Number(counts?.totalCount ?? 0),
    activeCount: Number(counts?.activeCount ?? 0),
    dueActiveCount: Number(counts?.dueActiveCount ?? 0),
    dueReviewedCount: Number(counts?.dueReviewedCount ?? 0),
    dueNewCount: Number(counts?.dueNewCount ?? 0),
    notDueCount: Number(counts?.notDueCount ?? 0),
    weakDueCount: Number(counts?.weakDueCount ?? 0),
    suspendedCount: Number(counts?.suspendedCount ?? 0),
    buriedCount: Number(counts?.buriedCount ?? 0),
    needsReviewCount: Number(counts?.needsReviewCount ?? 0),
  };
}

function studyQueueEmptyReason({
  counts,
  focus,
  remainingDaily,
  remainingNew,
  selectedCount,
}: {
  counts: StudyQueueCounts;
  focus?: 'weak';
  remainingDaily: number;
  remainingNew: number;
  selectedCount: number;
}): StudyQueueResult['emptyReason'] {
  if (selectedCount > 0) return 'ready';
  if (counts.totalCount === 0) return 'no-cards';
  if (remainingDaily <= 0) return 'daily-review-limit';
  if (focus === 'weak' && counts.weakDueCount === 0) return 'no-weak-cards';
  if (remainingNew <= 0 && counts.dueNewCount > 0 && counts.dueReviewedCount === 0) return 'daily-new-limit';
  if (counts.dueActiveCount === 0 && counts.notDueCount > 0) return 'not-due';
  if (counts.buriedCount > 0) return 'buried';
  if (counts.suspendedCount > 0) return 'suspended';
  if (counts.needsReviewCount > 0) return 'needs-review';
  return 'no-cards';
}

export async function getModeStudyQueue(
  deckId?: string,
  moduleId?: string,
  limitOverride?: number,
): Promise<StudyCard[]> {
  const db = await getDatabase();
  const profile = await getStudyProfile();
  const limit = limitOverride ?? profile.sessionLength;
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
  const params = deckId ? [deckId] : moduleId ? [moduleId] : [];
  const cards = await db.getAllAsync<StudyCard>(
    `SELECT
       cards.id, cards.deck_id AS deckId, decks.title AS deckTitle, cards.prompt, cards.answer,
       cards.card_type AS cardType, cards.status, cards.is_starred AS isStarred,
       memory_states.due_at AS dueAt, memory_states.fsrs_card_json AS fsrsCardJson,
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
     LEFT JOIN card_mode_mastery ON card_mode_mastery.card_id = cards.id
     WHERE cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL
       AND cards.status != 'needs_review'
       AND COALESCE(card_learning_state.is_suspended, 0) = 0
       ${deckFilter}
     ORDER BY COALESCE(card_learning_state.weak_score, 0) DESC,
              CASE WHEN card_mode_mastery.short_due_at IS NOT NULL AND card_mode_mastery.short_due_at <= ? THEN 0 ELSE 1 END,
              memory_states.due_at ASC,
              cards.created_at ASC
     LIMIT ?`,
    [...params, nowIso(), limit === 0 ? 500 : Math.min(limit, 500)],
  );
  return hydrateCards(cards);
}

export async function getDailyPlan(minimum = false): Promise<DailyPlan> {
  const activeSession = await getLatestActiveStudySession();
  if (activeSession) {
    const remaining = activeSession.cards.length;
    return {
      state: 'resume',
      totalCount: activeSession.totalCount,
      completedCount: activeSession.completedCount,
      weakCount: activeSession.cards.filter((card) => (card.weakScore ?? 0) > 0).length,
      newCount: activeSession.cards.filter((card) => !card.lastReviewedAt).length,
      dueCount: activeSession.cards.filter((card) => (card.weakScore ?? 0) <= 0 && Boolean(card.lastReviewedAt)).length,
      estimatedMinutes: Math.max(1, Math.ceil(remaining * 0.75)),
      reason: `Resume where you stopped—${remaining} card${remaining === 1 ? '' : 's'} remain in the saved plan.`,
    };
  }

  const cards = await getStudyQueue(undefined, undefined, minimum ? 5 : undefined);
  const mix = summarizePlanCards(cards);
  const totalCount = cards.length;
  return {
    state: totalCount ? 'ready' : 'complete',
    totalCount,
    completedCount: 0,
    ...mix,
    reason: planReason(mix, totalCount),
  };
}

export async function startStudySession({
  cards,
  deckId,
  focus,
  mode,
  planSize,
  engineMode = 'fsrs',
  learningGoal = 'long-term',
}: {
  cards: StudyCard[];
  deckId?: string;
  focus?: string;
  mode: ActiveStudySession['mode'];
  planSize: ActiveStudySession['planSize'];
  engineMode?: StudyEngineMode;
  learningGoal?: StudyLearningGoal;
}): Promise<ActiveStudySession> {
  if (!cards.length) throw new Error('There are no cards available for this study session.');
  const db = await getDatabase();
  const id = createId('study-session');
  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      "UPDATE study_sessions SET status = 'abandoned', updated_at = ? WHERE status = 'active'",
      now,
    );
    await txn.runAsync(
      `INSERT INTO study_sessions
       (id, mode, engine_mode, learning_goal, deck_id, focus, plan_size, total_count, completed_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?)`,
      id,
      mode,
      engineMode,
      learningGoal,
      deckId ?? null,
      focus ?? null,
      planSize,
      cards.length,
      now,
      now,
    );
    for (const [position, card] of cards.entries()) {
      await txn.runAsync(
        `INSERT INTO study_session_items (session_id, card_id, position, status)
         VALUES (?, ?, ?, 'pending')`,
        id,
        card.id,
        position,
      );
    }
  });
  return {
    id,
    mode,
    engineMode,
    learningGoal,
    deckId: deckId ?? null,
    focus: focus ?? null,
    planSize,
    totalCount: cards.length,
    completedCount: 0,
    createdAt: now,
    cards,
  };
}

export async function getLatestActiveStudySession(): Promise<ActiveStudySession | null> {
  const db = await getDatabase();
  const session = await db.getFirstAsync<Omit<ActiveStudySession, 'cards'>>(
    `SELECT id, mode, engine_mode AS engineMode, learning_goal AS learningGoal,
            deck_id AS deckId, focus, plan_size AS planSize,
            total_count AS totalCount, completed_count AS completedCount, created_at AS createdAt
     FROM study_sessions
     WHERE status = 'active'
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  if (!session) return null;

  const cards = await db.getAllAsync<StudyCard>(
    `SELECT
       cards.id, cards.deck_id AS deckId, decks.title AS deckTitle, cards.prompt, cards.answer,
       cards.card_type AS cardType, cards.status, cards.is_starred AS isStarred,
       memory_states.due_at AS dueAt, memory_states.fsrs_card_json AS fsrsCardJson,
       memory_states.last_reviewed_at AS lastReviewedAt,
       card_quality.learning_objective AS learningObjective,
       card_quality.quality_score AS qualityScore,
       card_quality.quality_notes AS qualityNotes,
       COALESCE(card_learning_state.weak_score, 0) AS weakScore,
       COALESCE(card_learning_state.is_flagged, 0) AS isFlagged,
       COALESCE(card_learning_state.is_suspended, 0) AS isSuspended,
       COALESCE(card_learning_state.is_leech, 0) AS isLeech,
       COALESCE(card_learning_state.lapse_count, 0) AS lapseCount
     FROM study_session_items
     JOIN cards ON cards.id = study_session_items.card_id
     JOIN decks ON decks.id = cards.deck_id
     JOIN memory_states ON memory_states.card_id = cards.id
     LEFT JOIN card_quality ON card_quality.card_id = cards.id
     LEFT JOIN card_learning_state ON card_learning_state.card_id = cards.id
     WHERE study_session_items.session_id = ?
       AND study_session_items.status = 'pending'
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL
       AND cards.status != 'needs_review'
       AND COALESCE(card_learning_state.is_suspended, 0) = 0
     ORDER BY study_session_items.position ASC`,
    session.id,
  );

  if (!cards.length) {
    await db.runAsync(
      "UPDATE study_sessions SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?",
      nowIso(),
      nowIso(),
      session.id,
    );
    return null;
  }

  return {
    ...session,
    totalCount: Number(session.totalCount),
    completedCount: Number(session.completedCount),
    cards: await hydrateCards(cards),
  };
}

export async function abandonStudySession(sessionId: string) {
  const db = await getDatabase();
  await db.runAsync(
    "UPDATE study_sessions SET status = 'abandoned', updated_at = ? WHERE id = ? AND status = 'active'",
    nowIso(),
    sessionId,
  );
}


export async function setCardsSuspended(cardIds: string[], suspended: boolean) {
  const db = await getDatabase();
  const uniqueIds = [...new Set(cardIds)].filter(Boolean);
  await runWriteTransaction(db, async (txn) => {
    for (const cardId of uniqueIds) {
      await txn.runAsync(
        `INSERT INTO card_learning_state (card_id, is_suspended)
         VALUES (?, ?)
         ON CONFLICT(card_id) DO UPDATE SET is_suspended = excluded.is_suspended`,
        cardId,
        suspended ? 1 : 0,
      );
    }
  });
  return uniqueIds.length;
}

export async function setCardFlagged(cardId: string, flagged: boolean) {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO card_learning_state (card_id, is_flagged)
     VALUES (?, ?)
     ON CONFLICT(card_id) DO UPDATE SET is_flagged = excluded.is_flagged`,
    cardId,
    flagged ? 1 : 0,
  );
}

export async function updateStudyCard(
  cardId: string,
  patch: { prompt: string; answer: string; qualityNotes?: string },
) {
  const prompt = patch.prompt.trim();
  const answer = patch.answer.trim();
  if (!prompt || !answer) {
    throw new Error('Cards need both a front and a back.');
  }

  const db = await getDatabase();
  const card = await db.getFirstAsync<{
    deckId: string;
    noteId: string | null;
    status: StudyCard['status'];
    evidenceCount: number;
  }>(
    `SELECT cards.deck_id AS deckId,
            cards.note_id AS noteId,
            cards.status,
            COUNT(card_evidence.id) AS evidenceCount
     FROM cards
     JOIN decks ON decks.id = cards.deck_id
     LEFT JOIN card_evidence ON card_evidence.card_id = cards.id
     WHERE cards.id = ?
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL
     GROUP BY cards.id, cards.deck_id, cards.note_id, cards.status`,
    cardId,
  );

  if (!card) {
    throw new Error('This card is no longer available.');
  }

  const sourceBacked = Number(card.evidenceCount ?? 0) > 0;
  const nextStatus = sourceBacked ? 'needs_review' : card.status;
  const notes =
    patch.qualityNotes?.trim() ||
    (sourceBacked
      ? 'Edited wording needs source confirmation before study.'
      : 'Card wording was edited manually.');
  const now = nowIso();

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      'UPDATE cards SET prompt = ?, answer = ?, status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      prompt,
      answer,
      nextStatus,
      now,
      cardId,
    );
    if (card.noteId) {
      await txn.runAsync(
        'UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
        prompt,
        answer,
        now,
        card.noteId,
      );
    }
    await txn.runAsync(
      `INSERT INTO card_quality (card_id, learning_objective, quality_score, quality_notes, checked_at)
       VALUES (?, '', ?, ?, ?)
       ON CONFLICT(card_id) DO UPDATE SET
         quality_score = CASE
           WHEN excluded.quality_score > 0 AND card_quality.quality_score > excluded.quality_score THEN excluded.quality_score
           ELSE card_quality.quality_score
         END,
         quality_notes = excluded.quality_notes,
         checked_at = excluded.checked_at`,
      cardId,
      sourceBacked ? 0.5 : 0,
      notes,
      now,
    );
    if (sourceBacked) {
      await txn.runAsync(
        `INSERT INTO card_learning_state (card_id, weak_score, is_flagged, is_suspended)
         VALUES (?, 3, 1, 1)
         ON CONFLICT(card_id) DO UPDATE SET
           weak_score = MAX(card_learning_state.weak_score, 3),
           is_flagged = 1,
           is_suspended = 1`,
        cardId,
      );
      await txn.runAsync(
        "UPDATE card_evidence SET verification_status = 'needs-source-review' WHERE card_id = ?",
        cardId,
      );
    }
    await txn.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', now, card.deckId);
    await upsertSearchIndex(txn, cardId);
  });

  return { needsSourceReview: sourceBacked };
}

export async function markCardNeedsSourceReview(cardId: string, studySessionId?: string) {
  const db = await getDatabase();
  const card = await db.getFirstAsync<{ id: string; deckId: string }>(
    `SELECT cards.id, cards.deck_id AS deckId
     FROM cards
     JOIN decks ON decks.id = cards.deck_id
     WHERE cards.id = ?
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL`,
    cardId,
  );

  if (!card) {
    throw new Error('This card is no longer available.');
  }

  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      "UPDATE cards SET status = 'needs_review', updated_at = ? WHERE id = ? AND deleted_at IS NULL",
      now,
      cardId,
    );
    await txn.runAsync(
      `INSERT INTO card_learning_state (card_id, weak_score, is_flagged, is_suspended)
       VALUES (?, 4, 1, 1)
       ON CONFLICT(card_id) DO UPDATE SET
         weak_score = MAX(card_learning_state.weak_score, 4),
         is_flagged = 1,
         is_suspended = 1`,
      cardId,
    );
    await txn.runAsync(
      `INSERT INTO card_quality (card_id, learning_objective, quality_score, quality_notes, checked_at)
       VALUES (?, '', 0.25, 'Held for source review after the learner marked it confusing or unsafe.', ?)
       ON CONFLICT(card_id) DO UPDATE SET
         quality_score = CASE
           WHEN card_quality.quality_score > 0 THEN MIN(card_quality.quality_score, excluded.quality_score)
           ELSE excluded.quality_score
         END,
         quality_notes = excluded.quality_notes,
         checked_at = excluded.checked_at`,
      cardId,
      now,
    );
    await txn.runAsync(
      "UPDATE card_evidence SET verification_status = 'needs-source-review' WHERE card_id = ?",
      cardId,
    );
    if (studySessionId) {
      const held = await txn.runAsync(
        `UPDATE study_session_items
         SET status = 'held', completed_at = ?
         WHERE session_id = ? AND card_id = ? AND status = 'pending'`,
        now,
        studySessionId,
        cardId,
      );
      if (held.changes) {
        await txn.runAsync(
          `UPDATE study_sessions
           SET total_count = MAX(completed_count, total_count - 1),
               status = CASE
                 WHEN completed_count >= MAX(completed_count, total_count - 1) THEN 'completed'
                 ELSE status
               END,
               completed_at = CASE
                 WHEN completed_count >= MAX(completed_count, total_count - 1) THEN ?
                 ELSE completed_at
               END,
               updated_at = ?
           WHERE id = ? AND status = 'active'`,
          now,
          now,
          studySessionId,
        );
      }
    }
    await txn.runAsync(
      `UPDATE test_sessions
       SET status = 'abandoned', updated_at = ?
       WHERE status = 'active' AND questions_json LIKE ?`,
      now,
      `%${cardId}%`,
    );
    await txn.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', now, card.deckId);
    await upsertSearchIndex(txn, cardId);
  });

  return true;
}

export async function restoreCardFromSourceReview(cardId: string) {
  const db = await getDatabase();
  const evidence = await db.getFirstAsync<{
    deckId: string;
    evidenceCount: number;
    curatedCount: number;
    qualityNotes: string | null;
  }>(
    `SELECT
       cards.deck_id AS deckId,
       COUNT(card_evidence.id) AS evidenceCount,
       SUM(CASE WHEN sources.sha256 = 'built-in-curated-demo-v1' THEN 1 ELSE 0 END) AS curatedCount,
       card_quality.quality_notes AS qualityNotes
     FROM cards
     LEFT JOIN card_quality ON card_quality.card_id = cards.id
     LEFT JOIN card_evidence ON card_evidence.card_id = cards.id
     LEFT JOIN source_segments ON source_segments.id = card_evidence.segment_id
     LEFT JOIN sources ON sources.id = source_segments.source_id
     WHERE cards.id = ? AND cards.deleted_at IS NULL
     GROUP BY cards.id, cards.deck_id, card_quality.quality_notes`,
    cardId,
  );
  if (!evidence) {
    throw new Error('This card is no longer available.');
  }
  const hasEvidence = Number(evidence?.evidenceCount ?? 0) > 0;
  const editedDuringReview = Boolean(
    evidence.qualityNotes &&
      !evidence.qualityNotes.startsWith('Held for source review after'),
  );
  const isCurated = Number(evidence?.curatedCount ?? 0) > 0 && !editedDuringReview;
  const nextStatus = isCurated ? 'verified' : hasEvidence ? 'source_extracted' : 'manual';
  const nextEvidenceStatus = isCurated ? 'built-in-curated-demo' : 'user-approved-extractive';
  const now = nowIso();

  await runWriteTransaction(db, async (txn) => {
    const restored = await txn.runAsync(
      'UPDATE cards SET status = ?, updated_at = ? WHERE id = ? AND status = ? AND deleted_at IS NULL',
      nextStatus,
      now,
      cardId,
      'needs_review',
    );
    if (!restored.changes) {
      throw new Error('This card is not waiting for source review.');
    }
    await txn.runAsync(
      `INSERT INTO card_learning_state (card_id, weak_score, is_flagged, is_suspended)
       VALUES (?, 0, 0, 0)
       ON CONFLICT(card_id) DO UPDATE SET
         weak_score = 0,
         is_flagged = 0,
         is_suspended = 0`,
      cardId,
    );
    await txn.runAsync(
      `UPDATE card_quality
       SET quality_notes = 'Restored for study after source evidence was checked.',
           checked_at = ?
       WHERE card_id = ?`,
      now,
      cardId,
    );
    await txn.runAsync(
      `UPDATE card_evidence
       SET verification_status = ?
       WHERE card_id = ? AND verification_status = 'needs-source-review'`,
      nextEvidenceStatus,
      cardId,
    );
    await txn.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', now, evidence.deckId);
    await upsertSearchIndex(txn, cardId);
  });

  return true;
}

export async function getCardsNeedingSourceReview(): Promise<StudyCard[]> {
  const db = await getDatabase();
  const cards = await db.getAllAsync<StudyCard>(
    `SELECT cards.id, cards.deck_id AS deckId, decks.title AS deckTitle,
            cards.prompt, cards.answer, cards.card_type AS cardType, cards.status,
            cards.is_starred AS isStarred, memory_states.due_at AS dueAt,
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
     WHERE cards.status = 'needs_review'
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL
     ORDER BY cards.updated_at DESC
     LIMIT 100`,
  );
  return hydrateCards(cards);
}

export async function getLeechCards(): Promise<StudyCard[]> {
  const db = await getDatabase();
  const cards = await db.getAllAsync<StudyCard>(
    `SELECT cards.id, cards.deck_id AS deckId, decks.title AS deckTitle,
            cards.prompt, cards.answer, cards.card_type AS cardType, cards.status,
            cards.is_starred AS isStarred, memory_states.due_at AS dueAt,
            memory_states.fsrs_card_json AS fsrsCardJson,
            memory_states.last_reviewed_at AS lastReviewedAt,
            card_quality.learning_objective AS learningObjective,
            card_quality.quality_score AS qualityScore,
            card_quality.quality_notes AS qualityNotes,
            card_learning_state.weak_score AS weakScore,
            card_learning_state.is_flagged AS isFlagged,
            card_learning_state.is_suspended AS isSuspended,
            card_learning_state.is_leech AS isLeech,
            card_learning_state.lapse_count AS lapseCount
     FROM card_learning_state
     JOIN cards ON cards.id = card_learning_state.card_id
     JOIN decks ON decks.id = cards.deck_id
     JOIN memory_states ON memory_states.card_id = cards.id
     LEFT JOIN card_quality ON card_quality.card_id = cards.id
     WHERE card_learning_state.is_leech = 1
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
     ORDER BY card_learning_state.lapse_count DESC, cards.updated_at DESC
     LIMIT 100`,
  );
  return hydrateCards(cards);
}

export async function getEvidenceForCard(cardId: string): Promise<EvidenceSnippet | undefined> {
  const db = await getDatabase();
  const evidence = await db.getFirstAsync<EvidenceSnippet>(
    `
    SELECT
      sources.title AS sourceTitle,
      source_segments.locator AS locator,
      card_evidence.evidence_text AS text,
      card_evidence.support_score AS supportScore,
      card_evidence.verification_status AS verificationStatus
    FROM card_evidence
    JOIN source_segments ON source_segments.id = card_evidence.segment_id
    JOIN sources ON sources.id = source_segments.source_id
    WHERE card_evidence.card_id = ?
    ORDER BY card_evidence.support_score DESC
    LIMIT 1
    `,
    cardId,
  );

  return evidence ?? undefined;
}

async function hydrateCards(cards: StudyCard[]) {
  if (!cards.length) return [];

  const db = await getDatabase();
  const placeholders = cards.map(() => '?').join(',');
  const evidenceRows = await db.getAllAsync<EvidenceSnippet & { cardId: string }>(
    `SELECT
       card_evidence.card_id AS cardId,
       sources.title AS sourceTitle,
       source_segments.locator AS locator,
       card_evidence.evidence_text AS text,
       card_evidence.support_score AS supportScore,
       card_evidence.verification_status AS verificationStatus
     FROM card_evidence
     JOIN source_segments ON source_segments.id = card_evidence.segment_id
     JOIN sources ON sources.id = source_segments.source_id
     WHERE card_evidence.card_id IN (${placeholders})
     ORDER BY card_evidence.support_score DESC`,
    cards.map((card) => card.id),
  );
  const evidenceByCard = new Map<string, EvidenceSnippet>();
  for (const row of evidenceRows) {
    if (!evidenceByCard.has(row.cardId)) evidenceByCard.set(row.cardId, row);
  }

  return cards.map((card) => ({
    ...card,
    isStarred: Boolean(card.isStarred),
    isFlagged: Boolean(card.isFlagged),
    isSuspended: Boolean(card.isSuspended),
    isLeech: Boolean(card.isLeech),
    lapseCount: Number(card.lapseCount ?? 0),
    weakScore: Number(card.weakScore ?? 0),
    qualityScore: card.qualityScore == null ? null : Number(card.qualityScore),
    evidence: evidenceByCard.get(card.id),
  }));
}
