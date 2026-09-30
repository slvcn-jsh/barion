import { createId, nowIso } from '@/domain/ids';
import type { ArchivedItem, TrashItem } from '@/domain/types';
import { getDatabase } from '@/storage/database';
import {
  runWriteTransaction,
  upsertSearchIndex,
  type CountRow,
  type TrashMetadata,
  type WritableDatabase,
} from './shared';

export async function getTrashItems(): Promise<TrashItem[]> {
  const db = await getDatabase();
  await purgeExpiredTrashItems(db, 30);
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
       AND cards.deleted_at IS NULL
       AND (
         cards.status = 'source_extracted'
         OR EXISTS (
           SELECT 1 FROM generated_candidates
           WHERE generated_candidates.published_card_id = cards.id
         )
       )
       AND cards.updated_at = cards.created_at
       AND notes.updated_at = notes.created_at
       AND NOT EXISTS (
         SELECT 1 FROM review_events
         WHERE review_events.card_id = cards.id
           AND review_events.reverted_at IS NULL
       )`,
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

export async function purgeExpiredTrashItems(db: WritableDatabase, retentionDays = 30): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const expired = await db.getAllAsync<{
    id: string;
    entityType: TrashItem['entityType'];
    entityId: string;
    metadataJson: string;
  }>(
    `SELECT id, entity_type AS entityType, entity_id AS entityId, metadata_json AS metadataJson
     FROM library_trash
     WHERE deleted_at <= ? AND restored_at IS NULL`,
    cutoff,
  );

  if (!expired.length) return 0;

  await runWriteTransaction(db, async (txn) => {
    for (const item of expired) {
      let metadata: TrashMetadata = {};
      try {
        metadata = JSON.parse(item.metadataJson) as TrashMetadata;
      } catch {
        metadata = {};
      }

      const cardIds = metadata.cardIds ?? (item.entityType === 'card' ? [item.entityId] : []);
      const noteIds = metadata.noteIds ?? [];

      if (cardIds.length) {
        const cardPlaceholders = cardIds.map(() => '?').join(',');
        await txn.runAsync(`DELETE FROM cards WHERE id IN (${cardPlaceholders}) AND deleted_at IS NOT NULL`, cardIds);
        try {
          await txn.runAsync(`DELETE FROM cards_fts WHERE card_id IN (${cardPlaceholders})`, cardIds);
        } catch {
          // FTS optional
        }
      }

      if (noteIds.length) {
        const notePlaceholders = noteIds.map(() => '?').join(',');
        await txn.runAsync(`DELETE FROM notes WHERE id IN (${notePlaceholders}) AND deleted_at IS NOT NULL`, noteIds);
      }

      if (item.entityType === 'source' || metadata.sourceId) {
        const sourceId = metadata.sourceId ?? item.entityId;
        await txn.runAsync('DELETE FROM sources WHERE id = ? AND deleted_at IS NOT NULL', sourceId);
      }

      if (item.entityType === 'deck' || metadata.deckId) {
        const deckId = metadata.deckId ?? item.entityId;
        await txn.runAsync('DELETE FROM decks WHERE id = ? AND deleted_at IS NOT NULL', deckId);
      }

      await txn.runAsync('DELETE FROM library_trash WHERE id = ?', item.id);
    }
  });

  return expired.length;
}


async function moveCardsToTrash(
  db: WritableDatabase,
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
