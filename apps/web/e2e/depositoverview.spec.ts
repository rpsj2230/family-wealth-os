import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

const panel = (page: Page) => page.getByRole('region', { name: 'Fixed deposits overview' });

test.describe('Deposits: the overview (public sample)', () => {
  test('shows invested, current and maturity value, profit, today’s earning, banks and the yearly ladder', async ({
    page,
  }) => {
    await page.goto('/demo/deposits');
    const p = panel(page);
    await expect(p).toBeVisible();
    await expect(p.getByRole('heading', { name: /Fixed deposits today/, level: 2 })).toBeVisible();
    await expect(p.getByTestId('dv-current')).toHaveText(/^₹\d+\.\d\d (Cr|L)$/);
    for (const label of [
      'Invested',
      'Current value',
      'Maturity value',
      'Profit so far',
      'Earned today',
      'Which bank holds how much',
      'What matures, year by year',
      'Interest still to earn',
      'Next maturity',
      'Largest bank',
      'Above the insured limit',
    ]) {
      await expect(p.getByText(label, { exact: false }).first()).toBeVisible();
    }
    await expect(p.getByText('estimate', { exact: true })).toBeVisible();
    await expect(p.locator('.bv-delta.up .sr-only').first()).toHaveText(/Up/);
    expect(await p.getByTestId('dv-banks').locator('li').count()).toBeGreaterThan(0);
    expect(await p.getByTestId('dv-ladder').locator('li').count()).toBeGreaterThan(0);
    // savings are not part of this overview
    await expect(p.getByText('Savings and cash')).toHaveCount(0);
  });

  test('the bank shares add up to the whole and the list can be grouped by bank', async ({
    page,
  }) => {
    await page.goto('/demo/deposits');
    const shares = await panel(page).getByTestId('dv-banks').locator('.dv-pct').allInnerTexts();
    const total = shares.reduce((a, t) => a + parseInt(t, 10), 0);
    // each share is rounded to a whole percent, so the sum may be a point or two off 100
    expect(Math.abs(total - 100)).toBeLessThanOrEqual(shares.length);
    await panel(page).getByRole('link', { name: 'Group the list by bank' }).click();
    await expect(page).toHaveURL(/g=bank/);
  });

  test('follows the person chosen and fits the screen', async ({ page }) => {
    await page.goto('/demo/deposits');
    await noSideways(page);
    const all = await panel(page).getByTestId('dv-current').innerText();
    await page
      .getByRole('link', { name: /^Beena/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\?p=p2/);
    await expect(panel(page).getByRole('heading', { level: 2 })).toContainText('Beena');
    expect(await panel(page).getByTestId('dv-current').innerText()).not.toBe(all);
    await noSideways(page);
  });
});
