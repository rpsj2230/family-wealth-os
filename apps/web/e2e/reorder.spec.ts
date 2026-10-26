import { expect, test } from '@playwright/test';

const names = (page: import('@playwright/test').Page) =>
  page.locator('.reorder-bank > .reorder-head strong').allTextContents();

test('sample: Move down changes the order of banks, Move up the order of rows', async ({
  page,
}) => {
  await page.goto('/demo/accounts/reorder');
  await expect(page.getByRole('heading', { name: 'Change the order', level: 1 })).toBeVisible();
  const before = await names(page);
  expect(before.length).toBeGreaterThan(2);

  await page.getByRole('button', { name: `Move ${before[0]} down` }).click();
  const after = await names(page);
  expect(after[0]).toBe(before[1]);
  expect(after[1]).toBe(before[0]);
  await expect(page.getByRole('status').filter({ hasText: 'moved to position 2' })).toBeAttached();
  // the first bank cannot go up, the last cannot go down
  await expect(page.getByRole('button', { name: `Move ${after[0]} up` })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: `Move ${after[after.length - 1]} down` }),
  ).toBeDisabled();

  // rows of the second bank (the one moved down)
  const bank = page.locator('.reorder-bank').nth(1);
  await bank.locator('summary').click();
  const rowsBefore = await bank.locator('.reorder-row .code').allTextContents();
  expect(rowsBefore.length).toBeGreaterThan(1);
  await bank.locator('.reorder-row').nth(1).getByRole('button', { name: /up$/ }).click();
  const rowsAfter = await bank.locator('.reorder-row .code').allTextContents();
  expect(rowsAfter[0]).toBe(rowsBefore[1]);
  expect(rowsAfter[1]).toBe(rowsBefore[0]);
});

test('sample: saving is a notice, nothing is stored', async ({ page }) => {
  await page.goto('/demo/accounts/reorder');
  await page.getByRole('button', { name: 'Save this order' }).click();
  await expect(page.getByText(/This is a sample: nothing is saved/)).toBeVisible();
});

test('sample: dragging a bank onto another swaps their places', async ({ page }) => {
  await page.goto('/demo/accounts/reorder');
  const before = await names(page);
  await page
    .locator('.reorder-bank')
    .nth(0)
    .locator('> .reorder-head')
    .dragTo(page.locator('.reorder-bank').nth(2).locator('> .reorder-head'));
  const after = await names(page);
  // the first bank has moved down to the third place
  expect(after[2]).toBe(before[0]);
});

test('sample: nothing scrolls sideways', async ({ page }) => {
  await page.goto('/demo/accounts/reorder');
  await page.locator('.reorder-bank summary').first().click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
