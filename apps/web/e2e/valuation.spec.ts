import { expect, test, type Page } from '@playwright/test';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const WIDE_FONT = '* { font-family: "DejaVu Sans", sans-serif !important; }';

const panel = (page: Page) => page.getByTestId('vbp');
const rows = (page: Page) => page.getByTestId('vbp-row');

test.describe('Investments > Value by period (public sample)', () => {
  test('shows the total valuation over a table of value, change and gain by month', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=valuation');
    await expect(page.getByRole('link', { name: 'Value by period' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const p = panel(page);
    await expect(
      p.getByRole('heading', { name: 'Portfolio value by period', level: 2 }),
    ).toBeVisible();
    await expect(p.getByText('Total valuation')).toBeVisible();
    await expect(p.getByRole('img', { name: /Total valuation by period/ })).toBeVisible();
    await expect(p.getByRole('columnheader')).toHaveText([
      'Period',
      'Portfolio value (₹)',
      'Change (₹)',
      'Change (%)',
      'Money put in, net of sales (₹)',
      'Gain (₹)',
      'Gain (%)',
    ]);
    // the default is the last 12 months, newest first, the latest labelled to date
    await expect(rows(page)).toHaveCount(12);
    await expect(rows(page).first().getByRole('rowheader')).toContainText('Oct 2026 (to date)');
    await expect(rows(page).nth(1).getByRole('rowheader')).toContainText('Sep 2026');
    // Indian digit grouping
    await expect(rows(page).nth(1).locator('td').first()).toHaveText(/^₹\d{1,2},\d\d,\d{3}/);
    // the plain change and the gain are apart: both columns exist for a month
    await expect(rows(page).nth(1).locator('td').nth(1)).toHaveText(/^[+−]₹[\d,]+$/);
    await expect(rows(page).nth(1).locator('td').nth(4)).toHaveText(/^[+−]₹[\d,]+$/);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('weeks, months, quarters and years are links with their own address', async ({ page }) => {
    await page.goto('/demo/investments?tab=valuation');
    const p = panel(page);
    await p.getByRole('link', { name: 'Weeks' }).click();
    await expect(page).toHaveURL(/g=week/);
    await expect(rows(page).first().getByRole('rowheader')).toContainText(/^Week of \d+ \w+ 2026/);
    await expect(rows(page).first().getByRole('rowheader')).toContainText('(to date)');
    await p.getByRole('link', { name: 'Quarters' }).click();
    await expect(page).toHaveURL(/g=quarter/);
    await expect(rows(page).first().getByRole('rowheader')).toContainText(/^Q\d FY 2026-27/);
    await p.getByRole('link', { name: 'Years' }).click();
    await expect(page).toHaveURL(/g=year/);
    await expect(rows(page).first().getByRole('rowheader')).toContainText(
      /^FY 2026-27 \(to date\)/,
    );
    await expect(rows(page).nth(1).getByRole('rowheader')).toContainText('FY 2025-26');
    await p.getByRole('link', { name: 'Months' }).click();
    await expect(rows(page)).toHaveCount(12);
  });

  test('the range: last 24, all, or two dates chosen with a plain form', async ({ page }) => {
    await page.goto('/demo/investments?tab=valuation&g=month');
    const p = panel(page);
    await p.getByRole('link', { name: 'Last 24' }).click();
    await expect(page).toHaveURL(/range=double/);
    expect(await rows(page).count()).toBeGreaterThan(12);
    await p.getByRole('link', { name: 'All', exact: true }).click();
    await expect(page).toHaveURL(/range=all/);
    const all = await rows(page).count();
    expect(all).toBeGreaterThanOrEqual(24);
    // the address alone gives the same stretch (it works without scripts)
    await page.goto('/demo/investments?tab=valuation&g=month&from=2026-03-10&to=2026-05-02');
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).last().getByRole('rowheader')).toContainText('Mar 2026');
    await expect(rows(page).first().getByRole('rowheader')).toContainText('May 2026');
    await expect(p.locator('input[name="from"]')).toHaveValue('2026-03-10');
    // and the form sends the same
    await p.locator('input[name="from"]').fill('2026-06-01');
    await p.locator('input[name="to"]').fill('2026-07-31');
    await p.getByRole('button', { name: 'Show' }).click();
    await expect(page).toHaveURL(/from=2026-06-01/);
    await expect(rows(page)).toHaveCount(2);
  });

  test('narrows to one person like the other tabs', async ({ page }) => {
    await page.goto('/demo/investments?tab=valuation&g=month');
    const all = await rows(page).first().locator('td').first().innerText();
    const person = page.getByRole('navigation', { name: 'Show whose' }).getByRole('link').nth(1);
    await person.click();
    await expect(page).toHaveURL(/p=/);
    const mine = await rows(page).first().locator('td').first().innerText();
    expect(mine).not.toBe(all);
  });

  test('downloads the same table as a CSV file for the same choices', async ({ page, request }) => {
    await page.goto('/demo/investments?tab=valuation&g=quarter&range=all');
    const link = panel(page).getByTestId('vbp-csv');
    const href = (await link.getAttribute('href'))!;
    expect(href).toContain('/demo/investments/valuation-csv');
    expect(href).toContain('g=quarter');
    const res = await request.get(href);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    expect(res.headers()['content-disposition']).toContain('portfolio-value-by-quarter.csv');
    const text = await res.text();
    expect(text).toContain('Period,From,To,Portfolio value (INR),Change (INR)');
    expect(text.split('\r\n').filter(Boolean).length - 1).toBe(await rows(page).count());
  });

  test('the ? explains change against gain and names the money put in', async ({ page }) => {
    await page.goto('/demo/investments?tab=valuation');
    await page.locator('[data-why="valuation.table"]').first().click();
    const p = page.getByTestId('why-panel');
    await expect(p).toContainText('new money included');
    await expect(p).toContainText('Gain = change − net money in');
    await page.keyboard.press('Escape');
    await page.locator('[data-why="valuation.chart"]').first().click();
    await expect(page.getByTestId('why-panel')).toContainText('units held on its last day');
  });

  test('reads without sideways scrolling on a phone, a tablet and a desktop, with a wide font', async ({
    browser,
  }) => {
    for (const w of [390, 412, 810, 1440]) {
      const context = await browser.newContext({ viewport: { width: w, height: 900 } });
      const page = await context.newPage();
      await page.goto('/demo/investments?tab=valuation&g=week');
      await expect(rows(page).first()).toBeVisible();
      expect(await overflow(page), `width ${w}`).toBeLessThanOrEqual(0);
      await page.addStyleTag({ content: WIDE_FONT });
      expect(await overflow(page), `wide font, width ${w}`).toBeLessThanOrEqual(0);
      const table = await page.getByTestId('vbp-table').boundingBox();
      expect(table!.width).toBeLessThanOrEqual(w + 1);
      await context.close();
    }
  });
});
