import { nowIso } from '@/domain/ids';
import type { Dashboard, DeckSummary, SourceItem } from '@/domain/types';
import { getDatabase } from '@/storage/database';
import { hydrateSource, localDayStartIso, parseWeeklyStudyDays, type CountRow } from './shared';
import { getStudyProfile } from './studyRepository';

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
