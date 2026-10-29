import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe('Money at work (public sample)', () => {
  test('shows which money is not growing or slow, slowest first, and what would make it grow', async ({
    page,
  }) => {
    await page.goto('/demo/growth');
    await expect(page.getByRole('heading', { name: 'Money at work', level: 1 })).toBeVisible();
    const kpis = page.getByTestId('gw-kpis');
    for (const t of [
      'Pace now, after tax',
      'Not growing',
      'Slow: below inflation',
      'Lost to rising prices',
    ])
      await expect(kpis.getByText(t)).toBeVisible();
    const rows = page.getByTestId('gw-holdings').locator('tbody tr');
    await expect(rows.first()).toContainText('Loan to a friend');
    await expect(rows.first()).toContainText('Not growing');
    const moves = page.getByTestId('gw-moves');
    await expect(moves).toContainText('to a deposit at Sample Equity Bank');
    await expect(moves).toContainText('Sample Banking Fund');
  });

  test('the corpus year by year: same pace, 1% and 2% slower and faster, and the slow money moved', async ({
    page,
  }) => {
    await page.goto('/demo/growth?tab=projection');
    const years = page.getByTestId('gw-years');
    for (const h of [
      'Same pace, funds at their actual past return',
      'Savings and deposits too at the funds’ actual past return',
      'Funds at the long-run return',
      '2% slower',
      '1% slower',
      '1% faster',
      '2% faster',
      'If the slow money is moved',
    ])
      await expect(years.locator('thead th', { hasText: h }).first()).toBeVisible();
    // today plus 20 years
    await expect(years.locator('tbody tr')).toHaveCount(21);
    await expect(years.locator('tbody tr').first()).toContainText('(today)');
    await expect(page.getByTestId('gw-proj-kpis')).toContainText('In 20 years');
    await expect(page.locator('figure, [role="img"]').first()).toBeVisible();
  });

  test('downloads both tables as an Excel workbook', async ({ page }) => {
    await page.goto('/demo/growth?tab=projection');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('centre-xlsx').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^money-at-work-.*\.xlsx$/);
  });

  test('fits a 390 px screen in light and dark, on both tabs', async ({ browser }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme,
      });
      const page = await context.newPage();
      for (const tab of ['slow', 'projection']) {
        await page.goto(`/demo/growth?tab=${tab}`);
        await noSideways(page);
      }
      await context.close();
    }
  });
});
