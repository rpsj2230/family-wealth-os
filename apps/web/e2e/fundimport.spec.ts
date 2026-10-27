import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

/** The same check with a wide default font, as on a machine without the app's fonts: nothing may reach beyond the screen. */
const noSidewaysWide = async (page: Page) => {
  await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [...document.querySelectorAll('body *')]
      .filter((e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.right > vw + 1;
      })
      .slice(0, 5)
      .map((e) => `${e.tagName}.${String(e.className).slice(0, 40)}`);
    return { over: document.documentElement.scrollWidth - vw, bad };
  });
  expect(r.over, JSON.stringify(r.bad)).toBeLessThanOrEqual(0);
};

const person = (page: Page, name: string) =>
  page.getByRole('region', { name: `Changes for ${name}` });
const row = (page: Page, name: string) => page.locator('li.fc-row', { hasText: name });

test.describe('Preview changes for a fund statement (public sample)', () => {
  test('lists only what is new or changed, with chips, before and after, and the reason', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    await expect(
      page.getByRole('heading', { name: 'What a preview looks like (sample)' }),
    ).toBeVisible();
    const anil = person(page, 'Anil');
    await expect(anil).toContainText('4 funds with something new or changed, 1 unchanged');

    const flexi = row(page, 'Sample Flexi Cap');
    await expect(flexi.locator('.fc-chip', { hasText: '+2 transactions' })).toBeVisible();
    await expect(flexi.locator('.fc-nums')).toContainText('1,200.25');
    await expect(flexi.locator('.fc-nums')).toContainText('1,450.5');
    await expect(flexi.locator('.fc-nums')).toContainText('₹1,50,000');
    await expect(flexi.locator('.fc-nums')).toContainText('₹1,80,000');
    await flexi.getByText('2 new transactions').click();
    await expect(flexi.locator('.fc-table')).toContainText('SIP instalment');

    const large = row(page, 'Sample Large Cap');
    await expect(large.locator('.fc-chip', { hasText: 'SIP stopped' })).toBeVisible();
    await expect(large).toContainText('The last instalment was on 5 Mar 2026');
    await expect(large).toContainText('none came by 25 Oct 2026');

    const index = row(page, 'Sample Index');
    await expect(index.locator('.fc-chip', { hasText: 'SIP ₹5,000 → ₹8,000' })).toBeVisible();
    await expect(index).toContainText('since 5 May 2026');

    const sold = row(page, 'Sample Old Fund');
    await expect(sold.locator('.fc-chip', { hasText: 'Sold' })).toBeVisible();
    await expect(sold).toContainText(
      'Not on the statement dated 25 Oct 2026, which lists all your funds.',
    );

    // a fund with nothing new is folded away, not listed as a row
    await expect(page.locator('li.fc-row', { hasText: 'Sample Balanced' })).toHaveCount(0);
    const folded = anil.locator('details.fc-quiet');
    await expect(folded).toContainText('1 fund unchanged, left alone');
    await folded.locator('summary').click();
    await expect(folded).toContainText('Sample Balanced Fund');
    await noSideways(page);
  });

  test('a new fund is marked new, and its SIP goes with it', async ({ page }) => {
    await page.goto('/demo/import?tab=cas');
    const mid = row(page, 'Sample Mid Cap');
    await expect(mid.locator('.fc-chip', { hasText: 'New fund' })).toBeVisible();
    await expect(mid.locator('.fc-chip', { hasText: 'SIP new' })).toBeVisible();
    const fund = mid.getByRole('checkbox', { name: /Apply the changes to Sample Mid Cap/ });
    const sip = mid.getByRole('checkbox', { name: /Apply the SIP change to Sample Mid Cap/ });
    await expect(fund).toBeChecked();
    await expect(sip).toBeChecked();
    await fund.uncheck();
    await expect(sip).not.toBeChecked();
    await expect(sip).toBeDisabled();
    await fund.check();
    await expect(sip).toBeEnabled();
    await expect(sip).toBeChecked();
  });

  test('a verdict can be overruled on its own: the SIP stop unticked leaves the fund ticked', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    const large = row(page, 'Sample Large Cap');
    const sip = large.getByRole('checkbox', { name: /Apply the SIP change to Sample Large Cap/ });
    await expect(sip).toBeChecked();
    await sip.uncheck();
    await expect(sip).not.toBeChecked();
    await expect(large.locator('.fc-sip')).toHaveClass(/off/);
    await sip.check();
    await expect(sip).toBeChecked();
  });

  test('the same sample is on the fund app export page; applying is not available there', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=csv');
    await expect(
      page.getByRole('heading', { name: 'What a preview looks like (sample)' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply the selected changes' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Preview changes' })).toBeVisible();
  });

  test('recent statements say what changed, in one line, with the list behind it', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    await expect(
      page.getByText('2 funds updated: +5 transactions; 1 SIP stopped; 1 fund sold'),
    ).toBeVisible();
  });
});

test.describe('The preview fits the screen', () => {
  for (const width of [412, 810]) {
    test(`no sideways scroll at ${width}px, also in a wide font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/demo/import?tab=cas');
      await expect(person(page, 'Anil')).toBeVisible();
      for (const d of await page.locator('details.fc-lines').all())
        await d.locator('summary').click();
      await noSideways(page);
      await noSidewaysWide(page);
    });
  }
});
