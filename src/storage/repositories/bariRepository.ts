import { createId, nowIso } from '@/domain/ids';
import type { BariStoredMessage, SourceSegment } from '@/domain/types';
import { getDatabase } from '@/storage/database';

export async function getOrCreateBariConversation(
  contextType: 'card' | 'deck' | 'general',
  contextId?: string,
  title = 'Study Assistant',
): Promise<{ id: string; title: string; messages: BariStoredMessage[] }> {
  const db = await getDatabase();
  let conversation = await db.getFirstAsync<{ id: string; title: string }>(
    'SELECT id, title FROM bari_conversations WHERE context_type = ? AND (context_id = ? OR (context_id IS NULL AND ? IS NULL)) ORDER BY updated_at DESC LIMIT 1',
    contextType,
    contextId ?? null,
    contextId ?? null,
  );

  if (!conversation) {
    const newId = createId('conv');
    const timestamp = nowIso();
    await db.runAsync(
      'INSERT INTO bari_conversations (id, context_type, context_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      newId,
      contextType,
      contextId ?? null,
      title,
      timestamp,
      timestamp,
    );
    conversation = { id: newId, title };
  }

  const rawMessages = await db.getAllAsync<{
    id: string;
    conversation_id: string;
    role: 'user' | 'bari';
    text: string;
    citations_json: string | null;
    evidence_json: string | null;
    created_at: string;
  }>(
    'SELECT id, conversation_id, role, text, citations_json, evidence_json, created_at FROM bari_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    conversation.id,
  );

  const messages: BariStoredMessage[] = rawMessages.map((m) => ({
    id: m.id,
    conversationId: m.conversation_id,
    role: m.role,
    text: m.text,
    citations: m.citations_json ? JSON.parse(m.citations_json) : [],
    evidence: m.evidence_json ? JSON.parse(m.evidence_json) : [],
    createdAt: m.created_at,
  }));

  return { id: conversation.id, title: conversation.title, messages };
}

export async function saveBariMessage(
  conversationId: string,
  role: 'user' | 'bari',
  text: string,
  citations: Array<{ segmentId?: string; locator?: string; sectionPath?: string; text?: string }> = [],
  evidence: Array<{ segmentId: string; locator: string; sectionPath: string; text: string }> = [],
  messageId?: string,
  createdAt?: string,
): Promise<void> {
  const db = await getDatabase();
  const id = messageId || createId('msg');
  const timestamp = createdAt || nowIso();

  await db.runAsync(
    'INSERT OR REPLACE INTO bari_messages (id, conversation_id, role, text, citations_json, evidence_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id,
    conversationId,
    role,
    text,
    citations.length ? JSON.stringify(citations) : null,
    evidence.length ? JSON.stringify(evidence) : null,
    timestamp,
  );

  await db.runAsync(
    'UPDATE bari_conversations SET updated_at = ? WHERE id = ?',
    timestamp,
    conversationId,
  );
}

export async function clearBariConversation(conversationId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM bari_messages WHERE conversation_id = ?', conversationId);
  await db.runAsync('UPDATE bari_conversations SET updated_at = ? WHERE id = ?', nowIso(), conversationId);
}

export async function getSourceSegmentsForDeck(deckId: string): Promise<SourceSegment[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    sourceId: string;
    locator: string;
    sectionPath: string;
    text: string;
    createdAt: string;
  }>(
    `
    SELECT DISTINCT
      source_segments.id,
      source_segments.source_id AS sourceId,
      source_segments.locator,
      source_segments.section_path AS sectionPath,
      source_segments.text,
      source_segments.created_at AS createdAt
    FROM source_segments
    JOIN card_evidence ON card_evidence.segment_id = source_segments.id
    JOIN cards ON cards.id = card_evidence.card_id
    WHERE cards.deck_id = ? AND cards.deleted_at IS NULL
    UNION
    SELECT DISTINCT
      source_segments.id,
      source_segments.source_id AS sourceId,
      source_segments.locator,
      source_segments.section_path AS sectionPath,
      source_segments.text,
      source_segments.created_at AS createdAt
    FROM source_segments
    JOIN sources ON sources.id = source_segments.source_id
    WHERE sources.default_deck_id = ? AND sources.deleted_at IS NULL AND sources.archived_at IS NULL
    ORDER BY createdAt ASC
    `,
    deckId,
    deckId,
  );
  return rows;
}

export type { BariStoredMessage };
