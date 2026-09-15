import * as SQLite from 'expo-sqlite';

import { seedDatabaseIfNeeded } from '@/storage/seed';

const DATABASE_VERSION = 12;

let database: SQLite.SQLiteDatabase | null = null;
let initializationPromise: Promise<void> | null = null;

export async function getDatabase() {
  if (!database) {
    database = await SQLite.openDatabaseAsync('medstudy.db');
  }

  return database;
}

export async function initializeDatabase() {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = initializeDatabaseOnce().catch((error) => {
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}

async function initializeDatabaseOnce() {
  const db = await getDatabase();

  await db.execAsync(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
  `);

  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const currentVersion = versionRow?.user_version ?? 0;

  await migrateDatabase(db, currentVersion);
  await seedDatabaseIfNeeded(db);
  await ensureSearchIndex(db);
  await rebuildSearchIndexIfNeeded(db);
}

async function migrateDatabase(db: SQLite.SQLiteDatabase, currentVersion: number) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL,
      icon TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY NOT NULL,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      source_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY NOT NULL,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
      card_type TEXT NOT NULL,
      prompt TEXT NOT NULL,
      answer TEXT NOT NULL,
      status TEXT NOT NULL,
      is_starred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      local_uri TEXT NOT NULL,
      size_bytes INTEGER,
      status TEXT NOT NULL,
      default_deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
      ingestion_error TEXT,
      processed_at TEXT,
      created_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS source_segments (
      id TEXT PRIMARY KEY NOT NULL,
      source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      locator TEXT NOT NULL,
      section_path TEXT NOT NULL,
      text TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_evidence (
      id TEXT PRIMARY KEY NOT NULL,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      segment_id TEXT NOT NULL REFERENCES source_segments(id) ON DELETE CASCADE,
      evidence_text TEXT NOT NULL,
      support_score REAL NOT NULL,
      verification_status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_events (
      id TEXT PRIMARY KEY NOT NULL,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      reviewed_at TEXT NOT NULL,
      rating TEXT NOT NULL,
      response_time_ms INTEGER NOT NULL,
      study_mode TEXT NOT NULL,
      scheduler_version TEXT NOT NULL,
      study_session_id TEXT,
      reverted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_states (
      card_id TEXT PRIMARY KEY NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      initial_fsrs_card_json TEXT,
      fsrs_card_json TEXT NOT NULL,
      difficulty REAL,
      stability REAL,
      retrievability REAL,
      due_at TEXT NOT NULL,
      last_reviewed_at TEXT,
      scheduler_version TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
      deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS generated_candidates (
      id TEXT PRIMARY KEY NOT NULL,
      job_id TEXT NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
      segment_id TEXT REFERENCES source_segments(id) ON DELETE SET NULL,
      card_type TEXT NOT NULL DEFAULT 'source-review',
      learning_objective TEXT NOT NULL DEFAULT '',
      quality_score REAL NOT NULL DEFAULT 0,
      quality_notes TEXT NOT NULL DEFAULT '',
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      evidence_text TEXT NOT NULL,
      locator TEXT NOT NULL DEFAULT '',
      verification_status TEXT NOT NULL,
      support_score REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_operations (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_trash (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      title TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 1,
      reviewed_card_count INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      restored_at TEXT
    );

    CREATE TABLE IF NOT EXISTS study_profiles (
      id TEXT PRIMARY KEY NOT NULL,
      review_style TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      session_length INTEGER NOT NULL,
      feedback_timing TEXT NOT NULL,
      evidence_display TEXT NOT NULL,
      daily_new_limit INTEGER NOT NULL,
      daily_review_limit INTEGER NOT NULL,
      exam_goal TEXT NOT NULL,
      workspace_mode TEXT NOT NULL DEFAULT 'learner',
      weekly_days_json TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]',
      reminder_enabled INTEGER NOT NULL DEFAULT 0,
      reminder_hour INTEGER NOT NULL DEFAULT 19,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_learning_state (
      card_id TEXT PRIMARY KEY NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      weak_score REAL NOT NULL DEFAULT 0,
      test_correct_count INTEGER NOT NULL DEFAULT 0,
      test_incorrect_count INTEGER NOT NULL DEFAULT 0,
      is_flagged INTEGER NOT NULL DEFAULT 0,
      is_suspended INTEGER NOT NULL DEFAULT 0,
      lapse_count INTEGER NOT NULL DEFAULT 0,
      is_leech INTEGER NOT NULL DEFAULT 0,
      misconception_count INTEGER NOT NULL DEFAULT 0,
      last_confident_miss_at TEXT,
      buried_until TEXT,
      last_tested_at TEXT
    );

    CREATE TABLE IF NOT EXISTS card_quality (
      card_id TEXT PRIMARY KEY NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      learning_objective TEXT NOT NULL DEFAULT '',
      quality_score REAL NOT NULL DEFAULT 0,
      quality_notes TEXT NOT NULL DEFAULT '',
      checked_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS test_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
      format TEXT NOT NULL,
      scope TEXT NOT NULL,
      question_limit INTEGER NOT NULL,
      total_count INTEGER NOT NULL,
      answered_count INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      questions_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS test_responses (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL REFERENCES test_sessions(id) ON DELETE CASCADE,
      card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
      response_text TEXT NOT NULL DEFAULT '',
      is_correct INTEGER NOT NULL,
      confidence TEXT NOT NULL,
      rating TEXT NOT NULL,
      answered_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      exam_date TEXT,
      color TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS course_modules (
      id TEXT PRIMARY KEY NOT NULL,
      course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS module_decks (
      module_id TEXT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
      deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (module_id, deck_id)
    );

    CREATE TABLE IF NOT EXISTS study_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      mode TEXT NOT NULL,
      deck_id TEXT REFERENCES decks(id) ON DELETE SET NULL,
      focus TEXT,
      plan_size TEXT NOT NULL DEFAULT 'normal',
      total_count INTEGER NOT NULL,
      completed_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS study_session_items (
      session_id TEXT NOT NULL REFERENCES study_sessions(id) ON DELETE CASCADE,
      card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      completed_at TEXT,
      PRIMARY KEY (session_id, card_id)
    );
  `);

  await db.runAsync(
    `INSERT OR IGNORE INTO study_profiles
     (id, review_style, difficulty, session_length, feedback_timing, evidence_display, daily_new_limit, daily_review_limit, exam_goal, updated_at)
     VALUES ('default', 'clinical-reasoning', 'standard', 10, 'immediate', 'compact', 10, 40, 'clinical-recall', ?)`,
    new Date().toISOString(),
  );

  const repairedColumns = await ensureRequiredColumns(db);

  if (currentVersion < 11) {
    await db.execAsync(`
      UPDATE study_profiles
      SET workspace_mode = COALESCE(workspace_mode, 'learner'),
          weekly_days_json = COALESCE(weekly_days_json, '[1,2,3,4,5,6]'),
          reminder_enabled = COALESCE(reminder_enabled, 0),
          reminder_hour = COALESCE(reminder_hour, 19);
    `);
  }

  if (currentVersion < 10) {
    await db.execAsync(`
      UPDATE test_sessions
      SET status = 'abandoned',
          updated_at = COALESCE(updated_at, created_at)
      WHERE status = 'active'
        AND (questions_json IS NULL OR questions_json = '[]');

      DELETE FROM test_responses
      WHERE card_id IS NOT NULL
        AND rowid NOT IN (
        SELECT MIN(rowid)
        FROM test_responses
        WHERE card_id IS NOT NULL
        GROUP BY session_id, card_id
      );

      UPDATE test_sessions
      SET answered_count = (
            SELECT COUNT(*) FROM test_responses
            WHERE test_responses.session_id = test_sessions.id
          ),
          correct_count = (
            SELECT COUNT(*) FROM test_responses
            WHERE test_responses.session_id = test_sessions.id
              AND test_responses.is_correct = 1
          );
    `);
  }

  if (currentVersion < 2) {
    await db.execAsync(`
      UPDATE memory_states
      SET initial_fsrs_card_json = fsrs_card_json
      WHERE initial_fsrs_card_json IS NULL;
    `);
  }

  if (currentVersion < 3) {
    await db.execAsync(`
      UPDATE sources
      SET status = 'action-required',
          ingestion_error = 'This earlier import was saved before local extraction was available. Re-import the original file to process it.'
      WHERE status = 'imported-awaiting-ingestion';
    `);
  }

  if (currentVersion < 4) {
    await db.execAsync(`
      UPDATE sources
      SET title = 'Barion demo pharmacology notes',
          filename = 'built-in-demo-notes.txt',
          mime_type = 'text/plain',
          sha256 = 'built-in-curated-demo-v1',
          local_uri = 'seed://barion-demo-notes.txt',
          processed_at = COALESCE(processed_at, created_at)
      WHERE sha256 = 'seeded-source-placeholder';

      UPDATE card_evidence
      SET support_score = 1,
          verification_status = 'built-in-curated-demo'
      WHERE segment_id IN (
        SELECT source_segments.id
        FROM source_segments
        JOIN sources ON sources.id = source_segments.source_id
        WHERE sources.sha256 = 'built-in-curated-demo-v1'
      );

      UPDATE generation_jobs
      SET status = 'completed',
          summary = 'Built-in curated demo cards and evidence.',
          updated_at = COALESCE(updated_at, created_at)
      WHERE source_id IN (
        SELECT id FROM sources WHERE sha256 = 'built-in-curated-demo-v1'
      );
    `);
  }

  const needsSourceDeckRepair =
    currentVersion < 5 || repairedColumns.defaultDeckId || (await hasSourceDeckOwnershipGaps(db));
  const needsDuplicateSourceConsolidation =
    currentVersion < 6 || repairedColumns.defaultDeckId || (await hasDuplicateSources(db));

  if (needsSourceDeckRepair) {
    await repairSourceDeckOwnership(db);
  }

  if (needsDuplicateSourceConsolidation) {
    await consolidateDuplicateSources(db);
  }

  await ensureDefaultCourseStructure(db);

  await createIndexes(db);
  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}

async function ensureRequiredColumns(db: SQLite.SQLiteDatabase) {
  return {
    cardDeletedAt: await addColumnIfMissing(db, 'cards', 'deleted_at', 'TEXT'),
    deckArchivedAt: await addColumnIfMissing(db, 'decks', 'archived_at', 'TEXT'),
    deckDeletedAt: await addColumnIfMissing(db, 'decks', 'deleted_at', 'TEXT'),
    defaultDeckId: await addColumnIfMissing(
      db,
      'sources',
      'default_deck_id',
      'TEXT REFERENCES decks(id) ON DELETE SET NULL',
    ),
    generatedCandidateLocator: await addColumnIfMissing(
      db,
      'generated_candidates',
      'locator',
      "TEXT NOT NULL DEFAULT ''",
    ),
    generatedCandidateCardType: await addColumnIfMissing(
      db,
      'generated_candidates',
      'card_type',
      "TEXT NOT NULL DEFAULT 'source-review'",
    ),
    generatedCandidateLearningObjective: await addColumnIfMissing(
      db,
      'generated_candidates',
      'learning_objective',
      "TEXT NOT NULL DEFAULT ''",
    ),
    generatedCandidateQualityNotes: await addColumnIfMissing(
      db,
      'generated_candidates',
      'quality_notes',
      "TEXT NOT NULL DEFAULT ''",
    ),
    generatedCandidateQualityScore: await addColumnIfMissing(
      db,
      'generated_candidates',
      'quality_score',
      'REAL NOT NULL DEFAULT 0',
    ),
    generatedCandidateSegmentId: await addColumnIfMissing(db, 'generated_candidates', 'segment_id', 'TEXT'),
    generationJobUpdatedAt: await addColumnIfMissing(db, 'generation_jobs', 'updated_at', 'TEXT'),
    memoryInitialFsrsCardJson: await addColumnIfMissing(db, 'memory_states', 'initial_fsrs_card_json', 'TEXT'),
    noteDeletedAt: await addColumnIfMissing(db, 'notes', 'deleted_at', 'TEXT'),
    reviewEventRevertedAt: await addColumnIfMissing(db, 'review_events', 'reverted_at', 'TEXT'),
    reviewEventStudySessionId: await addColumnIfMissing(db, 'review_events', 'study_session_id', 'TEXT'),
    sourceIngestionError: await addColumnIfMissing(db, 'sources', 'ingestion_error', 'TEXT'),
    sourceProcessedAt: await addColumnIfMissing(db, 'sources', 'processed_at', 'TEXT'),
    sourceSizeBytes: await addColumnIfMissing(db, 'sources', 'size_bytes', 'INTEGER'),
    sourceArchivedAt: await addColumnIfMissing(db, 'sources', 'archived_at', 'TEXT'),
    sourceDeletedAt: await addColumnIfMissing(db, 'sources', 'deleted_at', 'TEXT'),
    testSessionQuestionsJson: await addColumnIfMissing(
      db,
      'test_sessions',
      'questions_json',
      "TEXT NOT NULL DEFAULT '[]'",
    ),
    testSessionUpdatedAt: await addColumnIfMissing(db, 'test_sessions', 'updated_at', 'TEXT'),
    profileWorkspaceMode: await addColumnIfMissing(
      db,
      'study_profiles',
      'workspace_mode',
      "TEXT NOT NULL DEFAULT 'learner'",
    ),
    profileWeeklyDaysJson: await addColumnIfMissing(
      db,
      'study_profiles',
      'weekly_days_json',
      "TEXT NOT NULL DEFAULT '[1,2,3,4,5,6]'",
    ),
    profileReminderEnabled: await addColumnIfMissing(
      db,
      'study_profiles',
      'reminder_enabled',
      'INTEGER NOT NULL DEFAULT 0',
    ),
    profileReminderHour: await addColumnIfMissing(
      db,
      'study_profiles',
      'reminder_hour',
      'INTEGER NOT NULL DEFAULT 19',
    ),
    learningLapseCount: await addColumnIfMissing(
      db,
      'card_learning_state',
      'lapse_count',
      'INTEGER NOT NULL DEFAULT 0',
    ),
    learningIsLeech: await addColumnIfMissing(
      db,
      'card_learning_state',
      'is_leech',
      'INTEGER NOT NULL DEFAULT 0',
    ),
    learningBuriedUntil: await addColumnIfMissing(db, 'card_learning_state', 'buried_until', 'TEXT'),
    learningMisconceptionCount: await addColumnIfMissing(
      db,
      'card_learning_state',
      'misconception_count',
      'INTEGER NOT NULL DEFAULT 0',
    ),
    learningLastConfidentMissAt: await addColumnIfMissing(
      db,
      'card_learning_state',
      'last_confident_miss_at',
      'TEXT',
    ),
  };
}

async function ensureDefaultCourseStructure(db: SQLite.SQLiteDatabase) {
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT OR IGNORE INTO courses
     (id, title, exam_date, color, created_at, updated_at)
     VALUES ('course-default', 'Medical studies', NULL, '#3B82F6', ?, ?)`,
    now,
    now,
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO course_modules
     (id, course_id, title, position, created_at, updated_at)
     VALUES ('module-imported-sources', 'course-default', 'Imported sources', 0, ?, ?)`,
    now,
    now,
  );
  await db.runAsync(
    `INSERT OR IGNORE INTO module_decks (module_id, deck_id, created_at)
     SELECT 'module-imported-sources', sources.default_deck_id, ?
     FROM sources
     JOIN decks ON decks.id = sources.default_deck_id
     WHERE sources.default_deck_id IS NOT NULL
       AND sources.deleted_at IS NULL
       AND decks.deleted_at IS NULL`,
    now,
  );
  await db.execAsync(`
    CREATE TRIGGER IF NOT EXISTS assign_new_source_deck_to_default_module
    AFTER INSERT ON sources
    WHEN NEW.default_deck_id IS NOT NULL
    BEGIN
      INSERT OR IGNORE INTO module_decks (module_id, deck_id, created_at)
      VALUES ('module-imported-sources', NEW.default_deck_id, NEW.created_at);
    END;

    CREATE TRIGGER IF NOT EXISTS assign_updated_source_deck_to_default_module
    AFTER UPDATE OF default_deck_id ON sources
    WHEN NEW.default_deck_id IS NOT NULL
    BEGIN
      INSERT OR IGNORE INTO module_decks (module_id, deck_id, created_at)
      VALUES ('module-imported-sources', NEW.default_deck_id, NEW.created_at);
    END;
  `);
}

async function repairSourceDeckOwnership(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
      UPDATE sources
      SET default_deck_id = (
        SELECT notes.deck_id
        FROM notes
        WHERE notes.source_id = sources.id
        LIMIT 1
      )
      WHERE sha256 = 'built-in-curated-demo-v1'
        AND default_deck_id IS NULL;

      INSERT OR IGNORE INTO decks
        (id, title, description, color, icon, created_at, updated_at)
      SELECT
        'source-deck-' || sources.id,
        sources.title,
        'Automatically created from ' || sources.filename || '.',
        '#3B82F6',
        'document-text-outline',
        sources.created_at,
        sources.created_at
      FROM sources
      WHERE sources.default_deck_id IS NULL
        AND sources.deleted_at IS NULL
        AND sources.sha256 != 'built-in-curated-demo-v1';

      UPDATE sources
      SET default_deck_id = 'source-deck-' || id
      WHERE default_deck_id IS NULL
        AND deleted_at IS NULL
        AND sha256 != 'built-in-curated-demo-v1';

      UPDATE notes
      SET deck_id = (
        SELECT sources.default_deck_id
        FROM sources
        WHERE sources.id = notes.source_id
      )
      WHERE source_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM sources
          WHERE sources.id = notes.source_id
            AND sources.default_deck_id IS NOT NULL
        );

      UPDATE cards
      SET deck_id = (
        SELECT notes.deck_id FROM notes WHERE notes.id = cards.note_id
      )
      WHERE note_id IN (SELECT id FROM notes WHERE source_id IS NOT NULL);

      UPDATE review_events
      SET deck_id = (
        SELECT cards.deck_id FROM cards WHERE cards.id = review_events.card_id
      )
      WHERE card_id IN (
        SELECT cards.id
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id IS NOT NULL
      );

      UPDATE generation_jobs
      SET deck_id = (
        SELECT sources.default_deck_id
        FROM sources
        WHERE sources.id = generation_jobs.source_id
      )
      WHERE source_id IS NOT NULL;

      WITH ranked_source_cards AS (
        SELECT
          cards.id,
          ROW_NUMBER() OVER (
            PARTITION BY notes.source_id, trim(cards.prompt), trim(cards.answer)
            ORDER BY
              (SELECT COUNT(*) FROM review_events WHERE review_events.card_id = cards.id) DESC,
              cards.created_at ASC
          ) AS duplicate_rank
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id IS NOT NULL
      )
      DELETE FROM cards
      WHERE id IN (
        SELECT id FROM ranked_source_cards WHERE duplicate_rank > 1
      );

      DELETE FROM notes
      WHERE source_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM cards WHERE cards.note_id = notes.id);
  `);
}

async function hasSourceDeckOwnershipGaps(db: SQLite.SQLiteDatabase) {
  const row = await db.getFirstAsync<{ count: number }>(`
    SELECT COUNT(*) AS count
    FROM sources
    WHERE default_deck_id IS NULL AND deleted_at IS NULL
  `);

  return Number(row?.count ?? 0) > 0;
}

async function consolidateDuplicateSources(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
      DROP TABLE IF EXISTS temp.source_merge_map;
      CREATE TEMP TABLE source_merge_map AS
      SELECT
        duplicate_source.id AS duplicate_id,
        (
          SELECT canonical.id
          FROM sources AS canonical
          WHERE canonical.sha256 = duplicate_source.sha256
            AND canonical.deleted_at IS NULL
          ORDER BY
            CASE canonical.status
              WHEN 'ready' THEN 0
              WHEN 'review-ready' THEN 1
              ELSE 2
            END,
            canonical.created_at ASC,
            canonical.id ASC
          LIMIT 1
        ) AS canonical_id
      FROM sources AS duplicate_source
      WHERE duplicate_source.deleted_at IS NULL
        AND
        (
        SELECT COUNT(*) FROM sources AS matching
        WHERE matching.sha256 = duplicate_source.sha256
          AND matching.deleted_at IS NULL
      ) > 1;

      UPDATE notes
      SET source_id = (
            SELECT canonical_id FROM source_merge_map
            WHERE duplicate_id = notes.source_id
          ),
          deck_id = (
            SELECT sources.default_deck_id
            FROM sources
            WHERE sources.id = (
              SELECT canonical_id FROM source_merge_map
              WHERE duplicate_id = notes.source_id
            )
          )
      WHERE source_id IN (
        SELECT duplicate_id FROM source_merge_map
        WHERE duplicate_id != canonical_id
      );

      UPDATE source_segments
      SET source_id = (
        SELECT canonical_id FROM source_merge_map
        WHERE duplicate_id = source_segments.source_id
      )
      WHERE source_id IN (
        SELECT duplicate_id FROM source_merge_map
        WHERE duplicate_id != canonical_id
      );

      UPDATE generation_jobs
      SET source_id = (
            SELECT canonical_id FROM source_merge_map
            WHERE duplicate_id = generation_jobs.source_id
          ),
          deck_id = (
            SELECT sources.default_deck_id
            FROM sources
            WHERE sources.id = (
              SELECT canonical_id FROM source_merge_map
              WHERE duplicate_id = generation_jobs.source_id
            )
          )
      WHERE source_id IN (
        SELECT duplicate_id FROM source_merge_map
        WHERE duplicate_id != canonical_id
      );

      DELETE FROM sources
      WHERE id IN (
        SELECT duplicate_id FROM source_merge_map
        WHERE duplicate_id != canonical_id
      );

      UPDATE cards
      SET deck_id = (
        SELECT notes.deck_id FROM notes WHERE notes.id = cards.note_id
      )
      WHERE note_id IN (SELECT id FROM notes WHERE source_id IS NOT NULL);

      UPDATE review_events
      SET deck_id = (
        SELECT cards.deck_id FROM cards WHERE cards.id = review_events.card_id
      )
      WHERE card_id IN (
        SELECT cards.id
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id IS NOT NULL
      );

      WITH ranked_source_cards AS (
        SELECT
          cards.id,
          ROW_NUMBER() OVER (
            PARTITION BY notes.source_id, trim(cards.prompt), trim(cards.answer)
            ORDER BY
              (SELECT COUNT(*) FROM review_events WHERE review_events.card_id = cards.id) DESC,
              cards.created_at ASC
          ) AS duplicate_rank
        FROM cards
        JOIN notes ON notes.id = cards.note_id
        WHERE notes.source_id IS NOT NULL
      )
      DELETE FROM cards
      WHERE id IN (
        SELECT id FROM ranked_source_cards WHERE duplicate_rank > 1
      );

      DELETE FROM notes
      WHERE source_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM cards WHERE cards.note_id = notes.id);

      DELETE FROM decks
      WHERE id LIKE 'source-deck-%'
        AND NOT EXISTS (SELECT 1 FROM sources WHERE sources.default_deck_id = decks.id)
        AND NOT EXISTS (SELECT 1 FROM cards WHERE cards.deck_id = decks.id)
        AND NOT EXISTS (SELECT 1 FROM notes WHERE notes.deck_id = decks.id)
        AND NOT EXISTS (SELECT 1 FROM review_events WHERE review_events.deck_id = decks.id)
        AND NOT EXISTS (SELECT 1 FROM generation_jobs WHERE generation_jobs.deck_id = decks.id);

      DROP TABLE source_merge_map;
  `);
}

async function hasDuplicateSources(db: SQLite.SQLiteDatabase) {
  const row = await db.getFirstAsync<{ count: number }>(`
    SELECT COUNT(*) AS count
    FROM (
      SELECT sha256
      FROM sources
      WHERE deleted_at IS NULL
      GROUP BY sha256
      HAVING COUNT(*) > 1
    )
  `);

  return Number(row?.count ?? 0) > 0;
}

async function addColumnIfMissing(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
  definition: string,
) {
  const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);

  if (!columns.some((column) => column.name === columnName)) {
    await db.execAsync(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
    return true;
  }

  return false;
}

async function createIndexes(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_cards_deck_id ON cards(deck_id);
    CREATE INDEX IF NOT EXISTS idx_cards_note_id ON cards(note_id);
    CREATE INDEX IF NOT EXISTS idx_cards_active_deck ON cards(deleted_at, deck_id);
    CREATE INDEX IF NOT EXISTS idx_card_evidence_card_id ON card_evidence(card_id);
    CREATE INDEX IF NOT EXISTS idx_card_evidence_segment_id ON card_evidence(segment_id);
    CREATE INDEX IF NOT EXISTS idx_memory_states_due_at ON memory_states(due_at);
    CREATE INDEX IF NOT EXISTS idx_review_events_card_time ON review_events(card_id, reviewed_at);
    CREATE INDEX IF NOT EXISTS idx_source_segments_source_id ON source_segments(source_id);
    CREATE INDEX IF NOT EXISTS idx_sources_sha256 ON sources(sha256);
    CREATE INDEX IF NOT EXISTS idx_sources_default_deck ON sources(default_deck_id);
    CREATE INDEX IF NOT EXISTS idx_sources_visibility ON sources(deleted_at, archived_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_decks_visibility ON decks(deleted_at, archived_at, updated_at);
    CREATE INDEX IF NOT EXISTS idx_generation_jobs_source_id ON generation_jobs(source_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_card_learning_weak ON card_learning_state(is_suspended, weak_score DESC);
    CREATE INDEX IF NOT EXISTS idx_card_learning_buried ON card_learning_state(buried_until, is_suspended);
    CREATE INDEX IF NOT EXISTS idx_card_learning_leech ON card_learning_state(is_leech, lapse_count DESC);
    CREATE INDEX IF NOT EXISTS idx_card_learning_misconception ON card_learning_state(misconception_count DESC, last_confident_miss_at DESC);
    CREATE INDEX IF NOT EXISTS idx_test_sessions_created ON test_sessions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_test_responses_session ON test_responses(session_id, answered_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_test_responses_session_card ON test_responses(session_id, card_id);
    CREATE INDEX IF NOT EXISTS idx_generated_candidates_job_status ON generated_candidates(job_id, status);
    CREATE INDEX IF NOT EXISTS idx_sync_operations_status ON sync_operations(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_library_trash_active ON library_trash(restored_at, deleted_at);
    CREATE INDEX IF NOT EXISTS idx_course_modules_course ON course_modules(course_id, position);
    CREATE INDEX IF NOT EXISTS idx_module_decks_deck ON module_decks(deck_id);
    CREATE INDEX IF NOT EXISTS idx_study_sessions_active ON study_sessions(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_study_session_items_pending ON study_session_items(session_id, status, position);
  `);
}

async function ensureSearchIndex(db: SQLite.SQLiteDatabase) {
  try {
    await db.execAsync(`
      CREATE VIRTUAL TABLE IF NOT EXISTS cards_fts USING fts5(
        card_id UNINDEXED,
        deck_id UNINDEXED,
        prompt,
        answer,
        deck_title
      );
    `);
  } catch {
    // Some SQLite builds omit FTS5. Search falls back to LIKE queries.
  }
}

async function rebuildSearchIndexIfNeeded(db: SQLite.SQLiteDatabase) {
  const status = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_metadata WHERE key = ?',
    'cards_fts_built_v2',
  );

  if (status?.value === 'true') {
    return;
  }

  await ensureSearchIndex(db);
  await rebuildSearchIndex(db);
  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES (?, ?)`,
    'cards_fts_built_v2',
    'true',
  );
}

async function rebuildSearchIndex(db: SQLite.SQLiteDatabase) {
  try {
    await db.execAsync('DELETE FROM cards_fts;');
    await db.execAsync(`
      INSERT INTO cards_fts (card_id, deck_id, prompt, answer, deck_title)
      SELECT cards.id, cards.deck_id, cards.prompt, cards.answer, decks.title
      FROM cards
      JOIN decks ON decks.id = cards.deck_id;
    `);
  } catch {
    // Fallback search does not require an index.
  }
}
