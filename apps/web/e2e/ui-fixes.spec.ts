import { expect, test } from '@playwright/test';

test('Settings: the clubbing date is a date field with the browser’s date picker', async ({
  page,
}) => {
  await page.goto('/demo/settings?tab=rules');
  const field = page
    .locator('#trail')
    .getByLabel(/Count money moved between you for clubbing from/);
  await expect(field).toHaveAttribute('type', 'date');
});

test('Monthly update: the save bar does not float over the list while there is nothing to save', async ({
  page,
}) => {
  await page.goto('/demo/monthly');
  const bar = page.getByRole('region', { name: 'Save' });
  await expect(bar).toContainText('No changes yet');
  expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('static');
});
