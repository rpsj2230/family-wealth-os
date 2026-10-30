import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe('Harvest plan (public sample)', () => {
  test('one table for the family: whose, fund, units, cost, value, gain, sell and buy-back dates', async ({
    page,
  }) => {
    await page.goto('/demo/tax-harvest');
    const plan = page.getByTestId('harvest-plan');
    await expect(plan.getByRole('heading', { name: /Harvest plan, FY/ })).toBeVisible();
    for (const h of [
      'Whose',
      'Fund',
      'Units to sell',
      'Cost',
      'Current value',
      'Long-term gain',
      'Sell by',
      'Buy back',
      'Buy back on',
      'Long-term again from',
      'Tax saved',
    ])
      await expect(plan.locator('thead th', { hasText: h }).first()).toBeAttached();
    expect(await plan.locator('tbody tr').count()).toBeGreaterThan(0);
    await expect(plan.locator('tbody tr').first().locator('td').first()).not.toBeEmpty();
    await expect(plan).toContainText('Buy back on');
    await expect(plan).toContainText('reinvestment');
  });

  test('downloads as an Excel workbook', async ({ page }) => {
    await page.goto('/demo/tax-harvest');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('harvest-plan').getByTestId('centre-xlsx').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^harvest-plan-.*\.xlsx$/);
  });

  test('fits a 390 px screen in light and dark', async ({ browser }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme,
      });
      const page = await context.newPage();
      await page.goto('/demo/tax-harvest');
      await expect(page.getByTestId('harvest-plan')).toBeVisible();
      await noSideways(page);
      await context.close();
    }
  });
});
