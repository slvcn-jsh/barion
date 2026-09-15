const { expect, test } = require('@playwright/test');

test('learner plan persists and builder can organize independent source sets', async ({ page }) => {
  const runtimeErrors = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByText('BARION AUTOPILOT')).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await page.getByRole('button', { name: /Start today’s plan/ }).click();
  await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
  await page.getByRole('button', { name: 'Reveal' }).click();
  await page.getByRole('button', { name: /Good/ }).click();
  await expect(page.getByText('4 IN SESSION')).toBeVisible();

  await page.goto('/');
  await expect(page.getByText('YOUR SAVED PLAN')).toBeVisible();
  await expect(page.getByRole('button', { name: /Resume · 4 left/ })).toBeVisible();
  await page.getByRole('button', { name: /Resume · 4 left/ }).click();
  await expect(page.getByText('Saved plan resumed')).toBeVisible();
  await expect(page.getByText('1/5 REVIEWED')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: /Switch to Builder/ }).click();
  await expect(page.getByText('What would you like to do?')).toBeVisible();
  await page.getByRole('button', { name: /Plan curriculum/ }).click();
  await expect(page.getByText('Courses organize; source sets stay independent')).toBeVisible();
  await expect(page.getByText('Medical studies', { exact: true })).toBeVisible();
  await expect(page.getByText('Imported sources', { exact: true })).toBeVisible();

  expect(runtimeErrors).toEqual([]);
});
