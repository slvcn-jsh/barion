import type * as SQLite from 'expo-sqlite';

jest.mock('expo-sqlite', () => ({}));

import {
  normalizeGenerationJobProvenance,
  recoverInterruptedGenerationJobs,
} from '@/storage/database';

describe('generation job provenance recovery', () => {
  it('normalizes restored legacy failures without relabeling them as remote or fallback success', async () => {
    const execAsync = jest.fn().mockResolvedValue(undefined);
    const db = { execAsync } as unknown as SQLite.SQLiteDatabase;

    await normalizeGenerationJobProvenance(db);

    const sql = String(execAsync.mock.calls[0]?.[0]);
    expect(sql).toContain("WHEN status = 'failed' THEN 'FAILED'");
    expect(sql).toContain("provider_id = 'local-extractive' THEN 1");
    expect(sql).toContain('WHEN remote_candidate_count > 0 THEN remote_candidate_count');
    expect(sql).toContain('published_card_id');
    expect(sql).toContain("generated_candidates.status = 'approved'");
    expect(sql).toContain("generated_candidates.status <> 'approved'");
  });

  it('marks interrupted running work failed with safe retryable source state', async () => {
    const execAsync = jest.fn().mockResolvedValue(undefined);
    const runAsync = jest.fn().mockResolvedValue({ changes: 1 });
    const db = { execAsync, runAsync } as unknown as SQLite.SQLiteDatabase;

    await recoverInterruptedGenerationJobs(db);

    expect(runAsync).toHaveBeenCalledTimes(2);
    const sourceRecoverySql = String(runAsync.mock.calls[0]?.[0]);
    const jobRecoverySql = String(runAsync.mock.calls[1]?.[0]);
    expect(sourceRecoverySql).toContain("status = 'failed'");
    expect(sourceRecoverySql).toContain('Deck preparation was interrupted. Try again.');
    expect(sourceRecoverySql).toContain('latest_generation_jobs');
    expect(jobRecoverySql).toContain("generation_mode = 'FAILED'");
    expect(jobRecoverySql).toContain("failure_reason = 'interrupted'");
    expect(execAsync).toHaveBeenCalledTimes(1);
  });
});
