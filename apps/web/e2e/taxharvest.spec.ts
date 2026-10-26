import { expect, test } from '@playwright/test';

test.describe('Tax harvest (public sample)', () => {
  test('gives one headline per person and a sell list with exact units', async ({ page }) => {
    await page.goto('/demo/tax-harvest');
    await expect(page.getByRole('heading', { name: 'Tax', level: 1 })).toBeVisible();
    const heads = page.locator('.tx-headline');
    await expect(heads).toHaveCount(2);
    await expect(heads.first()).toContainText(/can book ₹[\d,]+ of tax-free gain this year/);
    await expect(heads.first()).toContainText('before 31 March 2027');
    // every fund to sell shows units as plain digits with three decimals, never a dash
    const units = page.locator('.tx-item .tx-units');
    expect(await units.count()).toBeGreaterThanOrEqual(3);
    for (const t of await units.allInnerTexts()) expect(t).toMatch(/^\d+\.\d{3}$/);
    await expect(
      page.locator('.tx-item').first().getByRole('button', { name: /Copy/ }),
    ).toBeVisible();
    // plain-language checks from the settings
    await expect(page.getByText('Held over 12 months, long-term').first()).toBeVisible();
    await expect(page.getByText('No exit load (past 90 days)').first()).toBeVisible();
    await expect(page.getByText('Within this year’s free allowance').first()).toBeVisible();
    await expect(page.getByText('Lots: from your statement').first()).toBeVisible();
    await expect(page.getByText(/Lots: estimated from your SIP history/).first()).toBeVisible();
    // sections for the rest
    await expect(page.getByRole('heading', { name: /Do not sell yet/ }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: /Losses you can book/ }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'On the platform' })).toBeVisible();
    await expect(page.getByText(/Costs to expect: stamp duty, STT, exit load/)).toBeVisible();
  });

  test('keeps buying back out of the main view and shows the lots in the working', async ({
    page,
  }) => {
    await page.goto('/demo/tax-harvest');
    const shown = await page.locator('main').innerText();
    expect(shown).not.toMatch(/buy.?back|buy first|buying/i);
    const first = page.locator('.tx-item').first();
    await first.getByText('Show the working').click();
    await expect(first.getByText('10 Feb 2025')).toBeVisible();
    await expect(first.getByText(/Amount to put back into the fund/)).toBeVisible();
    await expect(first.getByText('Exact', { exact: true })).toBeVisible();
    await expect(first.getByText('Long-term').first()).toBeVisible();
  });

  test('has no sideways scroll, also with every disclosure open', async ({ page }) => {
    await page.goto('/demo/tax-harvest');
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.evaluate(() =>
      document.querySelectorAll('details').forEach((d) => d.setAttribute('open', '')),
    );
    expect(await overflow()).toBeLessThanOrEqual(0);
  });
});
