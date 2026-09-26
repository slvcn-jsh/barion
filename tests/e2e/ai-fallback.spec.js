const { expect, test } = require('@playwright/test');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');

const sourceText = `
Metformin reduces hepatic glucose production and improves peripheral insulin sensitivity.
Type 2 diabetes is characterized by insulin resistance and progressive beta-cell dysfunction.
Hypoglycemia presents with sweating, tremor, palpitations, and confusion.
Severe hypoglycemia is treated with rapid glucose administration when the patient can swallow safely.
`.trim();

test('remote gateway generation persists truthful provenance and produces a usable deck', async ({ page }, testInfo) => {
  let requestId;
  await page.route('http://127.0.0.1:8790/v1/card-generation', async (route) => {
    const gatewayRequest = route.request();
    expect(gatewayRequest.headers().authorization).toBe('Bearer e2e-test-token');
    const request = gatewayRequest.postDataJSON();
    expect(request.model).toBe('e2e-test-model');
    requestId = request.requestId;
    const prompt = JSON.parse(request.userPrompt);
    const evidenceText = 'Metformin reduces hepatic glucose production and improves peripheral insulin sensitivity.';
    const segment = prompt.segments.find((item) => item.text.includes(evidenceText));
    expect(segment).toBeTruthy();
    const answer = [
      'Answer: Metformin reduces hepatic glucose production.',
      'Why it matters: Metformin reduces hepatic glucose production.',
      'Study note: Metformin reduces hepatic glucose production.',
    ].join('\n');
    const question = 'How does metformin affect hepatic glucose production?';
    const learningObjective = 'Recall metformin action on hepatic glucose production.';
    const startOffset = segment.text.indexOf(evidenceText);
    const span = {
      version: '1.0.0',
      offsetEncoding: 'utf16-code-units',
      boundaryConvention: 'half-open',
      status: 'exact',
      startOffset,
      endOffset: startOffset + evidenceText.length,
      evidenceTextSha256: sha256(evidenceText),
      sourceTextSha256: sha256(segment.text),
      matchCount: 1,
    };
    const originalCandidate = {
      segmentId: segment.segmentId,
      locator: segment.locator,
      cardType: 'mechanism',
      question,
      answer,
      learningObjective,
      evidenceText,
      evidenceSpan: span,
    };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        requestId: 'gemini-request-1',
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        usage: { inputTokens: 120, outputTokens: 80 },
        output: {
          candidates: [{
            ...originalCandidate,
            evaluation: {
              contractVersion: '1.0.0',
              evaluationVersion: '2.0.0',
              policyVersion: '3.1.0',
              sourceSpan: span,
              evidenceSpanVerified: true,
              sourceClaimSupported: 'supported',
              citationStatus: 'exact',
              medicalRisk: 'low',
              medicalVerificationStatus: 'verification_not_required',
              pedagogyStatus: 'acceptable',
              publicationDisposition: 'PUBLISH',
              reasonCodes: [],
              validatorVersion: '1.1.0',
              originalCandidate,
              claimResults: [{
                claimId: 'claim-remote-1',
                field: 'core_answer',
                claimText: 'Metformin reduces hepatic glucose production.',
                claimType: 'factual',
                removable: false,
                riskLevel: 'low',
                requiresVerification: false,
                sourceSupport: 'supported_by_citation',
                sourceFidelity: 'fully_grounded',
                citationStatus: 'exact',
                verificationStatus: 'verification_not_required',
                supportingEvidence: [{
                  segmentId: segment.segmentId,
                  locator: segment.locator,
                  text: evidenceText,
                  tier: 'citation',
                }],
                contradictionEvidence: [],
                reasonCodes: [],
              }],
            },
          }],
        },
      }),
    });
  });

  await importSource(page, 'remote-ai.txt');
  await expect(page.getByText('Your study set is ready')).toBeVisible();
  await expect(page.getByText(/Created in basic mode/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start studying' })).toBeEnabled();
  const sourceUrl = page.url();

  const backup = await downloadBackup(page, testInfo, 'remote-ai');
  const job = backup.payload.tables.generation_jobs.find((row) => row.request_id === requestId);
  expect(job).toEqual(expect.objectContaining({
    generation_mode: 'REMOTE_AI',
    provider_id: 'gemini',
    model_id: 'gemini-2.5-flash',
    attempted_provider_id: 'barion-gateway',
    attempted_model_id: 'e2e-test-model',
    fallback_reason: null,
    failure_reason: null,
    remote_candidate_count: 1,
    published_card_count: 1,
    held_candidate_count: 0,
  }));
  expect(job.provider_request_id).toBe('gemini-request-1');
  expect(job.duration_ms).toBeGreaterThanOrEqual(0);

  await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Your study set is ready')).toBeVisible();
  await page.getByRole('button', { name: 'Start studying' }).click();
  await expect(page.getByText(/IN SESSION/i)).toBeVisible();
});

for (const scenario of [
  {
    name: 'malformed output',
    status: 200,
    body: {
      requestId: 'malformed-provider-request',
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      usage: { inputTokens: 12, outputTokens: 4 },
      output: { candidates: [{ evidenceText: 'invented' }] },
    },
    reason: 'invalid_provider_response',
    remoteCandidateCount: 1,
    providerRequestId: 'malformed-provider-request',
    attemptedProviderId: 'gemini',
    attemptedModelId: 'gemini-2.5-flash',
  },
  { name: 'provider failure', status: 503, body: { error: { code: 'provider_unavailable' } }, reason: 'provider_unavailable' },
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

    await importSource(page, `${scenario.name.replace(/\s+/g, '-')}.txt`);

    await expect(page.getByText('AUTOMATIC STUDY SET')).toBeVisible();
    await expect(page.getByText(/Created in basic mode because Smart Generation was unavailable/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start studying' })).toBeEnabled();
    await expect(page.getByText(new RegExp(scenario.reason, 'i'))).toHaveCount(0);
    const sourceUrl = page.url();

    const backup = await downloadBackup(page, testInfo, scenario.name.replace(/\s+/g, '-'));
    const job = backup.payload.tables.generation_jobs.find((row) => row.fallback_reason);
    expect(job).toEqual(expect.objectContaining({
      generation_mode: 'LOCAL_FALLBACK',
      provider_id: 'local-extractive',
      model_id: 'barion-extractive-rules',
      attempted_provider_id: scenario.attemptedProviderId ?? 'barion-gateway',
      attempted_model_id: scenario.attemptedModelId ?? 'e2e-test-model',
      prompt_id: 'extractive-rules',
      prompt_version: 'extractive-v1',
      fallback_reason: scenario.reason,
      failure_reason: null,
      remote_candidate_count: scenario.remoteCandidateCount ?? 0,
    }));
    expect(job.request_id).toBeTruthy();
    expect(job.provider_request_id).toBe(scenario.providerRequestId ?? null);
    expect(job.published_card_count).toBeGreaterThan(0);
    expect(job.duration_ms).toBeGreaterThanOrEqual(0);
    expect(backup.payload.tables.generated_candidates.length).toBeGreaterThan(0);

    await page.goto(sourceUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('AUTOMATIC STUDY SET')).toBeVisible();
    await page.getByRole('button', { name: 'Start studying' }).click();
    await expect(page.getByText(/IN SESSION/i)).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  });
}

async function importSource(page, filename) {
  await page.goto('/sources', { waitUntil: 'domcontentloaded' });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose a file' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(sourceText),
  });
}

async function downloadBackup(page, testInfo, name) {
  await page.goto('/data', { waitUntil: 'domcontentloaded' });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Create backup' }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath(`${name}.barion.json`);
  await download.saveAs(backupPath);
  return JSON.parse(await fs.readFile(backupPath, 'utf8'));
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
