const { expect, test } = require('@playwright/test');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');

const sourceText = `
The heart has four chambers: two atria and two ventricles.
The right ventricle pumps deoxygenated blood to the lungs through the pulmonary artery.
The left ventricle pumps oxygenated blood to the body through the aorta.
Heart valves prevent backward blood flow.
The sinoatrial node initiates the normal heartbeat and is called the natural pacemaker.
Systole is ventricular contraction, while diastole is ventricular relaxation and filling.
`.trim();

const sixtyCandidateSourceText = Array.from({ length: 20 }, (_, index) => `
Clinical concept ${String(index + 1).padStart(2, '0')} is a distinct study finding used for source-grounded recall practice.
Reliable learning marker ${String(index + 1).padStart(2, '0')} depends on repeated active recall practice.
`.trim()).join('\n\n');

test.describe('local-first card generation', () => {
  test('keeps local deck usable while automatic Smart Enhancement is pending', async ({ page }, testInfo) => {
    let gatewayRequestCount = 0;
    let releaseGateway;
    let markGatewayStarted;
    const gatewayRelease = new Promise((resolve) => { releaseGateway = resolve; });
    const gatewayStarted = new Promise((resolve) => { markGatewayStarted = resolve; });
    const runtimeErrors = collectRuntimeErrors(page);
    await page.route('http://127.0.0.1:8790/v1/card-generation', async (route) => {
      gatewayRequestCount += 1;
      markGatewayStarted();
      await gatewayRelease;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'provider_unavailable', recoverable: true } }),
      });
    });

    await importSource(page, 'local-first-baseline.txt');
    await gatewayStarted;

    await expect(page.getByText('BARI AI IMPROVING CARDS', { exact: true })).toBeVisible();
    await expect(page.getByText(/source-matched cards? in this set/)).toBeVisible();
    releaseGateway();
    await expect(page.getByText(/Automatic retry scheduled/)).toBeVisible();
    await expect(page.getByText('READY TO REVIEW', { exact: true })).toBeVisible();
    expect(gatewayRequestCount).toBe(1);

    const backup = await downloadBackup(page, testInfo, 'local-first-baseline');
    const localJob = latestGenerationJob(backup, (job) => job.generation_mode === 'LOCAL_BASELINE');
    expect(localJob).toEqual(expect.objectContaining({
      status: 'completed',
      generation_mode: 'LOCAL_BASELINE',
      provider_id: 'local-extractive',
      model_id: 'barion-extractive-rules',
      failure_reason: null,
      remote_candidate_count: 0,
      held_candidate_count: 0,
    }));
    expect(localJob.published_card_count).toBeGreaterThan(0);

    await page.goBack();
    await expect(page.getByText(/source-matched cards? in this set/)).toBeVisible();
    await page.getByRole('button', { name: /Browse all/ }).click();
    await expect(page.getByText(/in session/i)).toBeVisible();
    await page.getByRole('button', { name: 'Reveal', exact: true }).click();
    await expect(page.getByRole('button', { name: /Next card|Finish browsing/ })).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  });

  test('keeps local cards ready when optional Smart Generation is rate limited', async ({ page }, testInfo) => {
    const runtimeErrors = collectRuntimeErrors(page);
    let gatewayRequestCount = 0;
    await page.route('http://127.0.0.1:8790/v1/card-generation', async (route) => {
      gatewayRequestCount += 1;
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'rate_limited' } }),
      });
    });

    await importSource(page, 'local-first-rate-limit.txt');
    await expect(page.getByText('READY TO REVIEW', { exact: true })).toBeVisible();
    const cardsBeforeEnhancement = await sourceCardCount(page);

    await expect(page.getByText(/Automatic retry scheduled/)).toBeVisible();
    await expect(page.getByText(/source-matched cards? in this set/)).toBeVisible();
    await expect(page.getByText(/remain available/)).toBeVisible();
    await expect(page.getByText(/rate_limited|RESOURCE_EXHAUSTED|HTTP 429/i)).toHaveCount(0);
    expect(await sourceCardCount(page)).toBe(cardsBeforeEnhancement);
    expect(gatewayRequestCount).toBeGreaterThan(0);

    const backup = await downloadBackup(page, testInfo, 'local-first-rate-limit');
    const queuedJob = latestGenerationJob(backup, (job) => job.status === 'queued' && job.failure_reason === 'rate_limited');
    expect(queuedJob).toEqual(expect.objectContaining({
      status: 'queued',
      provider_id: 'barion-gateway',
      attempted_provider_id: 'barion-gateway',
      attempted_model_id: 'e2e-test-model',
      published_card_count: 0,
      held_candidate_count: 0,
      failure_reason: 'rate_limited',
    }));
    expect(queuedJob.next_attempt_at).toBeTruthy();
    expect(runtimeErrors).toEqual([]);
  });

  test('persists a 60-candidate Smart Generation result without a nested transaction', async ({ page }, testInfo) => {
    const runtimeErrors = collectRuntimeErrors(page);
    let gatewayRequestCount = 0;
    let markSixRequests;
    const sixRequests = new Promise((resolve) => { markSixRequests = resolve; });
    await page.route('http://127.0.0.1:8790/v1/card-generation', async (route) => {
      gatewayRequestCount += 1;
      if (gatewayRequestCount === 6) markSixRequests();
      const requestBody = route.request().postDataJSON();
      const promptPayload = JSON.parse(requestBody.userPrompt);
      const requestedCount = String(requestBody.requestId).endsWith('-repair-smart-repair')
        ? 2
        : requestBody.maxCandidates;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          requestId: `gateway-request-${gatewayRequestCount}`,
          provider: 'gemini',
          model: 'e2e-test-model',
          output: {
            candidates: createGroundedCandidates(promptPayload.segments, requestedCount, gatewayRequestCount),
          },
          usage: { inputTokens: 1_000, outputTokens: 2_000 },
        }),
      });
    });

    const startedAt = Date.now();
    await importSource(page, 'smart-generation-60.txt', sixtyCandidateSourceText);
    await sixRequests;
    await expect(page.getByText('READY TO REVIEW', { exact: true })).toBeVisible({ timeout: 30_000 });

    const refreshButton = page.getByRole('button', { name: 'Refresh from source' });
    await refreshButton.click();
    await expect(refreshButton).toBeEnabled();

    const backup = await downloadBackup(page, testInfo, 'smart-generation-60');
    const remoteJob = latestGenerationJob(backup, (job) => job.generation_mode === 'REMOTE_AI');
    const remoteCandidates = backup.payload.tables.generated_candidates
      .filter((candidate) => candidate.job_id === remoteJob.id);
    const batchMetadata = JSON.parse(remoteJob.batch_metadata_json);

    expect(gatewayRequestCount).toBe(6);
    expect(remoteJob).toEqual(expect.objectContaining({
      status: 'completed',
      generation_mode: 'REMOTE_AI',
      purpose: 'smart-enhancement',
      remote_candidate_count: 60,
      failure_reason: null,
    }));
    expect(remoteJob.generation_key).toContain(':smart-enhancement:grounded-card-generation:1.4.0');
    expect(remoteJob.attempt_count).toBe(1);
    expect(remoteCandidates).toHaveLength(60);
    expect(remoteJob.published_card_count).toBeGreaterThan(0);
    expect(batchMetadata.selection).toEqual(expect.objectContaining({
      rawCandidateCount: 60,
      remoteCandidateCount: 60,
    }));
    expect(Date.now() - startedAt).toBeLessThan(30_000);
    expect(runtimeErrors).toEqual([]);
  });
});

function collectRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
      errors.push(message.text());
    }
  });
  return errors;
}

async function importSource(page, filename, content = sourceText) {
  await page.goto('/sources', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Turn your notes into study decks', { exact: true })).toBeVisible();

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: /Upload notes/ }).click(),
  ]);
  await chooser.setFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  });

  await expect(page.getByText(/source-matched cards? in this set/)).toBeVisible();
}

function createGroundedCandidates(segments, count, requestIndex) {
  const segment = segments.find((item) => /Reliable learning marker \d+ depends/.test(item.text)) ?? segments[0];
  const evidenceText = segment.text.match(/Reliable learning marker \d+ depends on repeated active recall practice\./)?.[0];
  if (!evidenceText) throw new Error('E2E evidence sentence missing from supplied segment.');
  const startOffset = segment.text.indexOf(evidenceText);
  const evidenceSpan = {
    version: '1.0.0',
    offsetEncoding: 'utf16-code-units',
    boundaryConvention: 'half-open',
    status: 'exact',
    startOffset,
    endOffset: startOffset + evidenceText.length,
    evidenceTextSha256: sha256(evidenceText),
    sourceTextSha256: sha256(segment.text),
    matchCount: segment.text.split(evidenceText).length - 1,
  };

  return Array.from({ length: count }, (_, index) => {
    const label = `${requestIndex}-${index + 1}`;
    const question = `Which retained source statement is labeled candidate ${label}?`;
    const answer = `Answer: ${evidenceText}`;
    const learningObjective = `Recall retained source statement ${label}.`;
    const originalCandidate = {
      segmentId: segment.segmentId,
      locator: segment.locator,
      cardType: 'definition',
      question,
      answer,
      learningObjective,
      evidenceText,
      evidenceSpan,
    };
    return {
      ...originalCandidate,
      evaluation: {
        contractVersion: '1.0.0',
        evaluationVersion: '2.0.0',
        policyVersion: '3.1.0',
        sourceSpan: evidenceSpan,
        evidenceSpanVerified: true,
        sourceClaimSupported: 'supported',
        citationStatus: 'exact',
        medicalRisk: 'low',
        medicalVerificationStatus: 'verification_not_required',
        pedagogyStatus: 'acceptable',
        publicationDisposition: 'PUBLISH',
        reasonCodes: [],
        originalCandidate,
        validatorVersion: 'e2e',
        claimResults: [{
          claimId: `claim-${label}`,
          field: 'core_answer',
          claimText: evidenceText,
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
    };
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

async function sourceCardCount(page) {
  const summary = await page.getByText(/source-matched cards? in this set/).innerText();
  const match = summary.match(/^(\d+)/);
  if (!match) throw new Error(`Card count was missing from source summary: ${summary}`);
  return Number(match[1]);
}

async function downloadBackup(page, testInfo, name) {
  await page.goto('/data', { waitUntil: 'domcontentloaded' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Create backup' }).click(),
  ]);
  const backupPath = testInfo.outputPath(`${name}.barion.json`);
  await download.saveAs(backupPath);
  return JSON.parse(await fs.readFile(backupPath, 'utf8'));
}

function latestGenerationJob(backup, predicate) {
  const jobs = backup.payload.tables.generation_jobs;
  expect(jobs.length).toBeGreaterThan(0);
  const matching = jobs.filter(predicate);
  expect(matching.length).toBeGreaterThan(0);
  return matching.reduce((latest, job) => (
    String(job.created_at) > String(latest.created_at) ? job : latest
  ));
}
