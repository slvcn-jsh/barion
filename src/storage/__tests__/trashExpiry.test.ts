jest.mock('expo-sqlite', () => ({}));

import { purgeExpiredTrashItems } from '@/storage/repositories/trashRepository';
import type { WritableDatabase } from '@/storage/repositories/shared';

describe('purgeExpiredTrashItems', () => {
  it('purges items older than 30 days and leaves fresh trash items intact', async () => {
    const runAsync = jest.fn().mockResolvedValue({ changes: 1 });
    const getAllAsync = jest.fn().mockResolvedValue([
      {
        id: 'trash-old',
        entityType: 'deck',
        entityId: 'deck-1',
        metadataJson: JSON.stringify({ deckId: 'deck-1', cardIds: ['card-1'], noteIds: ['note-1'] }),
      },
    ]);
    const withExclusiveTransactionAsync = jest.fn().mockImplementation(async (cb) => cb({
      runAsync,
      getAllAsync,
      getFirstAsync: jest.fn(),
      execAsync: jest.fn(),
    }));

    const db = {
      runAsync,
      getAllAsync,
      withExclusiveTransactionAsync,
    } as unknown as WritableDatabase;

    const count = await purgeExpiredTrashItems(db, 30);
    expect(count).toBe(1);
    expect(getAllAsync).toHaveBeenCalledTimes(1);
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM cards'), ['card-1']);
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM notes'), ['note-1']);
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM decks'), 'deck-1');
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM library_trash WHERE id = ?'), 'trash-old');
  });

  it('returns 0 when no items are expired', async () => {
    const getAllAsync = jest.fn().mockResolvedValue([]);
    const db = {
      getAllAsync,
      withExclusiveTransactionAsync: jest.fn(),
    } as unknown as WritableDatabase;

    const count = await purgeExpiredTrashItems(db, 30);
    expect(count).toBe(0);
  });
});
