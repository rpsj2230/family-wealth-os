import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe('Report centre (public sample)', () => {
  test('the existing Reports tabs stay, with the Report centre added', async ({ page }) => {
    await page.goto('/demo/reports');
    const tabs = page.getByRole('navigation', { name: 'Sections' });
    for (const name of ['Deposits', 'Mutual funds', 'Report centre'])
      await expect(tabs.getByRole('link', { name })).toBeVisible();
    await tabs.getByRole('link', { name: 'Report centre' }).click();
    await expect(page).toHaveURL(/tab=centre/);
    await expect(
      page
        .getByTestId('centre-result')
        .getByRole('heading', { name: 'Net worth', exact: true, level: 2 }),
    ).toBeVisible();
  });

  test('a report runs for a period with filters, grouping and a comparison, and says what it rests on', async ({
    page,
  }) => {
    await page.goto('/demo/reports?tab=centre&t=transactions&period=last-fy&g=month&cmp=1');
    const r = page.getByTestId('centre-result');
    await expect(r.getByTestId('centre-range')).toContainText('FY 2025-26');
    await expect(r.getByTestId('centre-range')).toContainText('compared with FY 2024-25');
    await expect(r.getByRole('heading', { name: 'Transactions by month' })).toBeVisible();
    await expect(r.getByText(/^FY 2024-25: /).first()).toBeVisible();
    await expect(r.getByTestId('centre-basis')).toBeVisible();
    await expect(r.getByRole('heading', { name: 'What the figures rest on' })).toBeVisible();
    // the filters round-trip through the form
    await page.getByRole('combobox', { name: 'Transaction type', exact: true }).selectOption('sip');
    await page.getByRole('button', { name: 'Run report' }).click();
    await expect(page).toHaveURL(/kind=sip/);
    await expect(r.getByTestId('centre-applied')).toContainText('Type: SIP instalment');
  });

  test('a phrase is read into visible filters and runs only when asked', async ({ page }) => {
    await page.goto('/demo/reports?tab=centre');
    await page
      .getByLabel('Describe the report')
      .fill("Anil's FDs maturing in the next 90 days above 5 lakh");
    await page.getByRole('button', { name: 'Read it' }).click();
    const read = page.getByTestId('centre-read');
    for (const t of [
      'Report: Deposit maturities',
      'Next 90 days',
      'Person: Anil',
      'Amount at least ₹5,00,000',
    ])
      await expect(read.getByText(t)).toBeVisible();
    await read.getByRole('link', { name: 'Run this report' }).click();
    await expect(page).toHaveURL(/t=maturities/);
    await expect(page.getByTestId('centre-applied')).toContainText('Person: Anil');
  });

  test('downloads an Excel workbook and offers print or PDF', async ({ page }) => {
    await page.goto('/demo/reports?tab=centre&t=funds');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('centre-xlsx').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^funds-.*\.xlsx$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    // a zip file (the .xlsx container)
    expect(Buffer.concat(chunks).subarray(0, 2).toString()).toBe('PK');
    await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();
  });

  test('a report that lives on its own page says so; the recent list remembers what was opened', async ({
    page,
  }) => {
    await page.goto('/demo/reports?tab=centre&t=funds');
    await page.goto('/demo/reports?tab=centre&t=tax');
    await expect(page.getByTestId('centre-result')).toContainText('This report has its own page');
    await expect(page.getByTestId('centre-recent')).toContainText('Mutual funds');
  });

  test('fits a 390 px screen in light and dark', async ({ browser }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme,
      });
      const page = await context.newPage();
      for (const t of ['networth', 'funds', 'transactions', 'maturities'])
        await page.goto(`/demo/reports?tab=centre&t=${t}`).then(() => noSideways(page));
      await context.close();
    }
  });
});
