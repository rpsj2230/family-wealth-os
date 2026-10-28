import { expect, test } from '@playwright/test';

test.describe('Money trail (public sample)', () => {
  test('a deposit traced back to Singapore, and money moved between the two of you', async ({
    page,
  }) => {
    await page.goto('/demo/trail');
    await expect(page.getByRole('heading', { name: 'Money trail', level: 1 })).toBeVisible();
    await expect(page.getByTestId('tr-remit')).toContainText('Transfers from Singapore on file');
    const one = page.getByTestId('tr-one');
    await expect(one).toBeVisible();
    await expect(one).toContainText('From Singapore (Wise or DBS)');
    await expect(page.getByTestId('tr-years')).toBeVisible();
    await expect(page.getByTestId('tr-since')).toBeVisible();
    // every holding can be opened
    const links = page.getByTestId('tr-holdings').getByRole('link');
    await expect(links).toHaveCount(3);
    await links.first().click();
    await expect(page.getByTestId('tr-one')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
