import * as DocumentPicker from 'expo-document-picker';
import type * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import {
  describeGatewayCardQuality,
  evaluateGatewayCardQuality,
  shouldAutoPublishCandidate,
} from '@/ai/cardQuality';
import { readExpoPublicGatewayConfig } from '@/ai/config';
import { asBarionAIError } from '@/ai/errors';
import { createGatewayCardGenerationProvider } from '@/ai/gatewayProvider';
import { createSupabaseAccessTokenProvider } from '@/auth/sessionProvider';
import { generateGroundedCardsWithFallback } from '@/ai/generate';
import type { GroundedCardCandidate } from '@/ai/types';
import { createId, nowIso } from '@/domain/ids';
import {
  buildImportedCardsForRow,
  exportCardsToCsv,
  exportCardsToTsv,
  type CardImportReadyRow,
} from '@/cards/importExport';
import type {
  ActiveStudySession,
  ActiveTestSession,
  CandidateStatus,
  CourseModuleSummary,
  CourseSummary,
  CreateDeckInput,
  CreateManualCardInput,
  Dashboard,
  DailyPlan,
  DeckSummary,
  EvidenceSnippet,
  GeneratedCandidate,
  GenerationJobSummary,
  ReviewRating,
  SourceStudyGuide,
  SourceStudyGuideDiscussionQuestion,
  SourceStudyGuideQuickReference,
  SourceStudyGuideSection,
  StudyProfile,
  SourceDetail,
  SourceItem,
  SourceSegment,
  StudyCard,
  StudyEngineMode,
  StudyLearningGoal,
  StudyMode,
  TestConfidence,
  TestDirection,
  TestFormat,
  TestQuestion,
  TestScope,
  TestSessionSummary,
  TrashItem,
  ArchivedItem,
} from '@/domain/types';
import { AUTO_PUBLISH_QUALITY_SCORE, createExtractiveDrafts } from '@/ingestion/drafts';
import { readSourceAsset } from '@/ingestion/readSource';
import { segmentExtractedPages } from '@/ingestion/segmenter';
import { createStudyGuide, type GeneratedStudyGuide } from '@/ingestion/studyGuide';
import {
  SourceActionRequiredError,
  type ParsedSegment,
  type SourceAssetInput,
} from '@/ingestion/types';
import {
  applyFsrsReview,
  createInitialFsrsCard,
  replayFsrsReviews,
  schedulerVersion,
} from '@/scheduler/fsrs';
import { getDatabase } from '@/storage/database';
import { discardPersistedSource, persistImportedSource } from '@/storage/files';
import { colors } from '@/theme/colors';
import { planReason, summarizePlanCards } from '@/planning/dailyPlan';
import { decideTestEvidence } from '@/testing/evidencePolicy';

type CountRow = { count: number };
type WritableDatabase = SQLite.SQLiteDatabase;
type SourceStudyGuideRow = {
  id: string;
  sourceId: string;
  title: string;
  overview: string;
  outlineJson: string;
  quickReferenceJson: string;
  discussionJson: string;
  createdAt: string;
  updatedAt: string;
};
type ImportedCardResult = {
  createdCardCount: number;
  createdNoteCount: number;
  skippedDuplicateCount: number;
  clozeCardCount: number;
};

export async function getDashboard(): Promise<Dashboard> {
  const db = await getDatabase();
  const now = nowIso();
  const todayStart = localDayStartIso();
  const profile = await getStudyProfile();

  const decks = await db.getAllAsync<DeckSummary>(
    `
    SELECT
      decks.id,
      decks.title,
      decks.description,
      decks.color,
      decks.icon,
      decks.created_at AS createdAt,
      decks.updated_at AS updatedAt,
      COUNT(DISTINCT cards.id) AS cardCount,
      COUNT(DISTINCT CASE WHEN memory_states.due_at <= ? AND cards.status != 'needs_review' AND COALESCE(card_learning_state.is_suspended, 0) = 0 AND (card_learning_state.buried_until IS NULL OR card_learning_state.buried_until <= ?) THEN cards.id END) AS dueCount,
      COUNT(DISTINCT card_evidence.id) AS evidenceCount,
      COUNT(DISTINCT CASE WHEN cards.status = 'needs_review' THEN cards.id END) AS needsReviewCount
    FROM decks
    LEFT JOIN cards ON cards.deck_id = decks.id AND cards.deleted_at IS NULL
    LEFT JOIN memory_states ON memory_states.card_id = cards.id
    LEFT JOIN card_evidence ON card_evidence.card_id = cards.id
    LEFT JOIN card_learning_state ON card_learning_state.card_id = cards.id
    WHERE decks.deleted_at IS NULL AND decks.archived_at IS NULL
    GROUP BY decks.id
    ORDER BY decks.updated_at DESC
    `,
    now,
    now,
  );

  const totalCards = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count
     FROM cards
     JOIN decks ON decks.id = cards.deck_id
     WHERE cards.deleted_at IS NULL AND decks.deleted_at IS NULL AND decks.archived_at IS NULL`,
  );
  const dueCount = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count
     FROM memory_states
     JOIN cards ON cards.id = memory_states.card_id
     JOIN decks ON decks.id = cards.deck_id
     LEFT JOIN card_learning_state ON card_learning_state.card_id = cards.id
     WHERE memory_states.due_at <= ?
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL
       AND cards.status != 'needs_review'
       AND COALESCE(card_learning_state.is_suspended, 0) = 0
       AND (card_learning_state.buried_until IS NULL OR card_learning_state.buried_until <= ?)`,
    now,
    now,
  );
  const evidenceLinkedCards = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(DISTINCT card_evidence.card_id) AS count
     FROM card_evidence
     JOIN cards ON cards.id = card_evidence.card_id
     JOIN decks ON decks.id = cards.deck_id
     WHERE cards.deleted_at IS NULL AND decks.deleted_at IS NULL AND decks.archived_at IS NULL`,
  );
  const sourceCount = await db.getFirstAsync<CountRow>(
    'SELECT COUNT(*) AS count FROM sources WHERE deleted_at IS NULL AND archived_at IS NULL',
  );
  const weakCount = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count
     FROM card_learning_state
     JOIN cards ON cards.id = card_learning_state.card_id
     JOIN decks ON decks.id = cards.deck_id
     WHERE card_learning_state.weak_score > 0
       AND card_learning_state.is_suspended = 0
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL`,
  );
  const reviewedToday = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count
     FROM review_events
     WHERE reviewed_at >= ? AND reverted_at IS NULL AND study_mode != 'preview'`,
    todayStart,
  );
  const leechCount = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count
     FROM card_learning_state
     JOIN cards ON cards.id = card_learning_state.card_id
     JOIN decks ON decks.id = cards.deck_id
     WHERE card_learning_state.is_leech = 1
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL`,
  );
  const needsReviewCount = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count
     FROM cards
     JOIN decks ON decks.id = cards.deck_id
     WHERE cards.status = 'needs_review'
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL`,
  );

  return {
    dueCount: dueCount?.count ?? 0,
    totalCards: totalCards?.count ?? 0,
    evidenceLinkedCards: evidenceLinkedCards?.count ?? 0,
    sourceCount: sourceCount?.count ?? 0,
    weakCount: Number(weakCount?.count ?? 0),
    leechCount: Number(leechCount?.count ?? 0),
    needsReviewCount: Number(needsReviewCount?.count ?? 0),
    reviewedToday: Number(reviewedToday?.count ?? 0),
    dailyReviewLimit: profile.dailyReviewLimit,
    sessionLength: profile.sessionLength,
    decks: decks.map((deck) => ({
      ...deck,
      cardCount: Number(deck.cardCount ?? 0),
      dueCount: Number(deck.dueCount ?? 0),
      evidenceCount: Number(deck.evidenceCount ?? 0),
      needsReviewCount: Number(deck.needsReviewCount ?? 0),
    })),
  };
}

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

  if (sessionLimit <= 0) return [];

  const params: string[] = [now];
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
  const focusFilter = focus === 'weak' ? 'AND COALESCE(card_learning_state.weak_score, 0) > 0' : '';

  if (deckId) {
    params.push(deckId);
  } else if (moduleId) {
    params.push(moduleId);
  }

  const cards = await db.getAllAsync<StudyCard>(
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
      ${deckFilter}
      ${focusFilter}
    ORDER BY COALESCE(card_learning_state.weak_score, 0) DESC, memory_states.due_at ASC, cards.created_at ASC
    LIMIT 500
    `,
    [now, ...params],
  );

  let newCards = 0;
  const selected = cards.filter((card) => {
    if (card.lastReviewedAt) return true;
    if (newCards >= remainingNew) return false;
    newCards += 1;
    return true;
  }).slice(0, sessionLimit);

  return hydrateCards(selected);
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

export async function getCourses(): Promise<CourseSummary[]> {
  const db = await getDatabase();
  const courses = await db.getAllAsync<Omit<CourseSummary, 'modules'>>(
    `SELECT courses.id, courses.title, courses.exam_date AS examDate, courses.color,
            COUNT(DISTINCT course_modules.id) AS moduleCount,
            COUNT(DISTINCT decks.id) AS deckCount,
            COUNT(DISTINCT cards.id) AS cardCount
     FROM courses
     LEFT JOIN course_modules ON course_modules.course_id = courses.id
     LEFT JOIN module_decks ON module_decks.module_id = course_modules.id
     LEFT JOIN decks ON decks.id = module_decks.deck_id AND decks.deleted_at IS NULL AND decks.archived_at IS NULL
     LEFT JOIN cards ON cards.deck_id = decks.id AND cards.deleted_at IS NULL
     WHERE courses.deleted_at IS NULL AND courses.archived_at IS NULL
     GROUP BY courses.id
     ORDER BY CASE WHEN courses.id = 'course-default' THEN 0 ELSE 1 END, courses.updated_at DESC`,
  );
  const modules = await db.getAllAsync<Omit<CourseModuleSummary, 'deckIds'> & { deckIdsCsv: string | null }>(
    `SELECT course_modules.id, course_modules.course_id AS courseId, course_modules.title,
            course_modules.position,
            COUNT(DISTINCT decks.id) AS deckCount,
            COUNT(DISTINCT cards.id) AS cardCount,
            GROUP_CONCAT(DISTINCT decks.id) AS deckIdsCsv
     FROM course_modules
     LEFT JOIN module_decks ON module_decks.module_id = course_modules.id
     LEFT JOIN decks ON decks.id = module_decks.deck_id AND decks.deleted_at IS NULL AND decks.archived_at IS NULL
     LEFT JOIN cards ON cards.deck_id = decks.id AND cards.deleted_at IS NULL
     JOIN courses ON courses.id = course_modules.course_id
     WHERE courses.deleted_at IS NULL AND courses.archived_at IS NULL
     GROUP BY course_modules.id
     ORDER BY course_modules.position ASC, course_modules.created_at ASC`,
  );
  return courses.map((course) => ({
    ...course,
    moduleCount: Number(course.moduleCount),
    deckCount: Number(course.deckCount),
    cardCount: Number(course.cardCount),
    modules: modules
      .filter((module) => module.courseId === course.id)
      .map((module) => ({
        ...module,
        position: Number(module.position),
        deckCount: Number(module.deckCount),
        cardCount: Number(module.cardCount),
        deckIds: String(module.deckIdsCsv ?? '')
          .split(',')
          .filter(Boolean),
      })),
  }));
}

export async function createCourse(title: string, examDate?: string) {
  const db = await getDatabase();
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Enter a course name.');
  const parsedExamDate = examDate?.trim() || null;
  if (parsedExamDate && !/^\d{4}-\d{2}-\d{2}$/.test(parsedExamDate)) {
    throw new Error('Use YYYY-MM-DD for the exam date.');
  }
  const courseId = createId('course');
  const moduleId = createId('module');
  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      `INSERT INTO courses (id, title, exam_date, color, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      courseId,
      trimmed,
      parsedExamDate,
      colors.blue,
      now,
      now,
    );
    await txn.runAsync(
      `INSERT INTO course_modules (id, course_id, title, position, created_at, updated_at)
       VALUES (?, ?, 'General folder', 0, ?, ?)`,
      moduleId,
      courseId,
      now,
      now,
    );
  });
  return courseId;
}

export async function createCourseModule(courseId: string, title: string) {
  const db = await getDatabase();
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Enter a folder name.');
  const now = nowIso();
  const id = createId('module');
  const position = await db.getFirstAsync<{ nextPosition: number }>(
    'SELECT COALESCE(MAX(position), -1) + 1 AS nextPosition FROM course_modules WHERE course_id = ?',
    courseId,
  );
  const result = await db.runAsync(
    `INSERT INTO course_modules (id, course_id, title, position, created_at, updated_at)
     SELECT ?, id, ?, ?, ?, ?
     FROM courses
     WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
    id,
    trimmed,
    Number(position?.nextPosition ?? 0),
    now,
    now,
    courseId,
  );
  if (!result.changes) throw new Error('Choose an active class first.');
  return id;
}

export async function updateCourseExamDate(courseId: string, examDate: string) {
  const db = await getDatabase();
  const trimmed = examDate.trim();
  if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('Use YYYY-MM-DD for the exam date.');
  }
  await db.runAsync(
    'UPDATE courses SET exam_date = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    trimmed || null,
    nowIso(),
    courseId,
  );
}

export async function removeCourseModule(moduleId: string) {
  const db = await getDatabase();
  const folder = await db.getFirstAsync<{ id: string; courseId: string }>(
    `SELECT course_modules.id, course_modules.course_id AS courseId
     FROM course_modules
     JOIN courses ON courses.id = course_modules.course_id
     WHERE course_modules.id = ?
       AND courses.deleted_at IS NULL
       AND courses.archived_at IS NULL`,
    moduleId,
  );
  if (!folder) return false;

  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync('DELETE FROM module_decks WHERE module_id = ?', moduleId);
    await txn.runAsync('DELETE FROM course_modules WHERE id = ?', moduleId);
    await txn.runAsync('UPDATE courses SET updated_at = ? WHERE id = ?', now, folder.courseId);
  });
  return true;
}

export async function removeCourse(courseId: string) {
  const db = await getDatabase();
  const course = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM courses WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL',
    courseId,
  );
  if (!course) return false;

  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      'DELETE FROM module_decks WHERE module_id IN (SELECT id FROM course_modules WHERE course_id = ?)',
      courseId,
    );
    await txn.runAsync('DELETE FROM course_modules WHERE course_id = ?', courseId);
    await txn.runAsync(
      'UPDATE courses SET deleted_at = ?, archived_at = NULL, updated_at = ? WHERE id = ?',
      now,
      now,
      courseId,
    );
  });
  return true;
}

export async function setDeckInModule(moduleId: string, deckId: string, included: boolean) {
  const db = await getDatabase();
  if (included) {
    await db.runAsync(
      `INSERT OR IGNORE INTO module_decks (module_id, deck_id, created_at)
       SELECT course_modules.id, decks.id, ?
       FROM course_modules
       JOIN courses ON courses.id = course_modules.course_id
       JOIN decks ON decks.id = ?
       WHERE course_modules.id = ?
         AND courses.deleted_at IS NULL
         AND courses.archived_at IS NULL
         AND decks.deleted_at IS NULL
         AND decks.archived_at IS NULL`,
      nowIso(),
      deckId,
      moduleId,
    );
  } else {
    await db.runAsync('DELETE FROM module_decks WHERE module_id = ? AND deck_id = ?', moduleId, deckId);
  }
}

export async function getDeck(deckId: string) {
  const db = await getDatabase();

  const deck = await db.getFirstAsync<DeckSummary>(
    `
    SELECT
      decks.id,
      decks.title,
      decks.description,
      decks.color,
      decks.icon,
      decks.created_at AS createdAt,
      decks.updated_at AS updatedAt,
      COUNT(DISTINCT cards.id) AS cardCount,
      COUNT(DISTINCT CASE WHEN memory_states.due_at <= ? AND cards.status != 'needs_review' AND COALESCE(card_learning_state.is_suspended, 0) = 0 THEN cards.id END) AS dueCount,
      COUNT(DISTINCT card_evidence.id) AS evidenceCount,
      COUNT(DISTINCT CASE WHEN cards.status = 'needs_review' THEN cards.id END) AS needsReviewCount
    FROM decks
    LEFT JOIN cards ON cards.deck_id = decks.id AND cards.deleted_at IS NULL
    LEFT JOIN memory_states ON memory_states.card_id = cards.id
    LEFT JOIN card_evidence ON card_evidence.card_id = cards.id
    LEFT JOIN card_learning_state ON card_learning_state.card_id = cards.id
    WHERE decks.id = ? AND decks.deleted_at IS NULL AND decks.archived_at IS NULL
    GROUP BY decks.id
    `,
    nowIso(),
    deckId,
  );

  const cards = await db.getAllAsync<StudyCard>(
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
      COALESCE(card_learning_state.is_suspended, 0) AS isSuspended
    FROM cards
    JOIN decks ON decks.id = cards.deck_id
    JOIN memory_states ON memory_states.card_id = cards.id
    LEFT JOIN card_quality ON card_quality.card_id = cards.id
    LEFT JOIN card_learning_state ON card_learning_state.card_id = cards.id
    WHERE cards.deck_id = ? AND cards.deleted_at IS NULL
    ORDER BY cards.created_at ASC
    `,
    deckId,
  );

  return {
    deck: deck
      ? {
          ...deck,
          cardCount: Number(deck.cardCount ?? 0),
          dueCount: Number(deck.dueCount ?? 0),
          evidenceCount: Number(deck.evidenceCount ?? 0),
          needsReviewCount: Number(deck.needsReviewCount ?? 0),
        }
      : null,
    cards: await hydrateCards(cards),
  };
}

export async function getSources(): Promise<SourceItem[]> {
  const db = await getDatabase();

  const sources = await db.getAllAsync<SourceItem>(
    `
    SELECT
      sources.id,
      sources.title,
      sources.filename,
      sources.mime_type AS mimeType,
      sources.sha256,
      sources.local_uri AS localUri,
      sources.size_bytes AS sizeBytes,
      sources.status,
      sources.default_deck_id AS defaultDeckId,
      decks.title AS defaultDeckTitle,
      sources.ingestion_error AS ingestionError,
      sources.processed_at AS processedAt,
      sources.created_at AS createdAt,
      COUNT(source_segments.id) AS segmentCount,
      (
        SELECT COUNT(*)
        FROM generated_candidates
        JOIN generation_jobs ON generation_jobs.id = generated_candidates.job_id
        WHERE generation_jobs.source_id = sources.id
          AND generated_candidates.status = 'pending'
      ) AS draftCount
      ,(
        SELECT COUNT(*)
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id = sources.id
          AND cards.deleted_at IS NULL
      ) AS sourceCardCount
      ,(
        SELECT COUNT(*)
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id = sources.id
          AND cards.status = 'source_extracted'
          AND cards.deleted_at IS NULL
      ) AS autoGeneratedCardCount
      ,(
        SELECT COUNT(DISTINCT cards.id)
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        JOIN review_events ON review_events.card_id = cards.id
        WHERE notes.source_id = sources.id
          AND cards.status = 'source_extracted'
          AND cards.deleted_at IS NULL
          AND review_events.reverted_at IS NULL
      ) AS autoGeneratedReviewedCardCount
      ,(
        SELECT COUNT(*)
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id = sources.id
          AND cards.status = 'needs_review'
          AND cards.deleted_at IS NULL
      ) AS needsReviewCardCount
      ,(
        SELECT COUNT(*)
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id = sources.id
          AND cards.status = 'verified'
          AND cards.deleted_at IS NULL
      ) AS verifiedCardCount
      ,(
        SELECT COUNT(DISTINCT cards.id)
        FROM cards
        JOIN review_events ON review_events.card_id = cards.id
        WHERE cards.deck_id = sources.default_deck_id
          AND cards.deleted_at IS NULL
          AND review_events.reverted_at IS NULL
      ) AS reviewedCardCount
    FROM sources
    LEFT JOIN source_segments ON source_segments.source_id = sources.id
    LEFT JOIN decks ON decks.id = sources.default_deck_id
    WHERE sources.deleted_at IS NULL AND sources.archived_at IS NULL
    GROUP BY sources.id
    ORDER BY sources.created_at DESC
    `,
  );

  return sources.map(hydrateSource);
}

export async function getSourceDetail(sourceId: string): Promise<SourceDetail | null> {
  const db = await getDatabase();
  const source = await db.getFirstAsync<SourceItem>(
    `
    SELECT
      sources.id,
      sources.title,
      sources.filename,
      sources.mime_type AS mimeType,
      sources.sha256,
      sources.local_uri AS localUri,
      sources.size_bytes AS sizeBytes,
      sources.status,
      sources.default_deck_id AS defaultDeckId,
      decks.title AS defaultDeckTitle,
      sources.ingestion_error AS ingestionError,
      sources.processed_at AS processedAt,
      sources.created_at AS createdAt,
      COUNT(source_segments.id) AS segmentCount,
      (
        SELECT COUNT(*)
        FROM generated_candidates
        JOIN generation_jobs ON generation_jobs.id = generated_candidates.job_id
        WHERE generation_jobs.source_id = sources.id
          AND generated_candidates.status = 'pending'
      ) AS draftCount
      ,(
        SELECT COUNT(*)
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id = sources.id
          AND cards.deleted_at IS NULL
      ) AS sourceCardCount
      ,(
        SELECT COUNT(*)
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id = sources.id
          AND cards.status = 'source_extracted'
          AND cards.deleted_at IS NULL
      ) AS autoGeneratedCardCount
      ,(
        SELECT COUNT(DISTINCT cards.id)
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        JOIN review_events ON review_events.card_id = cards.id
        WHERE notes.source_id = sources.id
          AND cards.status = 'source_extracted'
          AND cards.deleted_at IS NULL
          AND review_events.reverted_at IS NULL
      ) AS autoGeneratedReviewedCardCount
      ,(
        SELECT COUNT(*)
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id = sources.id
          AND cards.status = 'needs_review'
          AND cards.deleted_at IS NULL
      ) AS needsReviewCardCount
      ,(
        SELECT COUNT(*)
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id = sources.id
          AND cards.status = 'verified'
          AND cards.deleted_at IS NULL
      ) AS verifiedCardCount
      ,(
        SELECT COUNT(DISTINCT cards.id)
        FROM cards
        JOIN review_events ON review_events.card_id = cards.id
        WHERE cards.deck_id = sources.default_deck_id
          AND cards.deleted_at IS NULL
          AND review_events.reverted_at IS NULL
      ) AS reviewedCardCount
    FROM sources
    LEFT JOIN source_segments ON source_segments.source_id = sources.id
    LEFT JOIN decks ON decks.id = sources.default_deck_id
    WHERE sources.id = ? AND sources.deleted_at IS NULL AND sources.archived_at IS NULL
    GROUP BY sources.id
    `,
    sourceId,
  );

  if (!source) {
    return null;
  }

  const segments = await db.getAllAsync<SourceSegment>(
    `
    SELECT
      id,
      source_id AS sourceId,
      locator,
      section_path AS sectionPath,
      text,
      created_at AS createdAt
    FROM source_segments
    WHERE source_id = ?
    ORDER BY created_at ASC
    `,
    sourceId,
  );

  const generationJob = await db.getFirstAsync<GenerationJobSummary>(
    `
    SELECT
      id,
      status,
      summary,
      provider_id AS providerId,
      model_id AS modelId,
      prompt_id AS promptId,
      prompt_version AS promptVersion,
      request_id AS requestId,
      provider_request_id AS providerRequestId,
      input_tokens AS inputTokens,
      output_tokens AS outputTokens,
      fallback_reason AS fallbackReason,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM generation_jobs
    WHERE source_id = ?
    ORDER BY created_at DESC
    LIMIT 1
    `,
    sourceId,
  );

  const candidates = await db.getAllAsync<GeneratedCandidate>(
    `
    SELECT
      generated_candidates.id,
      generated_candidates.job_id AS jobId,
      generated_candidates.segment_id AS segmentId,
      generated_candidates.card_type AS cardType,
      generated_candidates.learning_objective AS learningObjective,
      generated_candidates.quality_score AS qualityScore,
      generated_candidates.quality_notes AS qualityNotes,
      generated_candidates.question,
      generated_candidates.answer,
      generated_candidates.evidence_text AS evidenceText,
      generated_candidates.locator,
      generated_candidates.evidence_span_json AS evidenceSpanJson,
      generated_candidates.evaluation_json AS evaluationJson,
      generated_candidates.original_candidate_json AS originalCandidateJson,
      generated_candidates.publication_disposition AS publicationDisposition,
      generated_candidates.evaluation_version AS evaluationVersion,
      generated_candidates.policy_version AS policyVersion,
      generated_candidates.sanitization_reason AS sanitizationReason,
      generated_candidates.verification_status AS verificationStatus,
      generated_candidates.support_score AS supportScore,
      generated_candidates.status,
      generated_candidates.created_at AS createdAt
    FROM generated_candidates
    JOIN generation_jobs ON generation_jobs.id = generated_candidates.job_id
    WHERE generation_jobs.source_id = ?
    ORDER BY
      CASE generated_candidates.status
        WHEN 'pending' THEN 0
        WHEN 'approved' THEN 1
        ELSE 2
      END,
      generated_candidates.created_at ASC
    `,
    sourceId,
  );

  const guideRow = await db.getFirstAsync<SourceStudyGuideRow>(
    `
    SELECT
      id,
      source_id AS sourceId,
      title,
      overview,
      outline_json AS outlineJson,
      quick_reference_json AS quickReferenceJson,
      discussion_json AS discussionJson,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM source_study_guides
    WHERE source_id = ?
    LIMIT 1
    `,
    sourceId,
  );
  const studyGuide = guideRow
    ? hydrateStudyGuide(guideRow)
    : segments.length
      ? fallbackStudyGuide(sourceId, source.title, segments)
      : undefined;

  return {
    ...hydrateSource(source),
    segments,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      qualityScore: Number(candidate.qualityScore ?? 0),
      supportScore: Number(candidate.supportScore ?? 0),
    })),
    generationJob: generationJob ?? undefined,
    studyGuide,
  };
}

type TrashMetadata = {
  sourceId?: string;
  deckId?: string;
  cardIds?: string[];
  noteIds?: string[];
};

export async function getTrashItems(): Promise<TrashItem[]> {
  const db = await getDatabase();
  const items = await db.getAllAsync<TrashItem>(
    `SELECT
       id,
       entity_type AS entityType,
       entity_id AS entityId,
       title,
       item_count AS itemCount,
       reviewed_card_count AS reviewedCardCount,
       deleted_at AS deletedAt
     FROM library_trash
     WHERE restored_at IS NULL
     ORDER BY deleted_at DESC`,
  );

  return items.map((item) => ({
    ...item,
    itemCount: Number(item.itemCount ?? 0),
    reviewedCardCount: Number(item.reviewedCardCount ?? 0),
  }));
}

export async function getArchivedItems(): Promise<ArchivedItem[]> {
  const db = await getDatabase();
  const items = await db.getAllAsync<ArchivedItem>(
    `SELECT
       'source' AS entityType,
       sources.id AS entityId,
       sources.title,
       (
         SELECT COUNT(*) FROM cards
         JOIN notes ON notes.id = cards.note_id
         WHERE notes.source_id = sources.id AND cards.deleted_at IS NULL
       ) AS itemCount,
       sources.archived_at AS archivedAt
     FROM sources
     WHERE sources.archived_at IS NOT NULL AND sources.deleted_at IS NULL
     UNION ALL
     SELECT
       'deck' AS entityType,
       decks.id AS entityId,
       decks.title,
       (SELECT COUNT(*) FROM cards WHERE cards.deck_id = decks.id AND cards.deleted_at IS NULL) AS itemCount,
       decks.archived_at AS archivedAt
     FROM decks
     WHERE decks.archived_at IS NOT NULL
       AND decks.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM sources WHERE sources.default_deck_id = decks.id)
     ORDER BY archivedAt DESC`,
  );

  return items.map((item) => ({ ...item, itemCount: Number(item.itemCount ?? 0) }));
}

export async function getDeckDeletionImpact(deckId: string) {
  const db = await getDatabase();
  const result = await db.getFirstAsync<{ cardCount: number; reviewedCardCount: number }>(
    `SELECT
       COUNT(DISTINCT cards.id) AS cardCount,
       COUNT(DISTINCT CASE WHEN review_events.id IS NOT NULL AND review_events.reverted_at IS NULL THEN cards.id END) AS reviewedCardCount
     FROM decks
     LEFT JOIN cards ON cards.deck_id = decks.id AND cards.deleted_at IS NULL
     LEFT JOIN review_events ON review_events.card_id = cards.id
     WHERE decks.id = ? AND decks.deleted_at IS NULL`,
    deckId,
  );
  return {
    cardCount: Number(result?.cardCount ?? 0),
    reviewedCardCount: Number(result?.reviewedCardCount ?? 0),
  };
}

export async function getCardDeletionImpact(cardIds: string[]) {
  const db = await getDatabase();
  const uniqueIds = [...new Set(cardIds)];
  return {
    cardCount: uniqueIds.length,
    reviewedCardCount: await countReviewedCards(db, uniqueIds),
  };
}

export async function archiveSource(sourceId: string) {
  const db = await getDatabase();
  const source = await db.getFirstAsync<{ deckId: string | null }>(
    `SELECT default_deck_id AS deckId
     FROM sources
     WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
    sourceId,
  );
  if (!source) return false;

  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync('UPDATE sources SET archived_at = ? WHERE id = ?', now, sourceId);
    if (source.deckId) {
      await txn.runAsync('UPDATE decks SET archived_at = ? WHERE id = ? AND deleted_at IS NULL', now, source.deckId);
    }
  });
  return true;
}

export async function archiveDeck(deckId: string) {
  const db = await getDatabase();
  const owner = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM sources WHERE default_deck_id = ? AND deleted_at IS NULL',
    deckId,
  );
  if (owner) return archiveSource(owner.id);

  const result = await db.runAsync(
    'UPDATE decks SET archived_at = ? WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL',
    nowIso(),
    deckId,
  );
  return Boolean(result.changes);
}

export async function restoreArchivedItem(entityType: ArchivedItem['entityType'], entityId: string) {
  const db = await getDatabase();
  if (entityType === 'source') {
    const source = await db.getFirstAsync<{ deckId: string | null }>(
      'SELECT default_deck_id AS deckId FROM sources WHERE id = ? AND deleted_at IS NULL',
      entityId,
    );
    if (!source) return false;
    await runWriteTransaction(db, async (txn) => {
      await txn.runAsync('UPDATE sources SET archived_at = NULL WHERE id = ?', entityId);
      if (source.deckId) await txn.runAsync('UPDATE decks SET archived_at = NULL WHERE id = ?', source.deckId);
    });
    return true;
  }

  const result = await db.runAsync(
    'UPDATE decks SET archived_at = NULL WHERE id = ? AND deleted_at IS NULL',
    entityId,
  );
  return Boolean(result.changes);
}

export async function deleteSourceCardsToTrash(sourceId: string) {
  const db = await getDatabase();
  const source = await db.getFirstAsync<{ title: string }>(
    'SELECT title FROM sources WHERE id = ? AND deleted_at IS NULL',
    sourceId,
  );
  if (!source) return null;

  const rows = await db.getAllAsync<{ id: string; noteId: string | null }>(
    `SELECT cards.id, cards.note_id AS noteId
     FROM cards
     JOIN notes ON notes.id = cards.note_id
     WHERE notes.source_id = ?
       AND cards.status = 'source_extracted'
       AND cards.deleted_at IS NULL`,
    sourceId,
  );
  return moveCardsToTrash(db, rows, {
    entityType: 'source-cards',
    entityId: sourceId,
    title: `Auto-created cards from ${source.title}`,
    sourceId,
  });
}

export async function deleteSourceToTrash(sourceId: string) {
  const db = await getDatabase();
  const source = await db.getFirstAsync<{ title: string; deckId: string | null }>(
    `SELECT title, default_deck_id AS deckId
     FROM sources
     WHERE id = ? AND deleted_at IS NULL`,
    sourceId,
  );
  if (!source) return null;

  const rows = source.deckId
    ? await db.getAllAsync<{ id: string; noteId: string | null }>(
        `SELECT DISTINCT cards.id, cards.note_id AS noteId
         FROM cards
         LEFT JOIN notes ON notes.id = cards.note_id
         WHERE cards.deleted_at IS NULL
           AND (cards.deck_id = ? OR notes.source_id = ?)`,
        source.deckId,
        sourceId,
      )
    : await db.getAllAsync<{ id: string; noteId: string | null }>(
        `SELECT cards.id, cards.note_id AS noteId
         FROM cards JOIN notes ON notes.id = cards.note_id
         WHERE notes.source_id = ? AND cards.deleted_at IS NULL`,
        sourceId,
      );
  const cardIds = rows.map((row) => row.id);
  const noteIds = rows.flatMap((row) => (row.noteId ? [row.noteId] : []));
  const reviewedCardCount = await countReviewedCards(db, cardIds);
  const deletedAt = nowIso();
  const trashId = createId('trash');
  const metadata: TrashMetadata = { sourceId, deckId: source.deckId ?? undefined, cardIds, noteIds };

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync('UPDATE sources SET deleted_at = ?, archived_at = NULL WHERE id = ?', deletedAt, sourceId);
    if (source.deckId) {
      await txn.runAsync(
        'UPDATE decks SET deleted_at = ?, archived_at = NULL WHERE id = ?',
        deletedAt,
        source.deckId,
      );
    }
    await softDeleteRows(txn, cardIds, noteIds, deletedAt);
    await insertTrashItem(txn, trashId, 'source', sourceId, source.title, cardIds.length, reviewedCardCount, deletedAt, metadata);
  });
  return trashId;
}

export async function deleteDeckToTrash(deckId: string) {
  const db = await getDatabase();
  const owner = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM sources WHERE default_deck_id = ? AND deleted_at IS NULL',
    deckId,
  );
  if (owner) return deleteSourceToTrash(owner.id);

  const deck = await db.getFirstAsync<{ title: string }>(
    'SELECT title FROM decks WHERE id = ? AND deleted_at IS NULL',
    deckId,
  );
  if (!deck) return null;
  const rows = await db.getAllAsync<{ id: string; noteId: string | null }>(
    'SELECT id, note_id AS noteId FROM cards WHERE deck_id = ? AND deleted_at IS NULL',
    deckId,
  );
  const cardIds = rows.map((row) => row.id);
  const noteIds = rows.flatMap((row) => (row.noteId ? [row.noteId] : []));
  const reviewedCardCount = await countReviewedCards(db, cardIds);
  const deletedAt = nowIso();
  const trashId = createId('trash');

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync('UPDATE decks SET deleted_at = ?, archived_at = NULL WHERE id = ?', deletedAt, deckId);
    await softDeleteRows(txn, cardIds, noteIds, deletedAt);
    await insertTrashItem(
      txn,
      trashId,
      'deck',
      deckId,
      deck.title,
      cardIds.length,
      reviewedCardCount,
      deletedAt,
      { deckId, cardIds, noteIds },
    );
  });
  return trashId;
}

export async function deleteCardsToTrash(cardIds: string[]) {
  const db = await getDatabase();
  const uniqueIds = [...new Set(cardIds)];
  if (!uniqueIds.length) return null;
  const rows: { id: string; noteId: string | null; prompt: string }[] = [];
  for (const cardId of uniqueIds) {
    const row = await db.getFirstAsync<{ id: string; noteId: string | null; prompt: string }>(
      'SELECT id, note_id AS noteId, prompt FROM cards WHERE id = ? AND deleted_at IS NULL',
      cardId,
    );
    if (row) rows.push(row);
  }
  if (!rows.length) return null;
  const activeCardIds = rows.map((row) => row.id);
  const noteIds = rows.flatMap((row) => (row.noteId ? [row.noteId] : []));
  const reviewedCardCount = await countReviewedCards(db, activeCardIds);
  const deletedAt = nowIso();
  const trashId = createId('trash');
  const entityType = rows.length === 1 ? 'card' : 'cards';
  const title = rows.length === 1 ? rows[0].prompt : `${rows.length} selected cards`;

  await runWriteTransaction(db, async (txn) => {
    await softDeleteRows(txn, activeCardIds, noteIds, deletedAt);
    await insertTrashItem(
      txn,
      trashId,
      entityType,
      rows[0].id,
      title,
      rows.length,
      reviewedCardCount,
      deletedAt,
      { cardIds: activeCardIds, noteIds },
    );
  });
  return trashId;
}

export async function restoreTrashItem(trashId: string) {
  const db = await getDatabase();
  const item = await db.getFirstAsync<{ deletedAt: string; metadataJson: string }>(
    `SELECT deleted_at AS deletedAt, metadata_json AS metadataJson
     FROM library_trash WHERE id = ? AND restored_at IS NULL`,
    trashId,
  );
  if (!item) return false;
  const metadata = JSON.parse(item.metadataJson) as TrashMetadata;

  await runWriteTransaction(db, async (txn) => {
    if (metadata.sourceId) {
      await txn.runAsync(
        'UPDATE sources SET deleted_at = NULL WHERE id = ? AND deleted_at = ?',
        metadata.sourceId,
        item.deletedAt,
      );
    }
    if (metadata.deckId) {
      await txn.runAsync(
        'UPDATE decks SET deleted_at = NULL WHERE id = ? AND deleted_at = ?',
        metadata.deckId,
        item.deletedAt,
      );
    }
    for (const noteId of metadata.noteIds ?? []) {
      await txn.runAsync(
        'UPDATE notes SET deleted_at = NULL WHERE id = ? AND deleted_at = ?',
        noteId,
        item.deletedAt,
      );
    }
    for (const cardId of metadata.cardIds ?? []) {
      await txn.runAsync(
        'UPDATE cards SET deleted_at = NULL WHERE id = ? AND deleted_at = ?',
        cardId,
        item.deletedAt,
      );
      await upsertSearchIndex(txn, cardId);
    }
    await txn.runAsync('UPDATE library_trash SET restored_at = ? WHERE id = ?', nowIso(), trashId);
  });
  return true;
}

export async function importSourceFromPicker() {
  const picked = await DocumentPicker.getDocumentAsync({
    base64: false,
    copyToCacheDirectory: true,
    multiple: false,
    type: [
      'application/pdf',
      'text/plain',
      'text/markdown',
    ],
  });

  if (picked.canceled || !picked.assets[0]) {
    return null;
  }

  const asset = picked.assets[0];
  if (asset.size && asset.size > 30 * 1024 * 1024) {
    throw new Error('This file is larger than 30 MB. Split it into a focused chapter and try again.');
  }
  const now = nowIso();
  const db = await getDatabase();
  const sourceId = createId('src');
  const deckId = createId('deck');
  const sourceTitle = asset.name.replace(/\.[^/.]+$/, '').trim() || 'Imported study set';
  const sourceAsset: SourceAssetInput = {
    name: asset.name,
    uri: asset.uri,
    mimeType: asset.mimeType,
    size: asset.size,
    file: asset.file,
  };
  const stored = await persistImportedSource(sourceId, sourceAsset);

  const existing = await db.getFirstAsync<{ id: string; localUri: string; status: string }>(
    `SELECT id, local_uri AS localUri, status
     FROM sources
     WHERE sha256 = ? AND deleted_at IS NULL AND archived_at IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    stored.sha256,
  );
  if (existing) {
    if (existing.status === 'action-required' || existing.status === 'failed') {
      await db.runAsync(
        `UPDATE sources
         SET local_uri = ?, mime_type = ?, size_bytes = ?, ingestion_error = NULL
         WHERE id = ?`,
        stored.localUri,
        asset.mimeType ?? 'application/octet-stream',
        stored.sizeBytes,
        existing.id,
      );
      await processSource(existing.id, { ...sourceAsset, uri: stored.localUri });
    } else {
      discardPersistedSource(stored.localUri);
    }
    return { sourceId: existing.id, duplicate: true };
  }

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      `INSERT INTO decks (id, title, description, color, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      deckId,
      sourceTitle,
      `Automatically created from ${asset.name}.`,
      colors.blue,
      'document-text-outline',
      now,
      now,
    );
    await txn.runAsync(
      `INSERT INTO sources
       (id, title, filename, mime_type, sha256, local_uri, size_bytes, status, default_deck_id, ingestion_error, processed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sourceId,
      sourceTitle,
      asset.name,
      asset.mimeType ?? 'application/octet-stream',
      stored.sha256,
      stored.localUri,
      stored.sizeBytes,
      'importing',
      deckId,
      null,
      null,
      now,
    );

    await txn.runAsync(
      `INSERT INTO sync_operations
       (id, entity_type, entity_id, operation, payload_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      createId('sync'),
      'source',
      sourceId,
      'create',
      JSON.stringify({ sourceId, filename: asset.name }),
      'local-only',
      now,
    );
  });

  await processSource(sourceId, {
    ...sourceAsset,
    uri: stored.localUri,
  });

  return { sourceId, duplicate: false };
}

export async function retrySourceProcessing(sourceId: string) {
  const db = await getDatabase();
  const source = await db.getFirstAsync<{
    filename: string;
    mimeType: string;
    localUri: string;
    sizeBytes: number | null;
  }>(
    `SELECT filename, mime_type AS mimeType, local_uri AS localUri, size_bytes AS sizeBytes
     FROM sources
     WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
    sourceId,
  );

  if (!source) {
    throw new Error('Source not found.');
  }

  return processSource(sourceId, {
    name: source.filename,
    mimeType: source.mimeType,
    uri: source.localUri,
    size: source.sizeBytes,
  });
}

export async function refreshStudyGuideForSource(sourceId: string) {
  const db = await getDatabase();
  const source = await db.getFirstAsync<{ id: string; title: string }>(
    `SELECT id, title
     FROM sources
     WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
    sourceId,
  );
  if (!source) {
    throw new Error('Source not found.');
  }

  const segments = await db.getAllAsync<ParsedSegment>(
    `SELECT
       id,
       locator,
       section_path AS sectionPath,
       text,
       COALESCE(start_offset, 0) AS startOffset,
       COALESCE(end_offset, length(text)) AS endOffset
     FROM source_segments
     WHERE source_id = ?
     ORDER BY created_at ASC`,
    sourceId,
  );
  if (!segments.length) {
    throw new Error('Extract this source before creating a study guide.');
  }

  const now = nowIso();
  const guide = createStudyGuide(segments, source.title);
  await runWriteTransaction(db, async (txn) => {
    await upsertSourceStudyGuide(txn, sourceId, guide, now);
  });
  return guide;
}

export async function generateDraftsForSource(sourceId: string) {
  const db = await getDatabase();
  const source = await db.getFirstAsync<{ title: string; sha256: string; defaultDeckId: string | null; sourceCardCount: number }>(
    `SELECT sources.title, sources.sha256, sources.default_deck_id AS defaultDeckId,
            (SELECT COUNT(*) FROM cards JOIN notes ON notes.id = cards.note_id
             WHERE notes.source_id = sources.id AND cards.deleted_at IS NULL) AS sourceCardCount
     FROM sources WHERE sources.id = ? AND sources.deleted_at IS NULL AND sources.archived_at IS NULL`,
    sourceId,
  );
  if (!source || !source.defaultDeckId) {
    throw new Error('Source not found.');
  }
  if (source.sha256 === 'built-in-curated-demo-v1') {
    return Number(source.sourceCardCount ?? 0);
  }

  const rows = await db.getAllAsync<ParsedSegment>(
    `SELECT
       id,
       locator,
       section_path AS sectionPath,
       text,
       COALESCE(start_offset, 0) AS startOffset,
       COALESCE(end_offset, length(text)) AS endOffset
     FROM source_segments
     WHERE source_id = ?
     ORDER BY created_at ASC`,
    sourceId,
  );

  if (!rows.length) {
    throw new Error('Extract this source before creating drafts.');
  }

  const profile = await getStudyProfile();
  const studyGuide = createStudyGuide(rows, source.title);
  const requestId = createId('generation-request');
  let gatewayConfigError: string | undefined;
  let provider = null;
  try {
    const config = readExpoPublicGatewayConfig();
    provider = config
      ? createGatewayCardGenerationProvider(config, fetch, createSupabaseAccessTokenProvider())
      : null;
  } catch (error) {
    gatewayConfigError = asBarionAIError(error).code;
  }

  const generation = await generateGroundedCardsWithFallback(
    provider,
    {
      requestId,
      sourceId,
      sourceTitle: source.title,
      maxCandidates: 56,
      segments: rows.map((row) => ({
        segmentId: row.id,
        locator: row.locator,
        sectionPath: row.sectionPath,
        text: row.text,
      })),
    },
    () => createExtractiveDrafts(rows, {
      reviewStyle: profile.reviewStyle,
      difficulty: profile.difficulty,
      examGoal: profile.examGoal,
    }),
    undefined,
    gatewayConfigError,
  );
  const drafts = generation.candidates;
  const localGeneration = generation.provenance.providerId === 'local-extractive';
  const now = nowIso();
  const jobId = createId('job');
  const candidateIds: string[] = [];

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync("UPDATE sources SET status = 'generating', ingestion_error = NULL WHERE id = ?", sourceId);
    await txn.runAsync('DELETE FROM generation_jobs WHERE source_id = ?', sourceId);
    await upsertSourceStudyGuide(txn, sourceId, studyGuide, now);
    await txn.runAsync(
      `INSERT INTO generation_jobs
       (id, source_id, deck_id, status, summary, provider_id, model_id, prompt_id, prompt_version,
        request_id, provider_request_id, input_tokens, output_tokens, fallback_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      jobId,
      sourceId,
      source.defaultDeckId,
      drafts.length ? 'publishing' : 'completed',
      drafts.length
        ? `Checking ${drafts.length} source-grounded drafts against Barion's quality gate.`
        : 'The source was extracted, but it did not contain enough readable prose for study cards.',
      generation.provenance.providerId,
      generation.provenance.modelId,
      generation.provenance.promptId,
      generation.provenance.promptVersion,
      generation.provenance.requestId,
      generation.provenance.providerRequestId ?? null,
      generation.provenance.usage?.inputTokens ?? null,
      generation.provenance.usage?.outputTokens ?? null,
      generation.provenance.fallbackReason ?? null,
      now,
      now,
    );

    for (const draft of drafts) {
      const candidateId = createId('candidate');
      const qualityScore = localGeneration ? draftQuality(draft) : evaluateGatewayCardQuality(draft);
      const qualityNotes = localGeneration
        ? draftQualityNotes(draft)
        : describeGatewayCardQuality(draft, qualityScore);
      if (draft.evaluation?.publicationDisposition === 'PUBLISH'
          && shouldAutoPublishCandidate(qualityScore, localGeneration, AUTO_PUBLISH_QUALITY_SCORE)) {
        candidateIds.push(candidateId);
      }
      await txn.runAsync(
        `INSERT INTO generated_candidates
         (id, job_id, segment_id, card_type, learning_objective, quality_score, quality_notes, question, answer, evidence_text, locator, evidence_span_json, evaluation_json, original_candidate_json, publication_disposition, evaluation_version, policy_version, verification_status, support_score, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        candidateId,
        jobId,
        draft.segmentId,
        draft.cardType,
        draft.learningObjective,
        qualityScore,
        qualityNotes,
        draft.question,
        draft.answer,
        draft.evidenceText,
        draft.locator,
        draft.evidenceSpan ? JSON.stringify(draft.evidenceSpan) : null,
        draft.evaluation ? JSON.stringify(draft.evaluation) : null,
        JSON.stringify({ question: draft.question, answer: draft.answer, evidenceText: draft.evidenceText }),
        draft.evaluation?.publicationDisposition ?? 'REVIEW',
        draft.evaluation?.evaluationVersion ?? 'legacy',
        draft.evaluation?.policyVersion ?? 'legacy',
        draft.evidenceSpan && ['exact', 'normalized', 'context-disambiguated'].includes(draft.evidenceSpan.status)
          ? localGeneration ? 'extractive-source-match' : 'gateway-evidence-span-verified'
          : 'needs-source-review',
        1,
        'pending',
        now,
      );
    }

    await txn.runAsync(
      `UPDATE sources SET status = ?, ingestion_error = NULL WHERE id = ?`,
      drafts.length ? 'generating' : 'ready',
      sourceId,
    );
  });

  for (const candidateId of candidateIds) {
    await approveCandidate(candidateId, source.defaultDeckId, true);
  }
  await resolveRegeneratedCardTrash(db, sourceId);

  if (drafts.length) {
    const attentionCount = drafts.length - candidateIds.length;
    await runWriteTransaction(db, async (txn) => {
      await txn.runAsync(
        `UPDATE generation_jobs SET status = ?, summary = ?, updated_at = ? WHERE id = ?`,
        attentionCount ? 'awaiting-review' : 'completed',
        attentionCount
          ? `${candidateIds.length} strong drafts published automatically; ${attentionCount} held for source review.`
          : `${candidateIds.length} strong source-grounded cards published automatically.`,
        nowIso(),
        jobId,
      );
      await txn.runAsync(
        `UPDATE sources SET status = ?, ingestion_error = NULL WHERE id = ?`,
        attentionCount ? 'review-ready' : 'ready',
        sourceId,
      );
    });
  }

  return drafts.length;
}

function draftQuality(draft: GroundedCardCandidate) {
  return 'qualityScore' in draft && typeof draft.qualityScore === 'number'
    ? draft.qualityScore
    : evaluateGatewayCardQuality(draft);
}

function draftQualityNotes(draft: GroundedCardCandidate) {
  if ('qualityNotes' in draft && typeof draft.qualityNotes === 'string') {
    return draft.qualityNotes;
  }
  const score = evaluateGatewayCardQuality(draft);
  return describeGatewayCardQuality(draft, score);
}

export async function approveCandidate(candidateId: string, deckId?: string, automated = false) {
  const db = await getDatabase();
  const candidate = await db.getFirstAsync<{
    id: string;
    jobId: string;
    segmentId: string | null;
    cardType: string;
    learningObjective: string;
    qualityScore: number;
    qualityNotes: string;
    sourceId: string;
    jobDeckId: string | null;
    defaultDeckId: string | null;
    question: string;
    answer: string;
    evidenceText: string;
    verificationStatus: string;
    publicationDisposition: string;
    supportScore: number;
    status: CandidateStatus;
  }>(
    `SELECT
       generated_candidates.id,
       generated_candidates.job_id AS jobId,
       generated_candidates.segment_id AS segmentId,
       generated_candidates.card_type AS cardType,
       generated_candidates.learning_objective AS learningObjective,
       generated_candidates.quality_score AS qualityScore,
       generated_candidates.quality_notes AS qualityNotes,
       generation_jobs.source_id AS sourceId,
       generation_jobs.deck_id AS jobDeckId,
       sources.default_deck_id AS defaultDeckId,
       generated_candidates.question,
       generated_candidates.answer,
       generated_candidates.evidence_text AS evidenceText,
       generated_candidates.verification_status AS verificationStatus,
       generated_candidates.publication_disposition AS publicationDisposition,
       generated_candidates.support_score AS supportScore,
       generated_candidates.status
     FROM generated_candidates
     JOIN generation_jobs ON generation_jobs.id = generated_candidates.job_id
     JOIN sources ON sources.id = generation_jobs.source_id
     WHERE generated_candidates.id = ?`,
    candidateId,
  );

  if (!candidate || candidate.status !== 'pending') {
    throw new Error('This draft is no longer available for approval.');
  }
  if (automated && candidate.publicationDisposition !== 'PUBLISH') {
    throw new Error('Only PUBLISH candidates may enter study automatically.');
  }
  if (candidate.publicationDisposition === 'REJECT') {
    throw new Error('Rejected candidates cannot enter a study deck.');
  }
  if (!candidate.segmentId || !candidate.sourceId) {
    throw new Error('This draft has no source segment and cannot become a study card.');
  }

  const targetDeckId = deckId || candidate.jobDeckId || candidate.defaultDeckId;
  if (!targetDeckId) {
    throw new Error('This source does not have a study set yet.');
  }

  const now = nowIso();
  const noteId = createId('note');
  const cardId = createId('card');
  let resolvedCardId = cardId;
  const fsrsCardJson = createInitialFsrsCard(new Date(now));
  const approvedCardStatus =
    candidate.verificationStatus === 'extractive-source-match'
      ? automated ? 'source_extracted' : 'verified'
      : 'needs_review';
  const approvedEvidenceStatus =
    candidate.verificationStatus === 'extractive-source-match'
      ? automated ? 'auto-published-extractive' : 'user-approved-extractive'
      : 'user-approved-edited';

  await runWriteTransaction(db, async (txn) => {
    const existingCard = await txn.getFirstAsync<{ id: string; noteId: string; deletedAt: string | null }>(
      `SELECT cards.id, cards.note_id AS noteId, cards.deleted_at AS deletedAt
       FROM cards
       JOIN notes ON notes.id = cards.note_id
       WHERE notes.source_id = ?
         AND trim(cards.prompt) = trim(?)
         AND trim(cards.answer) = trim(?)
       ORDER BY CASE WHEN cards.deleted_at IS NULL THEN 0 ELSE 1 END, cards.created_at ASC
       LIMIT 1`,
      candidate.sourceId,
      candidate.question,
      candidate.answer,
    );

    if (existingCard) {
      resolvedCardId = existingCard.id;
      if (existingCard.deletedAt) {
        await txn.runAsync(
          `UPDATE notes
           SET deck_id = ?, title = ?, body = ?, deleted_at = NULL, updated_at = ?
           WHERE id = ?`,
          targetDeckId,
          candidate.question,
          candidate.answer,
          now,
          existingCard.noteId,
        );
        await txn.runAsync(
          `UPDATE cards
           SET deck_id = ?, card_type = ?, status = ?, deleted_at = NULL, updated_at = ?
           WHERE id = ?`,
          targetDeckId,
          candidate.cardType || 'source-review',
          approvedCardStatus,
          now,
          existingCard.id,
        );
        await upsertSearchIndex(txn, existingCard.id);
      }
      await upsertCardQuality(txn, resolvedCardId, candidate, now);
      await txn.runAsync("UPDATE generated_candidates SET status = 'approved' WHERE id = ?", candidateId);
      await finalizeCandidateReview(txn, candidate.jobId, candidate.sourceId, now);
      return;
    }

    const replaceableCard = await txn.getFirstAsync<{ id: string; noteId: string; evidenceId: string | null }>(
      `SELECT
         cards.id,
         cards.note_id AS noteId,
         card_evidence.id AS evidenceId
       FROM cards
       JOIN notes ON notes.id = cards.note_id
       JOIN card_evidence ON card_evidence.card_id = cards.id
       WHERE notes.source_id = ?
         AND card_evidence.segment_id = ?
         AND cards.status = 'source_extracted'
         AND cards.deleted_at IS NULL
         AND (
           cards.card_type = 'source-review'
           OR cards.prompt LIKE 'What is a key takeaway%'
           OR cards.prompt LIKE 'What should you remember from%'
         )
         AND NOT EXISTS (
           SELECT 1
           FROM review_events
           WHERE review_events.card_id = cards.id
             AND review_events.reverted_at IS NULL
         )
       ORDER BY cards.created_at ASC
       LIMIT 1`,
      candidate.sourceId,
      candidate.segmentId,
    );

    if (replaceableCard) {
      resolvedCardId = replaceableCard.id;
      await txn.runAsync(
        `UPDATE notes
         SET deck_id = ?,
             title = ?,
             body = ?,
             source_id = ?,
             updated_at = ?
         WHERE id = ?`,
        targetDeckId,
        candidate.question,
        candidate.answer,
        candidate.sourceId,
        now,
        replaceableCard.noteId,
      );
      await txn.runAsync(
        `UPDATE cards
         SET deck_id = ?,
             card_type = ?,
             prompt = ?,
             answer = ?,
             status = ?,
             updated_at = ?
         WHERE id = ?`,
        targetDeckId,
        candidate.cardType || 'source-review',
        candidate.question,
        candidate.answer,
        approvedCardStatus,
        now,
        replaceableCard.id,
      );
      await txn.runAsync(
        `UPDATE card_evidence
         SET evidence_text = ?,
             support_score = ?,
             verification_status = ?
         WHERE id = ?`,
        candidate.evidenceText,
        Number(candidate.supportScore ?? 0),
        approvedEvidenceStatus,
        replaceableCard.evidenceId,
      );
      await upsertCardQuality(txn, resolvedCardId, candidate, now);
      await txn.runAsync("UPDATE generated_candidates SET status = 'approved' WHERE id = ?", candidateId);
      await txn.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', now, targetDeckId);
      await upsertSearchIndex(txn, replaceableCard.id);
      await finalizeCandidateReview(txn, candidate.jobId, candidate.sourceId, now);
      return;
    }

    await txn.runAsync(
      `INSERT INTO notes (id, deck_id, title, body, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      noteId,
      targetDeckId,
      candidate.question,
      candidate.answer,
      candidate.sourceId,
      now,
      now,
    );
    await txn.runAsync(
      `INSERT INTO cards
       (id, deck_id, note_id, card_type, prompt, answer, status, is_starred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cardId,
      targetDeckId,
      noteId,
      candidate.cardType || 'source-review',
      candidate.question,
      candidate.answer,
      approvedCardStatus,
      0,
      now,
      now,
    );
    await txn.runAsync(
      `INSERT INTO memory_states
       (card_id, initial_fsrs_card_json, fsrs_card_json, difficulty, stability, retrievability, due_at, last_reviewed_at, scheduler_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cardId,
      fsrsCardJson,
      fsrsCardJson,
      null,
      null,
      null,
      now,
      null,
      schedulerVersion,
    );
    await txn.runAsync(
      `INSERT INTO card_evidence
       (id, card_id, segment_id, evidence_text, support_score, verification_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      createId('ev'),
      cardId,
      candidate.segmentId,
      candidate.evidenceText,
      Number(candidate.supportScore ?? 0),
      approvedEvidenceStatus,
      now,
    );
    await upsertCardQuality(txn, cardId, candidate, now);
    await txn.runAsync("UPDATE generated_candidates SET status = 'approved' WHERE id = ?", candidateId);
    await txn.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', now, targetDeckId);
    await upsertSearchIndex(txn, cardId);
    await finalizeCandidateReview(txn, candidate.jobId, candidate.sourceId, now);
  });

  return resolvedCardId;
}

export async function updateCandidateDraft(candidateId: string, question: string, answer: string) {
  const nextQuestion = question.trim();
  const nextAnswer = answer.trim();

  if (!nextQuestion || !nextAnswer) {
    throw new Error('A draft needs both a question and an answer.');
  }

  const db = await getDatabase();
  const result = await db.runAsync(
    `UPDATE generated_candidates
     SET question = ?,
         answer = ?,
         verification_status = 'user-edited',
         support_score = 0,
         quality_score = 0,
         quality_notes = 'Edited draft: review source evidence before publishing.'
     WHERE id = ? AND status = 'pending'`,
    nextQuestion,
    nextAnswer,
    candidateId,
  );

  if (!result.changes) {
    throw new Error('This draft is no longer available for editing.');
  }
}

export async function rejectCandidate(candidateId: string) {
  const db = await getDatabase();
  const candidate = await db.getFirstAsync<{ jobId: string; sourceId: string; status: CandidateStatus }>(
    `SELECT
       generated_candidates.job_id AS jobId,
       generation_jobs.source_id AS sourceId,
       generated_candidates.status
     FROM generated_candidates
     JOIN generation_jobs ON generation_jobs.id = generated_candidates.job_id
     WHERE generated_candidates.id = ?`,
    candidateId,
  );

  if (!candidate || candidate.status !== 'pending') {
    return false;
  }

  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync("UPDATE generated_candidates SET status = 'rejected' WHERE id = ?", candidateId);
    await finalizeCandidateReview(txn, candidate.jobId, candidate.sourceId, now);
  });
  return true;
}

export async function searchCards(query: string): Promise<StudyCard[]> {
  const db = await getDatabase();
  const trimmed = query.trim();

  if (!trimmed) {
    return [];
  }

  try {
    const results = await db.getAllAsync<StudyCard>(
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
        memory_states.fsrs_card_json AS fsrsCardJson
      FROM cards_fts
      JOIN cards ON cards.id = cards_fts.card_id
      JOIN decks ON decks.id = cards.deck_id
      JOIN memory_states ON memory_states.card_id = cards.id
      WHERE cards_fts MATCH ?
        AND cards.deleted_at IS NULL
        AND decks.deleted_at IS NULL
        AND decks.archived_at IS NULL
      ORDER BY rank
      LIMIT 20
      `,
      trimmed,
    );

    return hydrateCards(results);
  } catch {
    const like = `%${trimmed}%`;
    const results = await db.getAllAsync<StudyCard>(
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
        memory_states.fsrs_card_json AS fsrsCardJson
      FROM cards
      JOIN decks ON decks.id = cards.deck_id
      JOIN memory_states ON memory_states.card_id = cards.id
      WHERE cards.deleted_at IS NULL
        AND decks.deleted_at IS NULL
        AND decks.archived_at IS NULL
        AND (cards.prompt LIKE ? OR cards.answer LIKE ?)
      LIMIT 20
      `,
      like,
      like,
    );

    return hydrateCards(results);
  }
}

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

export async function createDeck(input: CreateDeckInput) {
  const db = await getDatabase();
  const now = nowIso();
  const deckId = createId('deck');
  const title = input.title.trim();
  if (!title) throw new Error('Enter a deck name.');

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      `INSERT INTO decks (id, title, description, color, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      deckId,
      title,
      input.description.trim(),
      colors.indigo,
      'albums-outline',
      now,
      now,
    );

    if (input.moduleId) {
      await txn.runAsync(
        `INSERT OR IGNORE INTO module_decks (module_id, deck_id, created_at)
         SELECT course_modules.id, ?, ?
         FROM course_modules
         JOIN courses ON courses.id = course_modules.course_id
         WHERE course_modules.id = ?
           AND courses.deleted_at IS NULL
           AND courses.archived_at IS NULL`,
        deckId,
        now,
        input.moduleId,
      );
    }

    await txn.runAsync(
      `INSERT INTO sync_operations
       (id, entity_type, entity_id, operation, payload_json, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      createId('sync'),
      'deck',
      deckId,
      'create',
      JSON.stringify({ deckId, moduleId: input.moduleId ?? null }),
      'local-only',
      now,
    );
  });

  return deckId;
}

export async function createManualCard(input: CreateManualCardInput) {
  const db = await getDatabase();
  const now = nowIso();
  const noteId = createId('note');
  const cardId = createId('card');
  const fsrsCardJson = createInitialFsrsCard(new Date(now));

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      `INSERT INTO notes (id, deck_id, title, body, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      noteId,
      input.deckId,
      input.prompt.trim(),
      input.answer.trim(),
      null,
      now,
      now,
    );

    await txn.runAsync(
      `INSERT INTO cards
       (id, deck_id, note_id, card_type, prompt, answer, status, is_starred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cardId,
      input.deckId,
      noteId,
      input.cardType.trim() || 'basic',
      input.prompt.trim(),
      input.answer.trim(),
      'manual',
      0,
      now,
      now,
    );

    await txn.runAsync(
      `INSERT INTO memory_states
       (card_id, initial_fsrs_card_json, fsrs_card_json, difficulty, stability, retrievability, due_at, last_reviewed_at, scheduler_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cardId,
      fsrsCardJson,
      fsrsCardJson,
      null,
      null,
      null,
      now,
      null,
      schedulerVersion,
    );

    await upsertSearchIndex(txn, cardId);
  });

  return cardId;
}

export async function importCardsIntoDeck(deckId: string, rows: CardImportReadyRow[]): Promise<ImportedCardResult> {
  const db = await getDatabase();
  const deck = await db.getFirstAsync<{ id: string; title: string }>(
    'SELECT id, title FROM decks WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL',
    deckId,
  );
  if (!deck) {
    throw new Error('Choose an active deck before importing cards.');
  }

  const existing = await db.getAllAsync<{ prompt: string; answer: string }>(
    'SELECT prompt, answer FROM cards WHERE deck_id = ? AND deleted_at IS NULL',
    deckId,
  );
  const seen = new Set(existing.map((card) => cardFingerprint(card.prompt, card.answer)));
  const now = nowIso();
  const result: ImportedCardResult = {
    createdCardCount: 0,
    createdNoteCount: 0,
    skippedDuplicateCount: 0,
    clozeCardCount: 0,
  };

  await runWriteTransaction(db, async (txn) => {
    for (const row of rows) {
      if (!row.front.trim() || (!row.back.trim() && row.cardType !== 'cloze')) {
        continue;
      }

      const payloads = buildImportedCardsForRow(row);
      const uniquePayloads = payloads.filter((payload) => {
        const fingerprint = cardFingerprint(payload.prompt, payload.answer);
        if (seen.has(fingerprint)) {
          result.skippedDuplicateCount += 1;
          return false;
        }
        seen.add(fingerprint);
        return true;
      });

      if (!uniquePayloads.length) {
        continue;
      }

      const noteId = createId('note');
      await txn.runAsync(
        `INSERT INTO notes (id, deck_id, title, body, source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
        noteId,
        deckId,
        compactTitle(row.front),
        row.cardType === 'cloze' ? row.front : row.back,
        now,
        now,
      );
      result.createdNoteCount += 1;

      for (const payload of uniquePayloads) {
        const cardId = createId('card');
        const fsrsCardJson = createInitialFsrsCard(new Date(now));
        await txn.runAsync(
          `INSERT INTO cards
           (id, deck_id, note_id, card_type, prompt, answer, status, is_starred, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'manual', 0, ?, ?)`,
          cardId,
          deckId,
          noteId,
          payload.cardType,
          payload.prompt,
          payload.answer,
          now,
          now,
        );
        await txn.runAsync(
          `INSERT INTO memory_states
           (card_id, initial_fsrs_card_json, fsrs_card_json, difficulty, stability, retrievability, due_at, last_reviewed_at, scheduler_version)
           VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL, ?)`,
          cardId,
          fsrsCardJson,
          fsrsCardJson,
          now,
          schedulerVersion,
        );
        if (payload.cardType === 'cloze') {
          await upsertCardQuality(txn, cardId, {
            learningObjective: 'Recall the hidden concept in context.',
            qualityScore: 0,
            qualityNotes: 'Cloze structure checked. The imported fact has not been verified against a source.',
          }, now);
          result.clozeCardCount += 1;
        }
        await upsertSearchIndex(txn, cardId);
        result.createdCardCount += 1;
      }
    }

    if (result.createdCardCount) {
      await txn.runAsync('UPDATE decks SET updated_at = ? WHERE id = ?', now, deckId);
      await txn.runAsync(
        `INSERT INTO sync_operations
         (id, entity_type, entity_id, operation, payload_json, status, created_at)
         VALUES (?, 'deck', ?, 'bulk-import-cards', ?, 'local-only', ?)`,
        createId('sync'),
        deckId,
        JSON.stringify(result),
        now,
      );
    }
  });

  return result;
}

export async function exportDeckToCsv(deckId: string) {
  const db = await getDatabase();
  const deck = await db.getFirstAsync<{ title: string }>(
    'SELECT title FROM decks WHERE id = ? AND deleted_at IS NULL',
    deckId,
  );
  if (!deck) {
    throw new Error('This deck is not available for export.');
  }

  const rows = await db.getAllAsync<{ prompt: string; answer: string; cardType: string; deckTitle: string }>(
    `SELECT cards.prompt,
            cards.answer,
            cards.card_type AS cardType,
            decks.title AS deckTitle
     FROM cards
     JOIN decks ON decks.id = cards.deck_id
     WHERE cards.deck_id = ?
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
     ORDER BY cards.created_at ASC`,
    deckId,
  );

  return {
    filename: `${safeExportName(deck.title)}-barion-cards.csv`,
    cardCount: rows.length,
    csv: exportCardsToCsv(rows),
  };
}

export async function exportCollectionCards({
  courseId,
  moduleId,
  format,
}: {
  courseId?: string;
  moduleId?: string;
  format: 'csv' | 'tsv';
}) {
  if (Boolean(courseId) === Boolean(moduleId)) {
    throw new Error('Choose one class or folder to export.');
  }
  const db = await getDatabase();
  const scope = moduleId
    ? await db.getFirstAsync<{ title: string }>(
        `SELECT title FROM course_modules WHERE id = ?`,
        moduleId,
      )
    : await db.getFirstAsync<{ title: string }>(
        `SELECT title FROM courses WHERE id = ? AND deleted_at IS NULL`,
        courseId!,
      );
  if (!scope) throw new Error('This collection is no longer available.');

  const membership = moduleId
    ? `SELECT deck_id FROM module_decks WHERE module_id = ?`
    : `SELECT DISTINCT module_decks.deck_id
       FROM module_decks
       JOIN course_modules ON course_modules.id = module_decks.module_id
       WHERE course_modules.course_id = ?`;
  const rows = await db.getAllAsync<{ prompt: string; answer: string; cardType: string; deckTitle: string }>(
    `SELECT cards.prompt, cards.answer, cards.card_type AS cardType, decks.title AS deckTitle
     FROM cards
     JOIN decks ON decks.id = cards.deck_id
     WHERE cards.deck_id IN (${membership})
       AND cards.deleted_at IS NULL
       AND decks.deleted_at IS NULL
       AND decks.archived_at IS NULL
     ORDER BY decks.title ASC, cards.created_at ASC`,
    moduleId ?? courseId!,
  );
  const extension = format;
  return {
    filename: `${safeExportName(scope.title)}-barion-cards.${extension}`,
    cardCount: rows.length,
    content: format === 'csv' ? exportCardsToCsv(rows) : exportCardsToTsv(rows),
    mimeType: format === 'csv' ? 'text/csv' : 'text/tab-separated-values',
  };
}

export async function copyDeck(deckId: string) {
  const db = await getDatabase();
  const sourceDeck = await db.getFirstAsync<{
    title: string;
    description: string;
    color: string;
    icon: string;
  }>(
    `SELECT title, description, color, icon
     FROM decks
     WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL`,
    deckId,
  );
  if (!sourceDeck) throw new Error('This deck is not available to copy.');

  const notes = await db.getAllAsync<{
    id: string;
    title: string;
    body: string;
    sourceId: string | null;
  }>(
    `SELECT id, title, body, source_id AS sourceId
     FROM notes
     WHERE deck_id = ? AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    deckId,
  );
  const cards = await db.getAllAsync<{
    id: string;
    noteId: string | null;
    cardType: string;
    prompt: string;
    answer: string;
    status: string;
    isStarred: number;
  }>(
    `SELECT id, note_id AS noteId, card_type AS cardType, prompt, answer, status,
            is_starred AS isStarred
     FROM cards
     WHERE deck_id = ? AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    deckId,
  );
  const evidenceRows = await db.getAllAsync<{
    cardId: string;
    segmentId: string;
    evidenceText: string;
    supportScore: number;
    verificationStatus: string;
  }>(
    `SELECT card_id AS cardId, segment_id AS segmentId, evidence_text AS evidenceText,
            support_score AS supportScore, verification_status AS verificationStatus
     FROM card_evidence
     WHERE card_id IN (SELECT id FROM cards WHERE deck_id = ? AND deleted_at IS NULL)`,
    deckId,
  );

  const newDeckId = createId('deck');
  const now = nowIso();
  const noteIds = new Map<string, string>();

  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      `INSERT INTO decks
       (id, title, description, color, icon, created_at, updated_at, copied_from_deck_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      newDeckId,
      `${sourceDeck.title} copy`,
      sourceDeck.description,
      sourceDeck.color,
      sourceDeck.icon,
      now,
      now,
      deckId,
    );

    await txn.runAsync(
      `INSERT OR IGNORE INTO module_decks (module_id, deck_id, created_at)
       SELECT module_id, ?, ? FROM module_decks WHERE deck_id = ?`,
      newDeckId,
      now,
      deckId,
    );

    for (const note of notes) {
      const newNoteId = createId('note');
      noteIds.set(note.id, newNoteId);
      await txn.runAsync(
        `INSERT INTO notes (id, deck_id, title, body, source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newNoteId,
        newDeckId,
        note.title,
        note.body,
        note.sourceId,
        now,
        now,
      );
    }

    for (const card of cards) {
      const newCardId = createId('card');
      const fallbackNoteId = createId('note');
      const newNoteId = card.noteId ? noteIds.get(card.noteId) : null;
      if (!newNoteId) {
        await txn.runAsync(
          `INSERT INTO notes (id, deck_id, title, body, source_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`,
          fallbackNoteId,
          newDeckId,
          compactTitle(card.prompt),
          card.answer,
          now,
          now,
        );
      }
      await txn.runAsync(
        `INSERT INTO cards
         (id, deck_id, note_id, card_type, prompt, answer, status, is_starred, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newCardId,
        newDeckId,
        newNoteId ?? fallbackNoteId,
        card.cardType,
        card.prompt,
        card.answer,
        card.status,
        Number(card.isStarred) ? 1 : 0,
        now,
        now,
      );
      const initial = createInitialFsrsCard(new Date(now));
      await txn.runAsync(
        `INSERT INTO memory_states
         (card_id, initial_fsrs_card_json, fsrs_card_json, difficulty, stability, retrievability, due_at, last_reviewed_at, scheduler_version)
         VALUES (?, ?, ?, NULL, NULL, NULL, ?, NULL, ?)`,
        newCardId,
        initial,
        initial,
        now,
        schedulerVersion,
      );

      await txn.runAsync(
        `INSERT INTO card_quality (card_id, learning_objective, quality_score, quality_notes, checked_at)
         SELECT ?, learning_objective, quality_score, quality_notes, ?
         FROM card_quality WHERE card_id = ?`,
        newCardId,
        now,
        card.id,
      );
      for (const evidence of evidenceRows.filter((row) => row.cardId === card.id)) {
        await txn.runAsync(
          `INSERT INTO card_evidence
           (id, card_id, segment_id, evidence_text, support_score, verification_status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          createId('ev'),
          newCardId,
          evidence.segmentId,
          evidence.evidenceText,
          Number(evidence.supportScore),
          evidence.verificationStatus,
          now,
        );
      }
      await upsertSearchIndex(txn, newCardId);
    }

    await txn.runAsync(
      `INSERT INTO sync_operations
       (id, entity_type, entity_id, operation, payload_json, status, created_at)
       VALUES (?, 'deck', ?, 'copy', ?, 'local-only', ?)`,
      createId('sync'),
      newDeckId,
      JSON.stringify({ copiedFromDeckId: deckId, cardCount: cards.length, reviewHistoryCopied: false }),
      now,
    );
  });

  return { deckId: newDeckId, cardCount: cards.length };
}

function cardFingerprint(prompt: string, answer: string) {
  return `${normalizeCardText(prompt)}::${normalizeCardText(answer)}`;
}

function normalizeCardText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function compactTitle(value: string) {
  const cleaned = value.replace(/\{\{c\d+::(.*?)(?:::(.*?))?\}\}/g, '$1').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 88) return cleaned || 'Imported card';
  return `${cleaned.slice(0, 85).trim()}...`;
}

function safeExportName(value: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'barion-deck';
}

async function upsertSourceStudyGuide(
  db: WritableDatabase,
  sourceId: string,
  guide: GeneratedStudyGuide,
  now: string,
) {
  const existing = await db.getFirstAsync<{ id: string; createdAt: string }>(
    'SELECT id, created_at AS createdAt FROM source_study_guides WHERE source_id = ?',
    sourceId,
  );
  const guideId = existing?.id ?? createId('guide');
  await db.runAsync(
    `INSERT INTO source_study_guides
     (id, source_id, title, overview, outline_json, quick_reference_json, discussion_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id) DO UPDATE SET
       title = excluded.title,
       overview = excluded.overview,
       outline_json = excluded.outline_json,
       quick_reference_json = excluded.quick_reference_json,
       discussion_json = excluded.discussion_json,
       updated_at = excluded.updated_at`,
    guideId,
    sourceId,
    guide.title,
    guide.overview,
    JSON.stringify(guide.outline),
    JSON.stringify(guide.quickReference),
    JSON.stringify(guide.discussionQuestions),
    existing?.createdAt ?? now,
    now,
  );
}

function hydrateStudyGuide(row: SourceStudyGuideRow): SourceStudyGuide {
  return {
    id: row.id,
    sourceId: row.sourceId,
    title: row.title,
    overview: row.overview,
    outline: parseGuideArray<SourceStudyGuideSection>(row.outlineJson),
    quickReference: parseGuideArray<SourceStudyGuideQuickReference>(row.quickReferenceJson),
    discussionQuestions: parseGuideArray<SourceStudyGuideDiscussionQuestion>(row.discussionJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function fallbackStudyGuide(sourceId: string, title: string, segments: SourceSegment[]): SourceStudyGuide {
  const generated = createStudyGuide(
    segments.map((segment) => ({
      id: segment.id,
      locator: segment.locator,
      sectionPath: segment.sectionPath,
      text: segment.text,
      startOffset: 0,
      endOffset: segment.text.length,
    })),
    title,
  );
  const now = nowIso();
  return {
    id: `guide-${sourceId}`,
    sourceId,
    title: generated.title,
    overview: generated.overview,
    outline: generated.outline,
    quickReference: generated.quickReference,
    discussionQuestions: generated.discussionQuestions,
    createdAt: now,
    updatedAt: now,
  };
}

function parseGuideArray<T>(serialized: string): T[] {
  try {
    const parsed = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

async function processSource(sourceId: string, asset: SourceAssetInput) {
  const db = await getDatabase();
  const source = await db.getFirstAsync<{ title: string }>(
    'SELECT title FROM sources WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL',
    sourceId,
  );
  if (!source) {
    throw new Error('Source not found.');
  }

  await db.runAsync(
    "UPDATE sources SET status = 'parsing', ingestion_error = NULL WHERE id = ?",
    sourceId,
  );

  try {
    const pages = await readSourceAsset(asset);
    const segments = segmentExtractedPages(pages, source.title);
    if (!segments.length) {
      throw new SourceActionRequiredError(
        'Barion could read the file, but there was not enough continuous text to create study material.',
      );
    }

    const processedAt = nowIso();
    const studyGuide = createStudyGuide(segments, source.title);
    await runWriteTransaction(db, async (txn) => {
      await txn.runAsync('DELETE FROM generation_jobs WHERE source_id = ?', sourceId);
      await txn.runAsync('DELETE FROM source_segments WHERE source_id = ?', sourceId);

      for (const segment of segments) {
        await txn.runAsync(
          `INSERT INTO source_segments
           (id, source_id, locator, section_path, text, start_offset, end_offset, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          segment.id,
          sourceId,
          segment.locator,
          segment.sectionPath,
          segment.text,
          segment.startOffset,
          segment.endOffset,
          processedAt,
        );
      }

      await upsertSourceStudyGuide(txn, sourceId, studyGuide, processedAt);

      await txn.runAsync(
        `UPDATE sources
         SET status = 'generating', ingestion_error = NULL, processed_at = ?
         WHERE id = ?`,
        processedAt,
        sourceId,
      );
    });

    const draftCount = await generateDraftsForSource(sourceId);
    return { segmentCount: segments.length, draftCount };
  } catch (error) {
    const status = error instanceof SourceActionRequiredError ? 'action-required' : 'failed';
    const message = error instanceof Error ? error.message : 'Barion could not process this source.';
    await db.runAsync(
      'UPDATE sources SET status = ?, ingestion_error = ? WHERE id = ?',
      status,
      message,
      sourceId,
    );
    return { segmentCount: 0, draftCount: 0 };
  }
}

function hydrateSource(source: SourceItem): SourceItem {
  return {
    ...source,
    segmentCount: Number(source.segmentCount ?? 0),
    draftCount: Number(source.draftCount ?? 0),
    sourceCardCount: Number(source.sourceCardCount ?? 0),
    autoGeneratedCardCount: Number(source.autoGeneratedCardCount ?? 0),
    autoGeneratedReviewedCardCount: Number(source.autoGeneratedReviewedCardCount ?? 0),
    needsReviewCardCount: Number(source.needsReviewCardCount ?? 0),
    verifiedCardCount: Number(source.verifiedCardCount ?? 0),
    reviewedCardCount: Number(source.reviewedCardCount ?? 0),
    sizeBytes: source.sizeBytes == null ? null : Number(source.sizeBytes),
  };
}

async function moveCardsToTrash(
  db: SQLite.SQLiteDatabase,
  rows: { id: string; noteId: string | null }[],
  details: {
    entityType: TrashItem['entityType'];
    entityId: string;
    title: string;
    sourceId?: string;
    deckId?: string;
  },
) {
  if (!rows.length) return null;
  const cardIds = rows.map((row) => row.id);
  const noteIds = rows.flatMap((row) => (row.noteId ? [row.noteId] : []));
  const reviewedCardCount = await countReviewedCards(db, cardIds);
  const deletedAt = nowIso();
  const trashId = createId('trash');
  const metadata: TrashMetadata = {
    sourceId: details.sourceId,
    deckId: details.deckId,
    cardIds,
    noteIds,
  };

  await runWriteTransaction(db, async (txn) => {
    await softDeleteRows(txn, cardIds, noteIds, deletedAt);
    await insertTrashItem(
      txn,
      trashId,
      details.entityType,
      details.entityId,
      details.title,
      cardIds.length,
      reviewedCardCount,
      deletedAt,
      metadata,
    );
  });
  return trashId;
}

async function countReviewedCards(db: WritableDatabase, cardIds: string[]) {
  if (!cardIds.length) return 0;
  const placeholders = cardIds.map(() => '?').join(',');
  const row = await db.getFirstAsync<CountRow>(
    `SELECT COUNT(DISTINCT card_id) AS count
     FROM review_events
     WHERE reverted_at IS NULL AND card_id IN (${placeholders})`,
    cardIds,
  );
  return Number(row?.count ?? 0);
}

async function softDeleteRows(
  db: WritableDatabase,
  cardIds: string[],
  noteIds: string[],
  deletedAt: string,
) {
  if (cardIds.length) {
    const placeholders = cardIds.map(() => '?').join(',');
    await db.runAsync(
      `UPDATE cards SET deleted_at = ? WHERE deleted_at IS NULL AND id IN (${placeholders})`,
      [deletedAt, ...cardIds],
    );
    try {
      await db.runAsync(`DELETE FROM cards_fts WHERE card_id IN (${placeholders})`, cardIds);
    } catch {
      // FTS is optional; LIKE search also excludes deleted cards.
    }
  }
  if (noteIds.length) {
    const uniqueNoteIds = [...new Set(noteIds)];
    const placeholders = uniqueNoteIds.map(() => '?').join(',');
    await db.runAsync(
      `UPDATE notes SET deleted_at = ? WHERE deleted_at IS NULL AND id IN (${placeholders})`,
      [deletedAt, ...uniqueNoteIds],
    );
  }
}

async function insertTrashItem(
  db: WritableDatabase,
  id: string,
  entityType: TrashItem['entityType'],
  entityId: string,
  title: string,
  itemCount: number,
  reviewedCardCount: number,
  deletedAt: string,
  metadata: TrashMetadata,
) {
  await db.runAsync(
    `INSERT INTO library_trash
     (id, entity_type, entity_id, title, item_count, reviewed_card_count, deleted_at, metadata_json, restored_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    id,
    entityType,
    entityId,
    title,
    itemCount,
    reviewedCardCount,
    deletedAt,
    JSON.stringify(metadata),
  );
}

async function resolveRegeneratedCardTrash(db: WritableDatabase, sourceId: string) {
  const items = await db.getAllAsync<{ id: string; metadataJson: string }>(
    `SELECT id, metadata_json AS metadataJson
     FROM library_trash
     WHERE entity_type = 'source-cards'
       AND entity_id = ?
       AND restored_at IS NULL`,
    sourceId,
  );

  for (const item of items) {
    const metadata = JSON.parse(item.metadataJson) as TrashMetadata;
    const cardIds = metadata.cardIds ?? [];
    if (!cardIds.length) continue;
    const placeholders = cardIds.map(() => '?').join(',');
    const remaining = await db.getFirstAsync<CountRow>(
      `SELECT COUNT(*) AS count FROM cards
       WHERE deleted_at IS NOT NULL AND id IN (${placeholders})`,
      cardIds,
    );
    if (Number(remaining?.count ?? 0) === 0) {
      await db.runAsync('UPDATE library_trash SET restored_at = ? WHERE id = ?', nowIso(), item.id);
    }
  }
}

async function finalizeCandidateReview(
  db: WritableDatabase,
  jobId: string,
  sourceId: string,
  updatedAt: string,
) {
  const pending = await db.getFirstAsync<CountRow>(
    "SELECT COUNT(*) AS count FROM generated_candidates WHERE job_id = ? AND status = 'pending'",
    jobId,
  );

  if (Number(pending?.count ?? 0) === 0) {
    await db.runAsync(
      "UPDATE generation_jobs SET status = 'completed', summary = 'All source drafts have been reviewed.', updated_at = ? WHERE id = ?",
      updatedAt,
      jobId,
    );
    await db.runAsync("UPDATE sources SET status = 'ready' WHERE id = ?", sourceId);
  } else {
    await db.runAsync('UPDATE generation_jobs SET updated_at = ? WHERE id = ?', updatedAt, jobId);
  }
}

async function upsertCardQuality(
  db: WritableDatabase,
  cardId: string,
  candidate: { learningObjective: string; qualityScore: number; qualityNotes: string },
  checkedAt: string,
) {
  await db.runAsync(
    `INSERT INTO card_quality (card_id, learning_objective, quality_score, quality_notes, checked_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(card_id) DO UPDATE SET
       learning_objective = excluded.learning_objective,
       quality_score = excluded.quality_score,
       quality_notes = excluded.quality_notes,
       checked_at = excluded.checked_at`,
    cardId,
    candidate.learningObjective || '',
    Number(candidate.qualityScore ?? 0),
    candidate.qualityNotes || '',
    checkedAt,
  );
}

async function getEvidenceForCard(cardId: string): Promise<EvidenceSnippet | undefined> {
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

function localDayStartIso() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function nextLocalDayIso(from: string) {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(4, 0, 0, 0);
  return next.toISOString();
}

function normalizeWeeklyStudyDays(days: number[]) {
  const normalized = [...new Set(days.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((left, right) => left - right);
  return normalized.length ? normalized : [1, 2, 3, 4, 5, 6];
}

function parseWeeklyStudyDays(value?: string) {
  try {
    const parsed = JSON.parse(value || '[]') as unknown;
    return Array.isArray(parsed) ? normalizeWeeklyStudyDays(parsed.map(Number)) : [1, 2, 3, 4, 5, 6];
  } catch {
    return [1, 2, 3, 4, 5, 6];
  }
}

function normalizeLimit(value: number, maximum: number) {
  if (!Number.isFinite(value)) return maximum;
  if (value === 0) return 0;
  return Math.max(1, Math.min(Math.round(value), maximum));
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

async function upsertSearchIndex(db: WritableDatabase, cardId: string) {
  try {
    await db.runAsync('DELETE FROM cards_fts WHERE card_id = ?', cardId);
    await db.runAsync(
      `
      INSERT INTO cards_fts (card_id, deck_id, prompt, answer, deck_title)
      SELECT cards.id, cards.deck_id, cards.prompt, cards.answer, decks.title
      FROM cards
      JOIN decks ON decks.id = cards.deck_id
      WHERE cards.id = ? AND cards.deleted_at IS NULL
      `,
      cardId,
    );
  } catch {
    // FTS can be unavailable on some platforms; LIKE search remains available.
  }
}

async function runWriteTransaction(
  db: SQLite.SQLiteDatabase,
  task: (txn: WritableDatabase) => Promise<void>,
) {
  if (Platform.OS === 'web') {
    await db.withTransactionAsync(async () => task(db));
    return;
  }

  await db.withExclusiveTransactionAsync(task);
}
