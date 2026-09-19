const { expect, test } = require('@playwright/test');

test('learner plan persists and builder can organize independent source sets', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('BARION AUTOPILOT')).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await page.getByRole('button', { name: /Start today’s plan/ }).click();
  await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal' }).click();
  await page.getByRole('button', { name: /Okay/ }).click();
  await expect(page.getByText('4 IN SESSION')).toBeVisible();

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('YOUR SAVED PLAN')).toBeVisible();
  await expect(page.getByRole('button', { name: /Resume · 4 left/ })).toBeVisible();
  await page.getByRole('button', { name: /Resume · 4 left/ }).click();
  await expect(page.getByText('Saved plan resumed')).toBeVisible();
  await expect(page.getByText('1/5 COMPLETE')).toBeVisible();

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Switch to Builder/ }).click();
  await expect(page.getByText('What would you like to do?')).toBeVisible();
  await page.getByRole('button', { name: /Classes & folders/ }).click();
  await expect(page.getByText('Class folders for real exam prep.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Class Medical studies/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Folder Imported sources/ })).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});

test('learner can hold a confusing card for source review and restore it', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('BARION AUTOPILOT')).toBeVisible();
  await page.getByRole('button', { name: /Start today’s plan/ }).click();
  await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();

  await page.getByRole('button', { name: 'Hold for source check' }).click();
  await expect(page.getByText('Hold this card for source review?')).toBeVisible();
  await page.getByRole('button', { name: 'Hold card' }).click();
  await expect(page.getByText('4 IN SESSION')).toBeVisible();

  await page.goto('/library', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Source checks')).toBeVisible();
  await expect(page.getByText(/Held for source review/)).toBeVisible();

  await page.getByRole('button', { name: 'Open set' }).first().click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await page.getByPlaceholder('Question').fill('What is the principal glucose-lowering action of metformin?');
  await page.getByPlaceholder('Answer').fill('Metformin primarily lowers glucose by reducing hepatic glucose production.');
  await page.getByPlaceholder(/What changed/).fill('Tightened wording against the source evidence.');
  await page.getByRole('button', { name: 'Save edits' }).click();
  await expect(page.getByText('Tightened wording against the source evidence.')).toBeVisible();
  await page.getByRole('button', { name: 'Allow study' }).first().click();
  await expect(page.getByText(/Verified|Source linked/).first()).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});

test('builder creates an organized class, imports cloze siblings, and studies the folder', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/classes', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('CLASS - FOLDER - DECK')).toBeVisible();

  await page.getByLabel('Class name').fill('Medicine Finals');
  await page.getByLabel('New class exam date').fill('2026-12-10');
  await page.getByRole('button', { name: 'Create class' }).click();
  await expect(page.getByText('Medicine Finals', { exact: true }).first()).toBeVisible();

  await page.getByLabel('Folder name').fill('Cardiology');
  await page.getByRole('button', { name: 'Create folder' }).click();
  await expect(page.getByText('Cardiology', { exact: true }).first()).toBeVisible();

  await page.getByLabel('Deck title').fill('Rhythm essentials');
  await page.getByLabel('Deck description').fill('Final exam high-yield recall');
  await page.getByRole('button', { name: 'Create deck' }).click();
  await expect(page.getByRole('button', { name: 'Open deck Rhythm essentials' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Open deck Rhythm essentials' }).first().click();

  await page.getByRole('button', { name: 'Import Cards' }).click();
  await expect(page.getByText('Bulk import', { exact: true }).first()).toBeVisible();
  await page.getByPlaceholder(/Front.*Back/).fill(
    'The {{c1::sinoatrial node}} normally initiates rhythm in the {{c2::right atrium}}.\tElectrical anatomy context.',
  );
  await expect(page.getByText(/1 row ready - 2 cards after cloze expansion/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 cards' }).click();
  await expect(page.getByText('2 cards', { exact: true }).first()).toBeVisible();

  await page.goto('/classes', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Class Medicine Finals/ }).click();
  await page.getByRole('radio', { name: /Folder Cardiology/ }).click();
  await page.getByRole('button', { name: /Offline copies & exports/ }).click();
  const folderDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Folder TSV' }).click();
  const folderDownload = await folderDownloadPromise;
  expect(folderDownload.suggestedFilename()).toContain('cardiology-barion-cards.tsv');
  await page.getByRole('button', { name: 'Study folder' }).click();
  await expect(page.getByText('BARION STUDY ENGINE')).toBeVisible();
  await page.getByRole('button', { name: /Start long-term review/ }).click();
  await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});

test('study engine separates browse and short-term practice from FSRS', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/modes', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('BARION STUDY ENGINE')).toBeVisible();
  await page.getByRole('button', { name: /More ways to study/ }).click();
  await page.getByRole('button', { name: /Browse cards/ }).click();
  await expect(page.getByText('No scheduling change')).toBeVisible();
  await page.getByRole('button', { name: 'Reveal' }).click();
  await page.getByRole('button', { name: /Next card|Finish browsing/ }).click();

  await page.goto('/modes', { waitUntil: 'domcontentloaded' });
  await page.getByRole('radio', { name: /Cram for a test/ }).click();
  await page.getByRole('button', { name: 'Start cram session' }).click();
  await expect(page.getByLabel('Your recall before revealing')).toBeVisible();
  await page.getByLabel('Your recall before revealing').fill('My own recalled explanation');
  await page.getByRole('button', { name: 'Compare answer' }).click();
  await expect(page.getByText('WHAT YOU RECALLED')).toBeVisible();
  await expect(page.getByText('My own recalled explanation')).toBeVisible();

  await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Your reviews, without calendar math.')).toBeVisible();
  await page.getByRole('button', { name: 'Plan 20 minutes' }).first().click();
  await expect(page.getByText('Today’s Barion plan')).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});

test('deck creation flows directly into configurable CSV import and export', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/deck/new', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Example: Renal physiology').fill('Electrolyte essentials');
  await page.getByPlaceholder('Short study goal or course context').fill('Portable CSV reviewer');
  await page.getByRole('button', { name: 'Create & import cards' }).click();

  await expect(page.getByText('Bulk import', { exact: true }).first()).toBeVisible();
  await page.getByRole('radio', { name: 'Comma' }).click();
  await page.getByRole('checkbox', { name: /First row is a header/ }).click();
  await page.getByPlaceholder(/Front.*Back/).fill(
    'Front,Back\nHyponatremia,Low serum sodium concentration\nHyperkalemia,High serum potassium concentration',
  );
  await expect(page.getByText(/2 rows ready - 2 cards after cloze expansion/)).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 cards' }).click();
  await expect(page.getByText('2 cards', { exact: true }).first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('electrolyte-essentials-barion-cards.csv');

  await page.getByRole('button', { name: 'Print or Save PDF' }).click();
  await expect(page.getByText('PRINT OR SAVE PDF', { exact: true })).toBeVisible();
  await expect(page.getByText('2 safe cards available.')).toBeVisible();
  await page.getByRole('radio', { name: /Flashcard cutouts/ }).click();
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();

  await page.goBack();
  await page.getByRole('button', { name: 'Copy without progress' }).click();
  await expect(page.getByText('Electrolyte essentials copy', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('2 cards', { exact: true }).first()).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('test direction and exact question order survive interruption', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/test', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Build a focused test')).toBeVisible();
  await page.getByRole('radio', { name: /All cards/ }).click();
  await page.getByRole('radio', { name: /Back to front/ }).click();
  await page.getByRole('radio', { name: '5', exact: true }).click();
  await page.getByRole('button', { name: 'Start test' }).click();
  await expect(page.getByText(/QUESTION 1 OF 5/)).toBeVisible();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('TEST IN PROGRESS')).toBeVisible();
  await page.getByRole('button', { name: 'Resume test' }).click();
  await expect(page.getByText(/QUESTION 1 OF 5/)).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});
