import { expect, test } from '@playwright/test';

test.describe('Can I retire now? (public sample page)', () => {
  test('shows a clear status, the corpus numbers, and fits the screen', async ({ page }) => {
    await page.goto('/demo/retire');
    await expect(page.getByText('These are sample numbers')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2 }).filter({ hasText: /Projected|Insufficient/ }),
    ).toBeVisible();
    await expect(page.getByText('Corpus needed (today')).toBeVisible();
    await expect(page.getByText('Earliest age that meets the plan')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('refuses a verdict when spending is missing, and says what is needed', async ({ page }) => {
    await page.goto('/demo/retire');
    const spending = page.getByLabel(/Monthly spending after retirement/);
    await spending.fill('');
    await expect(page.locator('.statusline')).toHaveText('Insufficient data to assess');
    await expect(
      page.locator('.hero').getByText('monthly spending after retirement'),
    ).toBeVisible();
    await expect(page.getByText(/not show a verdict/)).toBeVisible();
    await spending.fill('150000');
    await expect(page.locator('.statusline')).not.toHaveText('Insufficient data to assess');
  });

  test('changing the retirement age or spending changes the answer', async ({ page }) => {
    await page.goto('/demo/retire');
    const needed = () => page.locator('.status-ok, .status-warn').first().innerText();
    const before = await needed();
    await page.getByLabel(/Monthly spending after retirement/).fill('400000');
    await expect(page.locator('.statusline')).toHaveText(
      'Projected shortfall under these assumptions',
    );
    expect(await needed()).not.toBe(before);
    await page.getByLabel(/Monthly spending after retirement/).fill('20000');
    await expect(page.locator('.statusline')).toHaveText(
      'Projected to meet the plan under these assumptions',
    );
  });

  test('on-demand tools: effect of changes and range of outcomes', async ({ page }) => {
    await page.goto('/demo/retire?tab=compare');
    await page.getByRole('button', { name: 'Show the effect of common changes' }).click();
    await expect(page.getByText('Invest ₹10,000 more per month')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('link', { name: 'Range of outcomes' }).click();
    await page.getByRole('button', { name: 'Run the simulation' }).click();
    await expect(page.getByText(/of paths last the whole plan/)).toBeVisible({ timeout: 20_000 });
  });

  test('is reachable without signing in, but the private version is not', async ({ request }) => {
    expect((await request.get('/demo/retire')).status()).toBe(200);
    const res = await request.get('/retire', { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
  });
});
