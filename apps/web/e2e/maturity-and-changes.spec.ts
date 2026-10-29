import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe('Deposits → Maturities: windows and interest ahead (public sample)', () => {
  test('lists every maturity window from Settings, shortest first, each including the shorter ones', async ({
    page,
  }) => {
    await page.goto('/demo/deposits?tab=maturities');
    const card = page.getByTestId('dep-windows');
    await expect(card.getByRole('heading', { name: 'Maturing within' })).toBeVisible();
    const windows = await card.locator('tbody tr td:first-child').allInnerTexts();
    expect(windows).toEqual(['7 days', '15 days', '30 days', '60 days', '90 days']);
    const counts = (await card.locator('tbody tr td:nth-child(2)').allInnerTexts()).map(Number);
    for (let i = 1; i < counts.length; i++)
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]!);
    // the existing cards are still there
    await expect(
      page.getByRole('heading', { name: /^Maturing in the next \d+ days$/ }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Maturity calendar' })).toBeVisible();
  });

  test('interest expected in the next 12 months is labelled an estimate and adds up by month', async ({
    page,
  }) => {
    await page.goto('/demo/deposits?tab=maturities');
    const card = page.getByTestId('dep-interest-ahead');
    await expect(card.getByText(/^Estimated, before tax, to \d{1,2} \w{3,4} \d{4}$/)).toBeVisible();
    const parse = (t: string) => Number(t.replace(/[^\d.-]/g, ''));
    const total = parse(await card.getByTestId('dep-interest-ahead-total').innerText());
    expect(total).toBeGreaterThan(0);
    const months = (await card.locator('.dep-ahead-months tbody td.num').allInnerTexts()).map(
      parse,
    );
    expect(months.length).toBeGreaterThan(0);
    // each month is rounded to the rupee
    expect(Math.abs(months.reduce((s, m) => s + m, 0) - total)).toBeLessThanOrEqual(months.length);
    await card.getByText(/^By deposit/).click();
    await expect(card.locator('details ul li').first()).toBeVisible();
  });

  test('fits a 390 px screen in light and dark', async ({ browser }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme,
      });
      const page = await context.newPage();
      await page.goto('/demo/deposits?tab=maturities');
      await expect(page.getByTestId('dep-interest-ahead')).toBeVisible();
      await noSideways(page);
      await context.close();
    }
  });
});

test.describe('Cash: balance changes and out-of-date records (public sample)', () => {
  test('shows previous and latest balance, the change and how old it is, out-of-date first', async ({
    page,
  }) => {
    await page.goto('/demo/cash');
    const card = page.getByTestId('cash-changes');
    await expect(
      card.getByRole('heading', { name: 'Balance changes and out-of-date records' }),
    ).toBeVisible();
    await expect(card.getByTestId('cash-changes-summary')).toContainText('not a profit');
    const rows = card.locator('tbody tr');
    expect(await rows.count()).toBeGreaterThan(1);
    // out-of-date rows come before recent ones
    const flags = await rows.evaluateAll((trs) =>
      trs.map((tr) => tr.getAttribute('data-stale') === 'true'),
    );
    const firstRecent = flags.indexOf(false);
    if (firstRecent >= 0) expect(flags.slice(firstRecent).includes(true)).toBe(false);
    // the existing register is still there
    await expect(page.getByRole('heading', { name: 'All savings accounts' })).toBeVisible();
  });

  test('fits a 390 px screen in light and dark', async ({ browser }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme,
      });
      const page = await context.newPage();
      await page.goto('/demo/cash');
      await expect(page.getByTestId('cash-changes')).toBeVisible();
      await noSideways(page);
      await context.close();
    }
  });
});
