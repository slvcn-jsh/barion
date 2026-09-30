import type * as SQLite from 'expo-sqlite';

jest.mock('expo-sqlite', () => ({}));

import {
  normalizeGenerationJobProvenance,
  recoverInterruptedGenerationJobs,
  retireLegacyPendingCandidates,
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
    expect(sql).toContain("generated_candidates.status = 'pending'");
  });

  it('queues interrupted running work with safe retryable source state', async () => {
    const execAsync = jest.fn().mockResolvedValue(undefined);
    const runAsync = jest.fn().mockResolvedValue({ changes: 1 });
    const db = { execAsync, runAsync } as unknown as SQLite.SQLiteDatabase;

    await recoverInterruptedGenerationJobs(db);

    expect(runAsync).toHaveBeenCalledTimes(2);
    const sourceRecoverySql = String(runAsync.mock.calls[0]?.[0]);
    const jobRecoverySql = String(runAsync.mock.calls[1]?.[0]);
    expect(sourceRecoverySql).toContain("THEN 'generating'");
    expect(sourceRecoverySql).toContain("ELSE 'waiting-for-generation'");
    expect(sourceRecoverySql).toContain("= 'local-baseline'");
    expect(sourceRecoverySql).toContain('Initial card preparation was interrupted');
    expect(sourceRecoverySql).toContain('safely queued for Smart Generation');
    expect(sourceRecoverySql).toContain('latest_generation_jobs');
    expect(jobRecoverySql).toContain("status = 'queued'");
    expect(jobRecoverySql).toContain("WHEN purpose = 'local-baseline'");
    expect(jobRecoverySql).toContain('resume initial source-matched card generation');
    expect(jobRecoverySql).toContain('next_attempt_at');
    expect(jobRecoverySql).toContain("failure_reason = 'interrupted'");
    expect(execAsync).toHaveBeenCalledTimes(1);
  });

  it('retires old manual-review queues without publishing uncertain candidates', async () => {
    const execAsync = jest.fn().mockResolvedValue(undefined);
    const db = { execAsync } as unknown as SQLite.SQLiteDatabase;

    await retireLegacyPendingCandidates(db);

    const sql = String(execAsync.mock.calls[0]?.[0]);
    expect(sql).toContain("SET status = 'rejected'");
    expect(sql).toContain("status = 'awaiting-review'");
    expect(sql).toContain("cards.status IN ('verified', 'source_extracted')");
    expect(sql).not.toContain("SET status = 'approved'");
  });
});
