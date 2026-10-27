import { expect, test } from '@playwright/test';

/** The AI cost page on the public sample (invented calls): no private data is read. */
test.describe('AI cost (public sample)', () => {
  test('shows cost by period, day, purpose, model and call, with caching and the way it is worked out', async ({
    page,
  }) => {
    await page.goto('/demo/ai-cost');
    await expect(page.getByRole('heading', { name: 'AI cost', level: 1 })).toBeVisible();
    for (const label of ['Today', 'Last 7 days', 'Last 30 days', 'This month', 'So far'])
      await expect(page.locator('.aic-label', { hasText: label })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Prompt caching' })).toContainText(
      /of the prompt tokens were read from the cache/,
    );
    await expect(
      page.getByRole('region', { name: 'Cost by day' }).locator('tbody tr').first(),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Cost by purpose' })).toContainText(
      'Bank rates refresh',
    );
    await expect(page.getByRole('region', { name: 'Cost by model' })).toContainText(
      'claude-haiku-5-5',
    );
    // a model with no price is counted in tokens, not in money, and says so
    await expect(page.getByRole('region', { name: 'How this is worked out' })).toContainText(
      'llama-3.3-70b-versatile',
    );
    await expect(page.getByRole('region', { name: 'Recent calls' })).toContainText(
      'Anthropic answered 429',
    );
  });

  test('fits the screen and is reachable from the menu', async ({ page }) => {
    await page.goto('/demo/ai-cost');
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(1);
  });
});

test('the private AI cost page needs a sign-in', async ({ page }) => {
  await page.goto('/ai-cost');
  await expect(page).toHaveURL(/\/login/);
});
