export const BARION_BACKUP_FORMAT = 'barion-learning-backup';
export const BARION_BACKUP_VERSION = 4;
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_ROWS = 250_000;

export const backupTableNames = [
  'courses',
  'decks',
  'course_modules',
  'module_decks',
  'sources',
  'source_segments',
  'source_study_guides',
  'notes',
  'cards',
  'card_evidence',
  'memory_states',
  'card_learning_state',
  'card_mode_mastery',
  'card_quality',
  'generation_jobs',
  'generated_candidates',
  'study_profiles',
  'study_sessions',
  'study_session_items',
  'study_activity_events',
  'study_blocks',
  'game_sessions',
  'game_events',
  'review_events',
  'test_sessions',
  'test_responses',
  'library_trash',
  'bari_conversations',
  'bari_messages',
] as const;

const VERSION_TWO_TABLES = new Set([
  'card_mode_mastery',
  'study_activity_events',
  'study_blocks',
  'game_sessions',
  'game_events',
]);

const VERSION_THREE_TABLES = new Set([
  'source_study_guides',
]);

const VERSION_FOUR_TABLES = new Set([
  'bari_conversations',
  'bari_messages',
]);

export type BackupTableName = (typeof backupTableNames)[number];
export type BackupScalar = string | number | boolean | null;
export type BackupRow = Record<string, BackupScalar>;
export type BackupTables = Record<BackupTableName, BackupRow[]>;

export type BackupSummary = {
  courseCount: number;
  folderCount: number;
  deckCount: number;
  sourceCount: number;
  cardCount: number;
  reviewCount: number;
  testCount: number;
  totalRows: number;
};

export type BarionBackupPayload = {
  app: 'barion';
  schemaVersion: number;
  exportedAt: string;
  includesSourceFiles: false;
  tables: BackupTables;
};

export type BarionBackupEnvelope = {
  format: typeof BARION_BACKUP_FORMAT;
  formatVersion: typeof BARION_BACKUP_VERSION;
  checksum: {
    algorithm: 'SHA-256';
    value: string;
  };
  payload: BarionBackupPayload;
};

export function parseBackupEnvelope(serialized: string): BarionBackupEnvelope {
  if (!serialized.trim()) throw new Error('This backup file is empty.');
  if (new TextEncoder().encode(serialized).byteLength > MAX_BACKUP_BYTES) {
    throw new Error('This backup is larger than the 50 MB safety limit.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('This is not a readable Barion backup file.');
  }

  if (!isRecord(parsed) || parsed.format !== BARION_BACKUP_FORMAT) {
    throw new Error('This file was not created by Barion backup.');
  }
  const sourceFormatVersion = Number(parsed.formatVersion);
  if (sourceFormatVersion < 1 || sourceFormatVersion > BARION_BACKUP_VERSION) {
    throw new Error(`Barion cannot restore backup format version ${String(parsed.formatVersion)}.`);
  }
  if (!isRecord(parsed.checksum) || parsed.checksum.algorithm !== 'SHA-256' || !isSha256(parsed.checksum.value)) {
    throw new Error('The backup is missing its integrity check.');
  }
  if (!isRecord(parsed.payload)) throw new Error('The backup content is missing.');

  const payload = parsed.payload;
  if (payload.app !== 'barion' || !Number.isInteger(payload.schemaVersion) || Number(payload.schemaVersion) < 1) {
    throw new Error('The backup has invalid Barion version information.');
  }
  if (typeof payload.exportedAt !== 'string' || Number.isNaN(Date.parse(payload.exportedAt))) {
    throw new Error('The backup export date is invalid.');
  }
  if (payload.includesSourceFiles !== false || !isRecord(payload.tables)) {
    throw new Error('The backup content has an unsupported structure.');
  }

  let totalRows = 0;
  const tables = {} as BackupTables;
  for (const tableName of backupTableNames) {
    const storedRows = payload.tables[tableName];
    const rows = sourceFormatVersion === 1 && storedRows === undefined && VERSION_TWO_TABLES.has(tableName)
      ? []
      : sourceFormatVersion < 3 && storedRows === undefined && VERSION_THREE_TABLES.has(tableName)
      ? []
      : sourceFormatVersion < 4 && storedRows === undefined && VERSION_FOUR_TABLES.has(tableName)
      ? []
      : storedRows;
    if (!Array.isArray(rows)) throw new Error(`The backup is missing ${tableName}.`);
    totalRows += rows.length;
    if (totalRows > MAX_BACKUP_ROWS) throw new Error('This backup contains too many records to restore safely.');
    if (!rows.every(isBackupRow)) throw new Error(`The ${tableName} data is damaged or unsupported.`);
    tables[tableName] = rows;
  }

  return {
    format: BARION_BACKUP_FORMAT,
    formatVersion: BARION_BACKUP_VERSION,
    checksum: { algorithm: 'SHA-256', value: parsed.checksum.value },
    payload: {
      app: 'barion',
      schemaVersion: Number(payload.schemaVersion),
      exportedAt: payload.exportedAt,
      includesSourceFiles: false,
      tables,
    },
  };
}

export function summarizeBackupTables(tables: BackupTables): BackupSummary {
  return {
    courseCount: tables.courses.length,
    folderCount: tables.course_modules.length,
    deckCount: tables.decks.length,
    sourceCount: tables.sources.length,
    cardCount: tables.cards.length,
    reviewCount: tables.review_events.length,
    testCount: tables.test_sessions.length,
    totalRows: backupTableNames.reduce((total, tableName) => total + tables[tableName].length, 0),
  };
}

export function payloadForChecksum(payload: BarionBackupPayload) {
  return JSON.stringify(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBackupRow(value: unknown): value is BackupRow {
  return isRecord(value) && Object.values(value).every(isBackupScalar);
}

function isBackupScalar(value: unknown): value is BackupScalar {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}
