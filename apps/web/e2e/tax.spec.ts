import { expect, test } from '@playwright/test';

test.describe('Tax simulator (public sample)', () => {
  test('shows the result of a redemption, split by lot and term, and the NRI refund', async ({
    page,
  }) => {
    await page.goto('/demo/tax');
    await expect(page.getByText('Decision support only, not tax advice')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Result of this redemption' })).toBeVisible();
    await expect(page.getByText('Long term').first()).toBeVisible();
    await expect(page.getByText('Refund to claim by filing a return')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('validates lot lines and refuses to guess', async ({ page }) => {
    await page.goto('/demo/tax');
    await page.getByLabel('Lots').fill('yesterday, 10, 100');
    await expect(page.getByText('Line 1: the date must look like 2024-03-05.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Result of this redemption' })).toHaveCount(0);
  });

  test('flags redeeming more units than are held', async ({ page }) => {
    await page.goto('/demo/tax');
    await page.getByLabel('Units to redeem').fill('99999');
    await expect(page.locator('p.notice[role=alert]')).toContainText('You hold');
  });

  test('suggests a tax-free harvest with its trade-offs', async ({ page }) => {
    await page.goto('/demo/tax');
    await expect(page.getByRole('heading', { name: /Could using this year/ })).toBeVisible();
    await expect(page.getByText(/gap between selling and buying back/)).toBeVisible();
  });
});
