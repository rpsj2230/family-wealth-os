import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe('Changing a fund (public sample)', () => {
  test('the SIP plan lists every dated change and can change, stop or pause the SIP from a date', async ({
    page,
  }) => {
    await page.goto('/demo/asset?kind=fund');
    const tabs = page.getByRole('navigation', { name: 'Sections' });
    await tabs.getByRole('link', { name: 'SIP plan' }).click();
    await expect(page).toHaveURL(/tab=sip/);
    const plan = page.getByTestId('sip-plan');
    await expect(plan.getByRole('heading', { name: 'SIP plan' })).toBeVisible();
    await expect(plan.getByTestId('sip-now')).toContainText('a month');
    await expect(plan.getByTestId('sip-changes').locator('tbody tr')).toHaveCount(2);
    await expect(plan.getByText('in force now')).toBeVisible();

    // a pause asks for the day it starts again
    await plan.getByLabel('Pause it').check();
    await expect(plan.getByLabel('Starts again on')).toBeVisible();
    await expect(plan.getByRole('button', { name: 'Save the change' })).toBeDisabled();
    await plan.getByLabel('Paused from').fill('2026-12-01');
    await plan.getByLabel('Starts again on').fill('2027-04-01');
    await plan.getByRole('button', { name: 'Save the change' }).click();
    await expect(plan.getByTestId('sip-result')).toContainText('sample');

    // the account it is paid from
    await expect(plan.getByTestId('sip-pay-from')).toHaveValue('demo-acc-1');
  });

  test('a sale can be for every unit: no units are asked for', async ({ page }) => {
    await page.goto('/demo/investments');
    await page.getByRole('button', { name: 'Add a transaction' }).first().click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Type').selectOption('redeem');
    await sheet.getByTestId('txn-all').getByRole('checkbox').check();
    await expect(sheet.getByLabel(/^Units/)).toBeDisabled();
  });

  test('the SIP plan fits a 390 px screen in light and dark', async ({ browser }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme,
      });
      const page = await context.newPage();
      await page.goto('/demo/asset?kind=fund&tab=sip');
      await expect(page.getByTestId('sip-plan')).toBeVisible();
      await page.getByLabel('Pause it').check();
      await noSideways(page);
      await context.close();
    }
  });
});
