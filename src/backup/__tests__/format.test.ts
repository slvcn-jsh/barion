import {
  BARION_BACKUP_FORMAT,
  BARION_BACKUP_VERSION,
  backupTableNames,
  parseBackupEnvelope,
  summarizeBackupTables,
  type BackupTables,
} from '@/backup/format';

function emptyTables(): BackupTables {
  return Object.fromEntries(backupTableNames.map((name) => [name, []])) as unknown as BackupTables;
}

function validBackup() {
  return {
    format: BARION_BACKUP_FORMAT,
    formatVersion: BARION_BACKUP_VERSION,
    checksum: { algorithm: 'SHA-256', value: 'a'.repeat(64) },
    payload: {
      app: 'barion',
      schemaVersion: 12,
      exportedAt: '2026-09-15T08:00:00.000Z',
      includesSourceFiles: false,
      tables: emptyTables(),
    },
  };
}

describe('Barion backup format', () => {
  it('parses a complete versioned backup and summarizes durable learning data', () => {
    const backup = validBackup();
    backup.payload.tables.courses.push({ id: 'course-1', title: 'Medicine' });
    backup.payload.tables.course_modules.push({ id: 'module-1', course_id: 'course-1' });
    backup.payload.tables.decks.push({ id: 'deck-1', title: 'Cardiology' });
    backup.payload.tables.cards.push({ id: 'card-1', prompt: 'What is preload?' });
    backup.payload.tables.review_events.push({ id: 'review-1', card_id: 'card-1' });

    const parsed = parseBackupEnvelope(JSON.stringify(backup));
    expect(summarizeBackupTables(parsed.payload.tables)).toMatchObject({
      courseCount: 1,
      folderCount: 1,
      deckCount: 1,
      cardCount: 1,
      reviewCount: 1,
    });
  });

  it('rejects arbitrary JSON and incomplete table data', () => {
    expect(() => parseBackupEnvelope('{}')).toThrow('not created by Barion');

    const backup = validBackup();
    delete (backup.payload.tables as Partial<BackupTables>).cards;
    expect(() => parseBackupEnvelope(JSON.stringify(backup))).toThrow('missing cards');
  });

  it('rejects non-scalar database values', () => {
    const backup = validBackup();
    backup.payload.tables.cards.push({ id: 'card-1', prompt: ['unsafe'] } as never);
    expect(() => parseBackupEnvelope(JSON.stringify(backup))).toThrow('cards data is damaged');
  });

  it('upgrades version-one backups with empty study-engine tables', () => {
    const backup = validBackup();
    backup.formatVersion = 1 as typeof BARION_BACKUP_VERSION;
    delete (backup.payload.tables as Partial<BackupTables>).card_mode_mastery;
    delete (backup.payload.tables as Partial<BackupTables>).study_activity_events;
    delete (backup.payload.tables as Partial<BackupTables>).study_blocks;
    delete (backup.payload.tables as Partial<BackupTables>).source_study_guides;

    const parsed = parseBackupEnvelope(JSON.stringify(backup));
    expect(parsed.payload.tables.card_mode_mastery).toEqual([]);
    expect(parsed.payload.tables.study_activity_events).toEqual([]);
    expect(parsed.payload.tables.study_blocks).toEqual([]);
    expect(parsed.payload.tables.source_study_guides).toEqual([]);
  });

  it('upgrades version-two backups with empty source study guides', () => {
    const backup = validBackup();
    backup.formatVersion = 2 as typeof BARION_BACKUP_VERSION;
    delete (backup.payload.tables as Partial<BackupTables>).source_study_guides;

    const parsed = parseBackupEnvelope(JSON.stringify(backup));
    expect(parsed.payload.tables.source_study_guides).toEqual([]);
  });

  it('upgrades version-three backups with empty bari conversation tables', () => {
    const backup = validBackup();
    backup.formatVersion = 3 as typeof BARION_BACKUP_VERSION;
    delete (backup.payload.tables as Partial<BackupTables>).bari_conversations;
    delete (backup.payload.tables as Partial<BackupTables>).bari_messages;

    const parsed = parseBackupEnvelope(JSON.stringify(backup));
    expect(parsed.payload.tables.bari_conversations).toEqual([]);
    expect(parsed.payload.tables.bari_messages).toEqual([]);
  });
});
