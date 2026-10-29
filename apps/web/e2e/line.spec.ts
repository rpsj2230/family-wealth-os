import { expect, test } from '@playwright/test';

test.describe('A transaction and its trail (public sample)', () => {
  test('the account lists its statement lines, and a line opens with its trail and the line it came from', async ({
    page,
  }) => {
    await page.goto('/demo/line');
    await expect(page.getByTestId('statement-lines')).toBeVisible();
    const trail = page.getByTestId('line-trail');
    await expect(trail).toContainText('From Singapore (Wise or DBS)');
    // one step back: the money out of the first account, made of the money from Singapore
    await page.getByTestId('line-pair').getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Money out');
    await expect(page.getByTestId('line-trail')).toContainText('From Singapore (Wise or DBS)');
    await expect(page.getByTestId('line-pair')).toContainText('It went to');
    // the list can be searched, filtered and sorted, and every line opens its own page
    const table = page.getByTestId('txn-table');
    await table.getByPlaceholder(/Search/).fill('interest');
    await expect(table.getByText(/^1$/).first()).toBeVisible();
    await table.getByRole('button', { name: 'Clear filters' }).click();
    await table.getByLabel('Direction').selectOption('out');
    await expect(table.locator('tbody tr')).toHaveCount(1);
    await table.getByLabel('Direction').selectOption('all');
    await table.getByLabel('Period').selectOption('custom');
    await expect(table.getByLabel('From date')).toBeVisible();
    await table.getByLabel('Period').selectOption('all');
    const download = page.waitForEvent('download');
    await table.getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    await page.getByTestId('statement-lines').locator('tbody a').first().click();
    await expect(page.getByTestId('line-trail')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
