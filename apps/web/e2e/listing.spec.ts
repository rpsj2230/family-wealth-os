import { expect, test } from '@playwright/test';

test.describe('search, sort, filter and export on a listing (public sample)', () => {
  test('search narrows the banks and rows, and clearing restores them', async ({ page }) => {
    await page.goto('/demo/accounts');
    const rows = page.locator('tr.xlrow:visible');
    const before = await rows.count();
    expect(before).toBeGreaterThan(3);
    await page.getByLabel('Search this list').fill('Esaf');
    await expect.poll(async () => rows.count()).toBeLessThan(before);
    expect(await rows.count()).toBeGreaterThan(0);
    for (const t of await page.locator('section.xlbank:visible h2').allTextContents())
      expect(t).toContain('Esaf');
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect.poll(async () => rows.count()).toBe(before);
  });

  test('sorting by a column heading orders the rows and flips on a second click', async ({
    page,
  }, info) => {
    test.skip(
      info.project.name === 'phone',
      'the column headings are not shown on a phone; the Sort by list is used there',
    );
    await page.goto('/demo/accounts');
    const bank = page.locator('section.xlbank').first();
    const amounts = async () =>
      (await bank.locator('tbody').first().locator('tr.xlrow td.cur').allTextContents()).map((t) =>
        Number(t.replace(/[^\d]/g, '')),
      );
    const heading = bank.locator('thead th', { hasText: 'Current value' });
    await heading.click();
    await expect(heading).toHaveAttribute('aria-sort', 'ascending');
    await expect
      .poll(async () => {
        const v = await amounts();
        return v.length > 1 && v.every((n, i) => i === 0 || v[i - 1]! <= n);
      })
      .toBe(true);
    await heading.click();
    await expect(heading).toHaveAttribute('aria-sort', 'descending');
    await expect
      .poll(async () => {
        const v = await amounts();
        return v.every((n, i) => i === 0 || v[i - 1]! >= n);
      })
      .toBe(true);
  });

  test('the Sort by list works too, and column filters narrow by number', async ({ page }) => {
    await page.goto('/demo/accounts');
    await page.getByLabel('Sort by').selectOption({ label: 'Current value' });
    await expect(page.getByRole('button', { name: /Sorted ascending/ })).toBeVisible();
    await page.getByRole('button', { name: /^Filters/ }).click();
    await page.getByLabel('Filter Current value').fill('>1000000');
    const rows = page.locator('tr.xlrow:visible');
    await expect.poll(async () => rows.count()).toBeGreaterThan(0);
    for (const t of await rows.locator('td.cur').allTextContents())
      expect(Number(t.replace(/[^\d]/g, ''))).toBeGreaterThan(1_000_000);
  });

  test('export downloads the visible rows as CSV', async ({ page }) => {
    await page.goto('/demo/accounts');
    await page.getByLabel('Search this list').fill('Esaf');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^accounts-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await (
      await import('node:fs/promises')
    ).readFile((await download.path())!, 'utf8');
    expect(text).toContain('Account');
    expect(text).toContain('Esaf');
    expect(text).not.toContain('Sample Jan Bank');
  });

  test('nothing scrolls sideways with the tools open', async ({ page }) => {
    await page.goto('/demo/accounts');
    await page.getByRole('button', { name: /^Filters/ }).click();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
