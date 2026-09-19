import type * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import { createId, nowIso } from '@/domain/ids';
import { getDatabase } from '@/storage/database';
import { getModeStudyQueue } from '@/storage/repository';

export type MatchCard = { id: string; prompt: string; answer: string; deckTitle: string };
export type MatchSession = {
  id: string;
  deckId: string | null;
  moduleId: string | null;
  totalPairs: number;
  matchedPairs: number;
  mistakeCount: number;
  createdAt: string;
  cards: MatchCard[];
  matchedCardIds: string[];
  mistakeCardIds: string[];
};

export async function startMatchSession(deckId?: string, moduleId?: string, preferredIds?: string[]) {
  const candidates = await getModeStudyQueue(deckId, moduleId, 50);
  const preferred = preferredIds?.length
    ? candidates.filter((card) => preferredIds.includes(card.id))
    : candidates;
  const seenPrompts = new Set<string>();
  const seenAnswers = new Set<string>();
  const cards = preferred.filter((card) => {
    const prompt = normalize(card.prompt);
    const answer = normalize(card.answer);
    if (!prompt || !answer || seenPrompts.has(prompt) || seenAnswers.has(answer)) return false;
    seenPrompts.add(prompt);
    seenAnswers.add(answer);
    return true;
  }).slice(0, 6);
  if (cards.length < 2) return null;

  const db = await getDatabase();
  const id = createId('match');
  const now = nowIso();
  await runWriteTransaction(db, async (txn) => {
    await txn.runAsync(
      "UPDATE game_sessions SET status = 'abandoned', updated_at = ? WHERE game_type = 'match' AND status = 'active'",
      now,
    );
    await txn.runAsync(
      `INSERT INTO game_sessions
       (id, game_type, deck_id, module_id, total_pairs, cards_json, status, created_at, updated_at)
       VALUES (?, 'match', ?, ?, ?, ?, 'active', ?, ?)`,
      id,
      deckId ?? null,
      moduleId ?? null,
      cards.length,
      JSON.stringify(cards.map((card) => card.id)),
      now,
      now,
    );
  });
  return {
    id,
    deckId: deckId ?? null,
    moduleId: moduleId ?? null,
    totalPairs: cards.length,
    matchedPairs: 0,
    mistakeCount: 0,
    createdAt: now,
    cards: cards.map(({ id: cardId, prompt, answer, deckTitle }) => ({ id: cardId, prompt, answer, deckTitle })),
    matchedCardIds: [],
    mistakeCardIds: [],
  } satisfies MatchSession;
}

export async function getLatestMatchSession(deckId?: string, moduleId?: string): Promise<MatchSession | null> {
  const db = await getDatabase();
  const session = await db.getFirstAsync<Omit<MatchSession, 'cards' | 'matchedCardIds' | 'mistakeCardIds'> & { cardsJson: string }>(
    `SELECT id, deck_id AS deckId, module_id AS moduleId, total_pairs AS totalPairs,
            matched_pairs AS matchedPairs, mistake_count AS mistakeCount,
            created_at AS createdAt, cards_json AS cardsJson
     FROM game_sessions
     WHERE game_type = 'match' AND status = 'active'
       AND (? IS NULL OR deck_id = ?)
       AND (? IS NULL OR module_id = ?)
     ORDER BY updated_at DESC LIMIT 1`,
    deckId ?? null,
    deckId ?? null,
    moduleId ?? null,
    moduleId ?? null,
  );
  if (!session) return null;
  const ids = parseIds(session.cardsJson);
  if (ids.length < 2) return null;
  const placeholders = ids.map(() => '?').join(',');
  const cards = await db.getAllAsync<MatchCard>(
    `SELECT cards.id, cards.prompt, cards.answer, decks.title AS deckTitle
     FROM cards
     JOIN decks ON decks.id = cards.deck_id
     LEFT JOIN card_learning_state ON card_learning_state.card_id = cards.id
     WHERE cards.id IN (${placeholders})
       AND cards.deleted_at IS NULL AND cards.status != 'needs_review'
       AND decks.deleted_at IS NULL AND decks.archived_at IS NULL
       AND COALESCE(card_learning_state.is_suspended, 0) = 0`,
    ids,
  );
  const byId = new Map(cards.map((card) => [card.id, card]));
  const ordered = ids.map((id) => byId.get(id)).filter((card): card is MatchCard => Boolean(card));
  if (ordered.length < 2) return null;
  const events = await db.getAllAsync<{ cardId: string | null; eventType: string }>(
    `SELECT card_id AS cardId, event_type AS eventType
     FROM game_events WHERE session_id = ? ORDER BY occurred_at ASC`,
    session.id,
  );
  const matchedCardIds = [...new Set(events
    .filter((event) => event.eventType === 'matched' && event.cardId)
    .map((event) => event.cardId as string))];
  const mistakeCardIds = [...new Set(events
    .filter((event) => event.eventType === 'mismatch' && event.cardId)
    .map((event) => event.cardId as string))];
  return {
    ...session,
    totalPairs: Number(session.totalPairs),
    matchedPairs: Number(session.matchedPairs),
    mistakeCount: Number(session.mistakeCount),
    cards: ordered,
    matchedCardIds,
    mistakeCardIds,
  };
}

export async function recordMatchAttempt(sessionId: string, termCardId: string, answerCardId: string, elapsedMs: number) {
  const db = await getDatabase();
  const now = nowIso();
  const correct = termCardId === answerCardId;
  await runWriteTransaction(db, async (txn) => {
    const session = await txn.getFirstAsync<{ status: string; totalPairs: number; matchedPairs: number }>(
      `SELECT status, total_pairs AS totalPairs, matched_pairs AS matchedPairs
       FROM game_sessions WHERE id = ?`,
      sessionId,
    );
    if (!session || session.status !== 'active') throw new Error('This Match round is no longer active.');

    if (correct) {
      const existing = await txn.getFirstAsync<{ id: string }>(
        `SELECT id FROM game_events
         WHERE session_id = ? AND card_id = ? AND event_type = 'matched'
         LIMIT 1`,
        sessionId,
        termCardId,
      );
      if (existing) return;
    }

    await txn.runAsync(
      `INSERT INTO game_events (id, session_id, card_id, event_type, elapsed_ms, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      createId('game-event'),
      sessionId,
      termCardId,
      correct ? 'matched' : 'mismatch',
      Math.max(0, Math.round(elapsedMs)),
      now,
    );

    if (!correct) {
      await txn.runAsync('UPDATE game_sessions SET mistake_count = mistake_count + 1, updated_at = ? WHERE id = ?', now, sessionId);
      return;
    }

    await txn.runAsync(
      `INSERT INTO study_activity_events
       (id, session_id, card_id, activity_mode, outcome, response_time_ms, affects_fsrs, occurred_at)
       VALUES (?, NULL, ?, 'match', 'known', ?, 0, ?)`,
      createId('activity'),
      termCardId,
      Math.max(0, Math.round(elapsedMs)),
      now,
    );
    await txn.runAsync(
      `INSERT INTO card_mode_mastery
       (card_id, familiarity, short_due_at, known_count, last_outcome, updated_at)
       VALUES (?, 0.25, NULL, 1, 'known', ?)
       ON CONFLICT(card_id) DO UPDATE SET
         familiarity = MIN(10, card_mode_mastery.familiarity + 0.25),
         known_count = card_mode_mastery.known_count + 1,
         last_outcome = 'known', updated_at = excluded.updated_at`,
      termCardId,
      now,
    );
    await txn.runAsync(
      `UPDATE game_sessions
       SET matched_pairs = matched_pairs + 1,
           status = CASE WHEN matched_pairs + 1 >= total_pairs THEN 'completed' ELSE status END,
           completed_at = CASE WHEN matched_pairs + 1 >= total_pairs THEN ? ELSE completed_at END,
           updated_at = ?
       WHERE id = ?`,
      now,
      now,
      sessionId,
    );
  });
  return correct;
}

function parseIds(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function normalize(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
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
