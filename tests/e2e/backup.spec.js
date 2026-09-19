const { expect, test } = require('@playwright/test');
const fs = require('node:fs/promises');

test('creates, verifies, and safely merge-restores a full learning backup', async ({ page }, testInfo) => {
  const runtimeMessages = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') runtimeMessages.push(message.text());
  });
  page.on('pageerror', (error) => runtimeMessages.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/data');
  await expect(page.getByText('Your learning stays on this device.')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Create backup' }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath('barion-test-backup.barion.json');
  await download.saveAs(backupPath);

  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  expect(backup.format).toBe('barion-learning-backup');
  expect(backup.formatVersion).toBe(3);
  expect(backup.checksum.value).toMatch(/^[a-f0-9]{64}$/);
  expect(backup.payload.includesSourceFiles).toBe(false);
  expect(backup.payload.tables.cards.length).toBeGreaterThan(0);
  expect(backup.payload.tables.review_events).toBeDefined();
  expect(backup.payload.tables.study_activity_events).toBeDefined();
  expect(backup.payload.tables.card_mode_mastery).toBeDefined();
  expect(backup.payload.tables.study_blocks).toBeDefined();
  expect(backup.payload.tables.game_sessions).toBeDefined();
  expect(backup.payload.tables.source_study_guides).toBeDefined();
  expect(backup.payload.tables.sync_operations).toBeUndefined();
  expect(backup.payload.tables.sources.every((source) => source.local_uri.startsWith('backup://'))).toBe(true);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose backup to restore' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(backupPath);

  await expect(page.getByText('Backup verified')).toBeVisible();
  await page.getByRole('button', { name: 'Review merge' }).click();
  await expect(page.getByText('Add this backup to this device?')).toBeVisible();
  await page.getByRole('button', { name: 'Merge backup' }).click();
  await expect(page.getByText(/Last restore/)).toBeVisible();

  expect(runtimeMessages).toEqual([]);
});
