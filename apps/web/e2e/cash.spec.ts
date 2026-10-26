import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};
const panel = (page: Page) => page.getByRole('region', { name: 'Savings and cash overview' });
const grand = (page: Page) => page.getByRole('region', { name: 'Total of the lines showing' });

test.describe('Cash (public sample)', () => {
  test('the Savings and cash tile on Accounts opens it', async ({ page }) => {
    await page.goto('/demo/accounts');
    await page
      .getByRole('region', { name: 'Money in banks' })
      .getByRole('link', { name: 'Savings and cash' })
      .click();
    await expect(page).toHaveURL(/\/demo\/cash/);
    await expect(page.getByRole('heading', { name: 'Cash', level: 1 })).toBeVisible();
  });

  test('shows what is available, what it earns, which bank holds how much and every account', async ({
    page,
  }) => {
    await page.goto('/demo/cash');
    const p = panel(page);
    await expect(p.getByTestId('cv-current')).toHaveText(/^₹\d+\.\d\d (Cr|L)$/);
    for (const t of [
      'Cash available today',
      'What it earns',
      'Which bank holds how much',
      'Largest balance',
      'Balances out of date',
      'Whose cash',
    ])
      await expect(p.getByText(t, { exact: false }).first()).toBeVisible();
    expect(await p.getByTestId('cv-banks').locator('li').count()).toBeGreaterThan(1);
    await expect(page.getByRole('heading', { name: 'All savings accounts' })).toBeVisible();
    await expect(page.locator('tfoot tr[data-totals]')).toContainText('Total');
    await noSideways(page);
  });

  test('the person filter narrows the overview and the register total follows a search', async ({
    page,
  }) => {
    await page.goto('/demo/cash');
    const all = await panel(page).getByTestId('cv-current').innerText();
    await page
      .getByRole('link', { name: /^Beena/ })
      .first()
      .click();
    await expect(page).toHaveURL(/[?&]p=p2/);
    expect(await panel(page).getByTestId('cv-current').innerText()).not.toBe(all);
    await noSideways(page);
  });
});

test.describe('Accounts: the total at the bottom (public sample)', () => {
  test('is there, matches the overview, and follows the search', async ({ page }) => {
    await page.goto('/demo/accounts');
    const g = grand(page);
    await expect(g).toBeVisible();
    const total = await g.locator('[data-gt="cur"]').innerText();
    const hero = await page
      .getByRole('region', { name: 'Money in banks' })
      .getByTestId('bv-current')
      .innerText();
    expect(total).toMatch(/₹/);
    expect(hero).toMatch(/₹/);
    const lines = Number(await g.locator('[data-gt="n"]').innerText());
    // narrowing the list changes the total and says so
    await page.getByRole('searchbox').first().fill('Sample Yes Bank');
    await expect(g.locator('[data-gt-filtered]')).toBeVisible();
    expect(await g.locator('[data-gt="cur"]').innerText()).not.toBe(total);
    expect(Number(await g.locator('[data-gt="n"]').innerText())).toBeLessThan(lines);
    // clearing it brings the full total back
    await page.getByRole('searchbox').first().fill('');
    await expect(g.locator('[data-gt="cur"]')).toHaveText(total);
    await noSideways(page);
  });
});
