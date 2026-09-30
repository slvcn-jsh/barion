jest.mock('@/storage/database', () => ({
  getDatabase: jest.fn(),
}));

import { Platform } from 'react-native';
import { runWriteTransaction } from '@/storage/repositories/shared';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createWebDatabase() {
  let inTransaction = false;
  const events: string[] = [];
  const transaction = jest.fn(async (task: () => Promise<void>) => {
    if (inTransaction) {
      throw new Error('cannot start a transaction within a transaction');
    }
    inTransaction = true;
    events.push('BEGIN');
    try {
      await task();
      events.push('COMMIT');
    } catch (error) {
      events.push('ROLLBACK');
      throw error;
    } finally {
      inTransaction = false;
    }
  });
  const db = {
    isInTransactionSync: () => inTransaction,
    withTransactionAsync: transaction,
    withExclusiveTransactionAsync: transaction,
  };
  return { db, events };
}

describe('web write transaction coordination', () => {
  beforeAll(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'web' });
  });

  it('serializes remote candidate publication behind an overlapping baseline write', async () => {
    const { db, events } = createWebDatabase();
    const baselineStarted = deferred();
    const releaseBaseline = deferred();
    const publishedCandidates: number[] = [];

    const baselineWrite = runWriteTransaction(db as never, async () => {
      events.push('LOCAL_WRITE_STARTED');
      baselineStarted.resolve();
      await releaseBaseline.promise;
      events.push('LOCAL_WRITE_FINISHED');
    });
    await baselineStarted.promise;

    const remoteCandidates = Array.from({ length: 60 }, (_, index) => index + 1);
    const remotePublication = runWriteTransaction(db as never, async () => {
      events.push('REMOTE_WRITE_STARTED');
      publishedCandidates.push(...remoteCandidates);
      events.push('REMOTE_WRITE_FINISHED');
    });

    await Promise.resolve();
    expect(events).not.toContain('REMOTE_WRITE_STARTED');
    releaseBaseline.resolve();
    await Promise.all([baselineWrite, remotePublication]);

    expect(publishedCandidates).toHaveLength(60);
    expect(events).toEqual([
      'BEGIN',
      'LOCAL_WRITE_STARTED',
      'LOCAL_WRITE_FINISHED',
      'COMMIT',
      'BEGIN',
      'REMOTE_WRITE_STARTED',
      'REMOTE_WRITE_FINISHED',
      'COMMIT',
    ]);
  });

  it('continues the queue after a transaction rolls back', async () => {
    const { db, events } = createWebDatabase();

    await expect(runWriteTransaction(db as never, async () => {
      events.push('FAILED_WRITE_STARTED');
      throw new Error('write failed');
    })).rejects.toThrow('write failed');

    await runWriteTransaction(db as never, async () => {
      events.push('RECOVERY_WRITE');
    });

    expect(events).toEqual([
      'BEGIN',
      'FAILED_WRITE_STARTED',
      'ROLLBACK',
      'BEGIN',
      'RECOVERY_WRITE',
      'COMMIT',
    ]);
  });
});
