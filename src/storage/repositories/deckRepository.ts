import { createId, nowIso } from '@/domain/ids';
import {
  buildImportedCardsForRow,
  exportCardsToCsv,
  exportCardsToTsv,
  type CardImportReadyRow,
} from '@/cards/importExport';
import type {
  CreateDeckInput,
  CreateManualCardInput,
  DeckSummary,
  EvidenceSnippet,
  StudyCard,
} from '@/domain/types';
import { createInitialFsrsCard, schedulerVersion } from '@/scheduler/fsrs';
import { getDatabase } from '@/storage/database';
import { colors } from '@/theme/colors';
import {
  cardFingerprint,
  compactTitle,
  hydrateCards,
  runWriteTransaction,
  safeExportName,
  upsertCardQuality,
  upsertSearchIndex,
  type ImportedCardResult,
  type WritableDatabase,
} from './shared';

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
