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

  test('Home links to it from the sample', async ({ page }) => {
    await page.goto('/demo/dashboard');
    await expect(page.getByRole('link', { name: 'Explain movements' }).first()).toHaveAttribute(
      'href',
      '/demo/reconcile',
    );
  });
});
