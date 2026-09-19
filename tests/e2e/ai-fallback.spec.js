const { expect, test } = require('@playwright/test');
const fs = require('node:fs/promises');

const sourceText = `
Metformin reduces hepatic glucose production and improves peripheral insulin sensitivity.
Type 2 diabetes is characterized by insulin resistance and progressive beta-cell dysfunction.
Hypoglycemia presents with sweating, tremor, palpitations, and confusion.
Severe hypoglycemia is treated with rapid glucose administration when the patient can swallow safely.
`.trim();

for (const scenario of [
  { name: 'malformed output', status: 200, body: { output: { candidates: [{ evidenceText: 'invented' }] } }, reason: 'invalid_provider_response' },
  { name: 'provider failure', status: 503, body: { error: { code: 'provider_unavailable' } }, reason: 'model_unavailable' },
  { name: 'provider timeout', status: 504, body: { error: { code: 'provider_timeout' } }, reason: 'timeout_error' },
  { name: 'request too large', status: 413, body: { error: { code: 'request_too_large' } }, reason: 'request_too_large' },
  { name: 'rate limit', status: 429, body: { error: { code: 'rate_limited' } }, reason: 'rate_limited' },
]) {
  test(`source import persists local fallback after ${scenario.name}`, async ({ page }, testInfo) => {
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
        runtimeErrors.push(message.text());
      }
    });

    await page.route('http://127.0.0.1:8790/v1/card-generation', async (route) => {
      await route.fulfill({
        status: scenario.status,
        contentType: 'application/json',
        body: JSON.stringify(scenario.body),
      });
    });

    await page.goto('/sources', { waitUntil: 'domcontentloaded' });
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose a file' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: `${scenario.name.replace(/\s+/g, '-')}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(sourceText),
    });

    await expect(page.getByText('AUTOMATIC STUDY SET')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start studying' })).toBeEnabled();

    await page.goto('/data', { waitUntil: 'domcontentloaded' });
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Create backup' }).click();
    const download = await downloadPromise;
    const backupPath = testInfo.outputPath(`${scenario.name.replace(/\s+/g, '-')}.barion.json`);
    await download.saveAs(backupPath);
    const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
    const job = backup.payload.tables.generation_jobs.find((row) => row.fallback_reason);
    expect(job).toEqual(expect.objectContaining({
      provider_id: 'local-extractive',
      model_id: 'barion-extractive-rules',
      prompt_id: 'extractive-rules',
      prompt_version: 'extractive-v1',
      fallback_reason: scenario.reason,
    }));
    expect(job.request_id).toBeTruthy();
    expect(backup.payload.tables.generated_candidates.length).toBeGreaterThan(0);

    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('AUTOMATIC STUDY SET')).toBeVisible();
    await page.getByRole('button', { name: 'Start studying' }).click();
    await expect(page.getByText(/IN SESSION/i)).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  });
}
