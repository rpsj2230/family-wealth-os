import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

const panel = (page: Page) => page.getByRole('region', { name: 'Money in banks' });

test.describe('Accounts: the money-in-banks overview (public sample)', () => {
  test('shows the three totals, profit, today’s earning, where the money sits and the secondary figures', async ({
    page,
  }) => {
    await page.goto('/demo/accounts');
    const p = panel(page);
    await expect(p).toBeVisible();
    await expect(
      p.getByRole('heading', { name: /Current value in banks/, level: 2 }),
    ).toBeVisible();
    // the big figure is the full amount in Indian grouping
    await expect(p.getByTestId('bv-current')).toHaveText(/^₹\d{1,2}(,\d\d)*,\d{3}$/);
    for (const label of [
      'Invested',
      'Current value',
      'Maturity value',
      'Today’s change',
      'Interest earned this FY',
      'How is my bank money growing?',
      'All bank money',
      'Where the money sits',
      'Savings and cash',
      'Fixed deposits',
      'Other holdings',
      'Interest still to come',
      'Average interest rate',
      'Largest bank',
      'Above insured limit',
      'Whose money',
      'NRE and NRO',
    ]) {
      await expect(p.getByText(label, { exact: false }).first()).toBeVisible();
    }
    // today's earning says it is an estimate; profit is marked with an arrow and a word for a screen reader
    await expect(p.locator('.hl-asof')).toContainText('· est.');
    await expect(p.locator('.hl-pill.up .sr-only').first()).toHaveText(/Up/);
    // the window for "maturing in" comes from Settings (30 days by default), it is not written into the page
    await expect(p.getByTestId('bv-tile-soon')).toContainText(
      /Maturing soon.*in 30 days · ₹[\d,]+ in 90 days \(principal\)/,
    );
    // insured limit counted by bank-and-name holdings, as in the approved design
    await expect(p.getByTestId('bv-x-insured')).toContainText(
      /\d+ of \d+ bank-and-name holdings|all within/,
    );
    // by bank and by person: current value, profit, average rate and the deposits' XIRR for each
    const by = p.getByTestId('bv-by');
    await expect(by.getByRole('table', { name: 'By bank' })).toBeVisible();
    // on a phone the rows become cards, so each figure is checked by its label, which shows at every width
    for (const h of ['Current value', 'Profit', 'Average interest rate', 'Deposits XIRR'])
      expect(await by.locator(`td[data-label="${h}"]`).count()).toBeGreaterThan(0);
    // the bars have a text alternative that names every share
    await expect(
      p.getByRole('img', { name: /Where the money sits: Savings and cash \d+%/ }),
    ).toBeVisible();
    await expect(p.getByRole('img', { name: /of the total interest earned so far/ })).toBeVisible();
    // the existing "needs you" signal is kept
    await expect(p.getByText(/Updated in October/)).toBeVisible();
    await expect(p.getByText(/need you/)).toBeVisible();
  });

  test('fits the screen without sideways scrolling, and every part stays inside the panel', async ({
    page,
  }) => {
    await page.goto('/demo/accounts');
    await expect(panel(page)).toBeVisible();
    await noSideways(page);
    const box = await panel(page).boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw);
    // nothing inside spills past the right edge of the panel
    const spill = await panel(page).evaluate((el) => {
      const right = el.getBoundingClientRect().right + 1;
      return [...el.querySelectorAll<HTMLElement>('*')]
        .filter(
          (n) => n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().right > right,
        )
        .map((n) => n.className || n.tagName)
        .slice(0, 5);
    });
    expect(spill).toEqual([]);
  });

  test('follows the person chosen', async ({ page }) => {
    await page.goto('/demo/accounts');
    const all = await panel(page).getByTestId('bv-current').innerText();
    await page
      .getByRole('link', { name: /^Beena/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\?p=p2/);
    await expect(panel(page).getByRole('heading', { level: 2 })).toContainText('Beena');
    expect(await panel(page).getByTestId('bv-current').innerText()).not.toBe(all);
    // one person: no split between people
    await expect(panel(page).getByText('Whose money')).toHaveCount(0);
    await noSideways(page);
  });

  test('shows how the money in banks is growing: all bank money, deposits XIRR and savings rate earned', async ({
    page,
  }) => {
    await page.goto('/demo/accounts');
    for (const key of ['all', 'fd', 'savings'])
      await expect(page.getByTestId(`bv-growth-${key}`)).toContainText(/\d+\.\d\d%|–/);
    // the deposits card says invested, profit with its overall return, and XIRR
    await expect(panel(page)).toContainText(
      /Invested ₹[\d.]+ (Cr|L) · Profit [+−]₹[\d.,]+ ?(Cr|L)? \([+−][\d.]+%\) · XIRR \d+\.\d\d%/,
    );
    await page.locator('[data-why="accounts.growth"]').first().click();
    await expect(page.getByTestId('why-panel')).toContainText('Earning rate now');
    await page.keyboard.press('Escape');
  });

  test('is also at the top of Manage', async ({ page }) => {
    await page.goto('/demo/accounts?tab=manage');
    await expect(panel(page)).toContainText('Interest earned this FY');
    await expect(page.getByRole('heading', { name: 'Edit many accounts at once' })).toBeVisible();
    await noSideways(page);
  });

  test('the secondary figures link to where they are explained', async ({ page }) => {
    await page.goto('/demo/accounts');
    await expect(panel(page).getByRole('link', { name: 'Maturity value' })).toHaveAttribute(
      'href',
      '/demo/deposits?tab=maturities',
    );
    await expect(panel(page).getByRole('link', { name: /Updated in/ })).toHaveAttribute(
      'href',
      '/demo/monthly',
    );
  });
});
