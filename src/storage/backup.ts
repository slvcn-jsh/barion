import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

import {
  BARION_BACKUP_FORMAT,
  BARION_BACKUP_VERSION,
  backupTableNames,
  parseBackupEnvelope,
  payloadForChecksum,
  summarizeBackupTables,
  type BackupRow,
  type BackupSummary,
  type BackupTableName,
  type BackupTables,
  type BarionBackupEnvelope,
  type BarionBackupPayload,
} from '@/backup/format';
import { DATABASE_VERSION, getDatabase, initializeDatabase, refreshSearchIndex } from '@/storage/database';

export type OfflineDataSummary = {
  courseCount: number;
  deckCount: number;
  sourceCount: number;
  cardCount: number;
  reviewCount: number;
  testCount: number;
  pendingSyncCount: number;
  deviceFileCount: number;
  recoveredSourceCount: number;
  lastBackupAt: string | null;
  lastRestoreAt: string | null;
};

export type CreatedBackup = {
  filename: string;
  serialized: string;
  summary: BackupSummary;
  exportedAt: string;
};

export type InspectedBackup = {
  envelope: BarionBackupEnvelope;
  summary: BackupSummary;
};

export type RestoreResult = {
  insertedCount: number;
  skippedCount: number;
  summary: BackupSummary;
};

export async function getOfflineDataSummary(): Promise<OfflineDataSummary> {
  await initializeDatabase();
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    courseCount: number;
    deckCount: number;
    sourceCount: number;
    cardCount: number;
    reviewCount: number;
    testCount: number;
    pendingSyncCount: number;
    deviceFileCount: number;
    recoveredSourceCount: number;
    lastBackupAt: string | null;
    lastRestoreAt: string | null;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM courses WHERE deleted_at IS NULL) AS courseCount,
      (SELECT COUNT(*) FROM decks WHERE deleted_at IS NULL) AS deckCount,
      (SELECT COUNT(*) FROM sources WHERE deleted_at IS NULL) AS sourceCount,
      (SELECT COUNT(*) FROM cards WHERE deleted_at IS NULL) AS cardCount,
      (SELECT COUNT(*) FROM review_events) AS reviewCount,
      (SELECT COUNT(*) FROM test_sessions) AS testCount,
      (SELECT COUNT(*) FROM sync_operations WHERE status IN ('pending', 'local-only')) AS pendingSyncCount,
      (SELECT COUNT(*) FROM sources
       WHERE deleted_at IS NULL
         AND local_uri NOT LIKE 'seed:%'
         AND local_uri NOT LIKE 'backup:%') AS deviceFileCount,
      (SELECT COUNT(*) FROM sources
       WHERE deleted_at IS NULL AND local_uri LIKE 'backup:%') AS recoveredSourceCount,
      (SELECT value FROM app_metadata WHERE key = 'last_backup_at') AS lastBackupAt,
      (SELECT value FROM app_metadata WHERE key = 'last_restore_at') AS lastRestoreAt
  `);

  return {
    courseCount: Number(row?.courseCount ?? 0),
    deckCount: Number(row?.deckCount ?? 0),
    sourceCount: Number(row?.sourceCount ?? 0),
    cardCount: Number(row?.cardCount ?? 0),
    reviewCount: Number(row?.reviewCount ?? 0),
    testCount: Number(row?.testCount ?? 0),
    pendingSyncCount: Number(row?.pendingSyncCount ?? 0),
    deviceFileCount: Number(row?.deviceFileCount ?? 0),
    recoveredSourceCount: Number(row?.recoveredSourceCount ?? 0),
    lastBackupAt: row?.lastBackupAt ?? null,
    lastRestoreAt: row?.lastRestoreAt ?? null,
  };
}

export async function createBarionBackup(): Promise<CreatedBackup> {
  await initializeDatabase();
  const db = await getDatabase();
  const tables = {} as BackupTables;

  for (const tableName of backupTableNames) {
    const rows = await db.getAllAsync<BackupRow>(`SELECT * FROM ${tableName}`);
    tables[tableName] = rows.map((row) => sanitizeExportRow(tableName, row));
  }

  const exportedAt = new Date().toISOString();
  const payload: BarionBackupPayload = {
    app: 'barion',
    schemaVersion: DATABASE_VERSION,
    exportedAt,
    includesSourceFiles: false,
    tables,
  };
  const checksum = await checksumPayload(payload);
  const envelope: BarionBackupEnvelope = {
    format: BARION_BACKUP_FORMAT,
    formatVersion: BARION_BACKUP_VERSION,
    checksum: { algorithm: 'SHA-256', value: checksum },
    payload,
  };

  await db.runAsync(
    `INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('last_backup_at', ?)`,
    exportedAt,
  );

  return {
    filename: `barion-backup-${exportedAt.slice(0, 10)}.barion.json`,
    serialized: JSON.stringify(envelope),
    summary: summarizeBackupTables(tables),
    exportedAt,
  };
}

export async function inspectBarionBackup(serialized: string): Promise<InspectedBackup> {
  const envelope = parseBackupEnvelope(serialized);
  if (envelope.payload.schemaVersion > DATABASE_VERSION) {
    throw new Error('This backup was created by a newer Barion version. Update Barion before restoring it.');
  }

  const expected = await checksumPayload(envelope.payload);
  if (expected.toLowerCase() !== envelope.checksum.value.toLowerCase()) {
    throw new Error('The backup integrity check failed. The file may be incomplete or changed.');
  }

  return { envelope, summary: summarizeBackupTables(envelope.payload.tables) };
}

export async function restoreBarionBackup(serialized: string): Promise<RestoreResult> {
  const inspected = await inspectBarionBackup(serialized);
  await initializeDatabase();
  const db = await getDatabase();
  const columnsByTable = new Map<BackupTableName, string[]>();

  for (const tableName of backupTableNames) {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${tableName})`);
    columnsByTable.set(tableName, columns.map((column) => column.name));
  }

  let insertedCount = 0;
  let skippedCount = 0;

  await runWriteTransaction(db, async (txn) => {
    for (const tableName of backupTableNames) {
      const allowedColumns = columnsByTable.get(tableName) ?? [];
      for (const row of inspected.envelope.payload.tables[tableName]) {
        const entries = allowedColumns
          .filter((column) => Object.prototype.hasOwnProperty.call(row, column))
          .map((column) => [column, row[column]] as const);

        if (!entries.length) throw new Error(`The ${tableName} backup rows do not match this Barion version.`);

        const columnSql = entries.map(([column]) => column).join(', ');
        const placeholders = entries.map(() => '?').join(', ');
        const values = entries.map(([, value]) => value as SQLite.SQLiteBindValue);
        const conflictSql = tableName === 'study_profiles'
          ? buildStudyProfileConflict(entries.map(([column]) => column))
          : 'DO NOTHING';
        const result = await txn.runAsync(
          `INSERT INTO ${tableName} (${columnSql}) VALUES (${placeholders}) ON CONFLICT ${conflictSql}`,
          values,
        );

        if (result.changes > 0) insertedCount += result.changes;
        else skippedCount += 1;
      }
    }

    const restoredAt = new Date().toISOString();
    await txn.runAsync(
      `INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('last_restore_at', ?)`,
      restoredAt,
    );
    await txn.runAsync(
      `INSERT OR REPLACE INTO app_metadata (key, value) VALUES ('last_restore_inserted_count', ?)`,
      String(insertedCount),
    );
  });

  await refreshSearchIndex();
  return { insertedCount, skippedCount, summary: inspected.summary };
}

function sanitizeExportRow(tableName: BackupTableName, row: BackupRow): BackupRow {
  if (tableName !== 'sources') return row;

  return {
    ...row,
    local_uri: `backup://source/${String(row.id ?? 'unknown')}`,
  };
}

function buildStudyProfileConflict(columns: string[]) {
  const updatable = columns.filter((column) => column !== 'id');
  if (!updatable.length) return 'DO NOTHING';
  const assignments = updatable.map((column) => `${column} = excluded.${column}`).join(', ');
  return `(id) DO UPDATE SET ${assignments}
    WHERE excluded.updated_at >= study_profiles.updated_at`;
}

async function checksumPayload(payload: BarionBackupPayload) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    payloadForChecksum(payload),
  );
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
