import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

test.describe('Explain movements (public sample)', () => {
  test('the recent list: each item has an answer already chosen, and holdings are told apart by bank', async ({
    page,
  }) => {
    await page.goto('/demo/reconcile');
    await expect(page.getByRole('heading', { name: 'Explain movements', level: 1 })).toBeVisible();
    const tabs = page.getByRole('navigation', { name: 'Sections' });
    await expect(tabs.getByRole('link', { name: /Recent/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tabs.getByRole('link', { name: 'Earlier months' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Matured deposits: where did the money go?' }),
    ).toBeVisible();
    // every balance to explain has one answer chosen before you touch it
    for (const item of await page.locator('section[aria-labelledby="rc-b"] .rc-item').all())
      await expect(item.locator('input[type="radio"]:checked')).toHaveCount(1);
    // the lists name the bank, not only "Cash"
    const options = await page
      .locator('select[name="dest"]')
      .first()
      .locator('option')
      .allInnerTexts();
    expect(options.some((o) => / · .* · /.test(o))).toBe(true);
    await noSideways(page);
  });

  test('earlier months: the largest unexplained months, what changed, and a form to say what it was', async ({
    page,
  }) => {
    await page.goto('/demo/reconcile?tab=history');
    await expect(
      page.getByRole('heading', { name: /Earlier months: money that moved/ }),
    ).toBeVisible();
    await expect(page.getByTestId('rc-h-cover')).toContainText('not yet explained');
    const first = page.locator('li.rc-item[data-month]').first();
    await expect(first).toBeVisible();
    const month = (await first.getAttribute('data-month'))!;
    // the three answers, one chosen; the date is held inside the month
    await expect(first.getByRole('radio')).toHaveCount(3);
    await expect(first.locator('input[type="radio"]:checked')).toHaveCount(1);
    const date = first.locator('input[name="on"]');
    expect((await date.inputValue()).slice(0, 7)).toBe(month);
    expect((await date.getAttribute('min'))!.slice(0, 7)).toBe(month);
    expect((await date.getAttribute('max'))!.slice(0, 7)).toBe(month);
    await expect(first.getByRole('button', { name: 'Save' })).toBeVisible();
    await noSideways(page);
  });

  test('interest: what the banks reported against the estimate, with a year to settle', async ({
    page,
  }) => {
    await page.goto('/demo/transactions?tab=interest');
    await expect(
      page.getByRole('heading', { name: /Interest: what the banks reported/ }),
    ).toBeVisible();
    await expect(page.getByTestId('rc-i-cover')).toContainText('1 year to settle');
    const flagged = page.locator('li.rc-item[data-state="flagged"]');
    await expect(flagged).toHaveCount(1);
    await expect(flagged.getByRole('button', { name: /Record as extra earnings/ })).toBeVisible();
    await expect(page.locator('li.rc-item[data-state="ok"]')).toHaveCount(1);
    await noSideways(page);
  });

  test('bank statements: what every line was, the years, and the lines to answer', async ({
    page,
  }) => {
    await page.goto('/demo/transactions?tab=statements');
    await expect(
      page.getByRole('heading', { name: /Bank statements: what every line was/ }),
    ).toBeVisible();
    await expect(page.getByTestId('rc-s-cover')).toBeVisible();
    await expect(page.getByTestId('rc-s-years')).toBeVisible();
    await expect(page.getByTestId('rc-s-ask')).toContainText('1 line');
    const ask = page.locator('li.rc-item[data-line]');
    await expect(ask).toHaveCount(1);
    await expect(ask).toContainText('NEFT TO SAMPLE BUILDER');
    await expect(ask.getByRole('radio')).toHaveCount(2);
    await expect(ask.locator('input[type="radio"]:checked')).toHaveCount(1);
    await noSideways(page);
  });

  test('Import recognises a bank statement and offers its form', async ({ page }) => {
    await page.goto('/demo/import');
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'Acct Statement_XX1234_2024.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          'Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/04/24,NEFT CR,,,"25,000.00","1,25,000.00"\n',
        ),
      });
    await expect(page.getByRole('heading', { name: 'Bank statement' })).toBeVisible();
    // the account is chosen from the last four digits in the file name
    await expect(
      page
        .getByRole('region', { name: 'What happens next' })
        .locator('select')
        .filter({ hasText: 'Sample Bank' }),
    ).toHaveValue('a1');
    await noSideways(page);
  });

  test('Home links to it from the sample', async ({ page }) => {
    await page.goto('/demo/dashboard');
    // the link on the page itself (the side menu on a wide screen also has one, to the signed-in page)
    await expect(
      page.getByRole('main').getByRole('link', { name: 'Explain movements' }).first(),
    ).toHaveAttribute('href', '/demo/reconcile');
  });
});
