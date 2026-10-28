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
    // every line in the list opens its own page
    await page.getByTestId('statement-lines').getByRole('link').first().click();
    await expect(page.getByTestId('line-trail')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
