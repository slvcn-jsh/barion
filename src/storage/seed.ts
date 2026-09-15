import type * as SQLite from 'expo-sqlite';

import { createId, nowIso } from '@/domain/ids';
import { createInitialFsrsCard, schedulerVersion } from '@/scheduler/fsrs';
import { colors } from '@/theme/colors';

type SeedCard = {
  type: string;
  prompt: string;
  answer: string;
  evidence: string;
  locator: string;
  section: string;
};

const seedCards: SeedCard[] = [
  {
    type: 'drug-mechanism',
    prompt: 'What is the principal glucose-lowering action of metformin?',
    answer: 'It decreases hepatic glucose production, especially gluconeogenesis.',
    evidence:
      'Metformin improves glycemic control primarily by reducing hepatic glucose production and improving insulin sensitivity.',
    locator: 'Sample PDF - page 18',
    section: 'Endocrine pharmacology / Biguanides',
  },
  {
    type: 'drug-class',
    prompt: 'Which drug class does metformin belong to?',
    answer: 'Metformin is a biguanide.',
    evidence:
      'Biguanides: metformin is the primary agent used clinically for type 2 diabetes mellitus.',
    locator: 'Sample PDF - page 17',
    section: 'Endocrine pharmacology / Drug classes',
  },
  {
    type: 'contraindication',
    prompt: 'Why should ACE inhibitors be avoided during pregnancy?',
    answer: 'They can harm fetal renal development and are contraindicated in pregnancy.',
    evidence:
      'ACE inhibitors and angiotensin receptor blockers are contraindicated in pregnancy because of fetal renal toxicity.',
    locator: 'Sample PDF - page 42',
    section: 'Cardiovascular pharmacology / RAAS blockade',
  },
  {
    type: 'mechanism',
    prompt: 'What does an ACE inhibitor reduce in the RAAS pathway?',
    answer: 'It reduces conversion of angiotensin I to angiotensin II.',
    evidence:
      'ACE inhibition decreases conversion of angiotensin I into angiotensin II, lowering vasoconstriction and aldosterone signaling.',
    locator: 'Sample PDF - page 41',
    section: 'Cardiovascular pharmacology / RAAS blockade',
  },
  {
    type: 'confusion-pair',
    prompt: 'What is the key difference between ACE inhibitors and ARBs?',
    answer:
      'ACE inhibitors block angiotensin-converting enzyme; ARBs block angiotensin II receptors.',
    evidence:
      'ACE inhibitors prevent angiotensin II formation, while ARBs antagonize angiotensin II at its receptor.',
    locator: 'Sample PDF - page 43',
    section: 'Cardiovascular pharmacology / Confusion pairs',
  },
];

export async function seedDatabaseIfNeeded(db: SQLite.SQLiteDatabase) {
  const seeded = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    'seeded_v1',
  );

  if (seeded?.value === 'true') {
    return;
  }

  const now = nowIso();
  const deckId = createId('deck');
  const sourceId = createId('src');

  await db.runAsync(
    `INSERT INTO decks (id, title, description, color, icon, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    deckId,
    'Cardiovascular and endocrine pharmacology',
    'Seed deck for the offline FSRS loop and source-grounded evidence model.',
    colors.teal,
    'medkit-outline',
    now,
    now,
  );

  await db.runAsync(
    `INSERT INTO sources
     (id, title, filename, mime_type, sha256, local_uri, status, default_deck_id, ingestion_error, processed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sourceId,
    'Barion demo pharmacology notes',
    'built-in-demo-notes.txt',
    'text/plain',
    'built-in-curated-demo-v1',
    'seed://barion-demo-notes.txt',
    'ready',
    deckId,
    null,
    now,
    now,
  );

  for (const item of seedCards) {
    const noteId = createId('note');
    const cardId = createId('card');
    const segmentId = createId('seg');
    const evidenceId = createId('ev');
    const fsrsCardJson = createInitialFsrsCard(new Date());

    await db.runAsync(
      `INSERT INTO notes (id, deck_id, title, body, source_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      noteId,
      deckId,
      item.prompt,
      item.answer,
      sourceId,
      now,
      now,
    );

    await db.runAsync(
      `INSERT INTO source_segments
       (id, source_id, locator, section_path, text, start_offset, end_offset, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      segmentId,
      sourceId,
      item.locator,
      item.section,
      item.evidence,
      0,
      item.evidence.length,
      now,
    );

    await db.runAsync(
      `INSERT INTO cards
       (id, deck_id, note_id, card_type, prompt, answer, status, is_starred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      cardId,
      deckId,
      noteId,
      item.type,
      item.prompt,
      item.answer,
      'verified',
      0,
      now,
      now,
    );

    await db.runAsync(
      `INSERT INTO card_evidence
       (id, card_id, segment_id, evidence_text, support_score, verification_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      evidenceId,
      cardId,
      segmentId,
      item.evidence,
      1,
      'built-in-curated-demo',
      now,
    );

    await db.runAsync(
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
  }

  await db.runAsync(
    `INSERT INTO generation_jobs (id, source_id, deck_id, status, summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    createId('job'),
    sourceId,
    deckId,
    'completed',
    'Built-in curated demo cards and evidence.',
    now,
    now,
  );

  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    'seeded_v1',
    'true',
  );
}
