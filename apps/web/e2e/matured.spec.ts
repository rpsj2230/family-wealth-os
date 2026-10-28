import { expect, test, type Page } from '@playwright/test';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const noOverflow = async (page: Page) => expect(await overflow(page)).toBeLessThanOrEqual(0);

const WIDE_FONT = '* { font-family: "DejaVu Sans", sans-serif !important; }';

/** The grand total under the Accounts list, as text: what is counted. */
const grand = (page: Page) => page.locator('[data-grand]').first().innerText();

// The sample has invented deposits that matured: one recently and not confirmed (listed and counted once, with the button), one confirmed long
// ago, one the History import closed on an estimated date, one still marked running two years after its date, and the sample's own
// paid-out and renewed ones (all five hidden).
const RECENT = (page: Page) =>
  page.locator('tr.xlrow.matured').filter({ hasText: 'Added from the monthly tabs' });

test.describe('Accounts: matured deposits (public sample)', () => {
  test('hides confirmed and old matured deposits and says how many', async ({ page }) => {
    await page.goto('/demo/accounts');
    const note = page.getByTestId('hidden-matured');
    await expect(note).toContainText('5 older or confirmed matured deposits are hidden.');
    await expect(note.getByRole('link', { name: 'Show matured' })).toBeVisible();
    // no dimmed matured row is in the list; the long import note of the closed deposit is not on the page, the recent one is
    await expect(page.locator('tr.xlrow.dim').filter({ hasText: /matured|closed/ })).toHaveCount(0);
    await expect(page.locator('tr.xlrow', { hasText: 'Added from the monthly tabs' })).toHaveCount(
      1,
    );
  });

  test('a deposit that matured recently and whose money is probably held elsewhere is shown, muted and not counted, with the short note and the button', async ({
    page,
  }) => {
    await page.goto('/demo/accounts');
    const row = RECENT(page);
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('matured, not counted');
    await expect(row).toContainText(
      'Probably already in a savings account or a new deposit, so not counted here again',
    );
    await expect(row.getByRole('button', { name: /Confirm .* has matured/ })).toBeVisible();
    await expect(row.locator('.pill.bad')).toHaveText('matured');
  });

  test('the long import note is one line, with all of it on hover', async ({ page }) => {
    await page.goto('/demo/accounts');
    const t = RECENT(page).locator('.notetxt');
    await expect(t).toHaveAttribute('title', /first month it is missing from/);
    const h = await t.evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBeLessThan(26);
  });

  test('Show matured lists them again, dimmed; Hide matured puts them away; totals never change', async ({
    page,
  }) => {
    await page.goto('/demo/accounts');
    const before = await grand(page);
    const rowsBefore = await page.locator('tr.xlrow').count();
    await page.getByRole('link', { name: 'Show matured' }).click();
    await expect(page).toHaveURL(/matured=all/);
    const note = page.getByTestId('hidden-matured');
    await expect(note).toContainText('Showing 5 older or confirmed matured deposits, dimmed.');
    await expect(page.locator('tr.xlrow')).toHaveCount(rowsBefore + 5);
    await expect(page.locator('tr.xlrow.dim').filter({ hasText: 'closed' })).toHaveCount(2);
    await expect(page.locator('tr.xlrow.dim').filter({ hasText: 'matured' }).first()).toBeVisible();
    // the same totals either way: a hidden deposit is in none
    expect(await grand(page)).toBe(before);
    await note.getByRole('link', { name: 'Hide matured' }).click();
    await expect(page).not.toHaveURL(/matured=all/);
    await expect(page.locator('tr.xlrow')).toHaveCount(rowsBefore);
  });

  test('Confirm matured hides the row and says so; in the sample nothing is saved', async ({
    page,
  }) => {
    await page.goto('/demo/accounts');
    const before = await grand(page);
    const row = RECENT(page);
    await row.getByRole('button', { name: /Confirm .* has matured/ }).click();
    await expect(row).toBeHidden();
    const notice = page.getByTestId('notice');
    await expect(notice).toContainText(
      'Marked as matured. It is hidden from the list; Show matured brings it back.',
    );
    await expect(notice).toContainText('nothing was saved');
    expect(await grand(page)).toBe(before);
    await notice.getByRole('button', { name: 'Close' }).click();
    await expect(notice).toHaveCount(0);
    // nothing was saved: the deposit is back after a reload
    await page.reload();
    await expect(RECENT(page)).toHaveCount(1);
  });
});

test.describe('Deposits: matured deposits (public sample)', () => {
  test('the register leaves out confirmed and old ones, lists a recent one as awaiting confirmation, and can show all', async ({
    page,
  }) => {
    await page.goto('/demo/deposits');
    await expect(page.getByTestId('hidden-matured')).toContainText(
      '5 older or confirmed matured deposits are hidden.',
    );
    const row = page.locator('tbody tr', { hasText: 'Matured, to confirm' }).first();
    await expect(row).toContainText('awaiting confirmation');
    await page.getByRole('link', { name: 'Show matured' }).click();
    await expect(page.getByTestId('hidden-matured')).toContainText('Showing 5');
  });

  test('the Maturities tab confirms a deposit with the button', async ({ page }) => {
    await page.goto('/demo/deposits?tab=maturities');
    const card = page.getByRole('region', { name: /Confirm what happened/ });
    await expect(card).toContainText(
      'Counted once in net worth until you say where the money went',
    );
    const items = card.locator('li');
    const n = await items.count();
    expect(n).toBeGreaterThan(0);
    await items
      .first()
      .getByRole('button', { name: /Confirm .* has matured/ })
      .click();
    await expect(items.first()).toBeHidden();
    await expect(page.getByTestId('notice')).toContainText('Marked as matured');
  });
});

test.describe('no sideways scrolling', () => {
  test('the Accounts list, hidden and shown, fits the window', async ({ page }) => {
    for (const path of ['/demo/accounts', '/demo/accounts?matured=all', '/demo/deposits']) {
      await page.goto(path);
      await noOverflow(page);
    }
  });

  for (const width of [412, 810]) {
    test(`with a wide font at ${width}px, including after Confirm matured`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of [
        '/demo/accounts',
        '/demo/accounts?matured=all',
        '/demo/deposits',
        '/demo/deposits?tab=maturities',
      ]) {
        await page.goto(path);
        await page.addStyleTag({ content: WIDE_FONT });
        await noOverflow(page);
      }
      await page.goto('/demo/accounts');
      await page.addStyleTag({ content: WIDE_FONT });
      await RECENT(page)
        .getByRole('button', { name: /Confirm .* has matured/ })
        .click();
      await expect(page.getByTestId('notice')).toBeVisible();
      await noOverflow(page);
    });
  }
});
