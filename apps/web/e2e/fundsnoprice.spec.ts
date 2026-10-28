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

const ask = (page: Page, fund: string) => page.getByRole('form', { name: `Decision: ${fund}` });

test.describe('Funds without a price (public sample)', () => {
  test('says what was found, what it suggests and why, with an Approve button naming the scheme and its code', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=match');
    const section = page.getByTestId('funds-without-price');
    await expect(section.getByRole('heading', { name: 'Funds without a price (3)' })).toBeVisible();

    // certain: the ISIN is the scheme's, although the name changed
    const certain = ask(page, 'Sample Bluechip Fund');
    await expect(certain).toContainText('What I found');
    await expect(certain).toContainText('is not matched to an official scheme');
    await expect(certain).toContainText('no price source');
    await expect(certain).toContainText('What I suggest');
    await expect(certain).toContainText('Use Sample Large Cap Fund - Direct Plan - Growth Option');
    await expect(certain).toContainText('is this scheme');
    await expect(
      certain.getByRole('button', {
        name: 'Approve: use Sample Large Cap Fund - Direct Plan - Growth Option (AMFI code 918010)',
      }),
    ).toBeVisible();
    // the last recorded value is labelled
    await expect(section.getByText('No price source').first()).toBeVisible();
    await expect(section).toContainText('last recorded value');

    // likely: the plan saved on the fund; Regular and IDCW are shown with how they differ
    const likely = ask(page, 'Sample Hybrid Fund');
    await expect(likely).toContainText('Regular instead of Direct');
    await expect(likely).toContainText('IDCW instead of Growth');
    await expect(
      likely.getByRole('radio', { name: /Sample Hybrid Fund - Direct Plan - Growth Option/ }),
    ).toBeChecked();

    // ambiguous: nothing is suggested, so there is no Approve button until one is chosen
    const unsure = ask(page, 'Sample Value Fund');
    await expect(unsure).toContainText('please choose');
    await expect(unsure.getByRole('button', { name: /^Approve: use/ })).toHaveCount(0);
    const go = unsure.getByRole('button', { name: 'Choose one of the above' });
    await expect(go).toBeDisabled();
    await unsure.getByRole('radio', { name: /Regular Plan - Growth Option/ }).check();
    await unsure.getByRole('button', { name: /^Approve my choice: use Sample Value Fund/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'nothing is saved' })).toBeVisible();
  });

  test('a search box finds schemes by name and offers them as a choice; "not a listed fund" is an option', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=match');
    const unsure = ask(page, 'Sample Value Fund');
    await expect(unsure.getByRole('radio', { name: /This is not a listed fund/ })).toBeVisible();
    await unsure.getByRole('searchbox').fill('sample hybrid regular');
    await unsure.getByRole('button', { name: 'Search' }).click();
    const hit = unsure.getByRole('radio', {
      name: /Sample Hybrid Fund - Regular Plan - Growth Option/,
    });
    await expect(hit).toBeVisible();
    await hit.check();
    await expect(
      unsure.getByRole('button', { name: /^Approve my choice: use Sample Hybrid Fund - Regular/ }),
    ).toBeEnabled();
    await unsure.getByRole('searchbox').fill('zzzzqq');
    await unsure.getByRole('button', { name: 'Search' }).click();
    await expect(unsure.getByText('Nothing in the official list matches')).toBeVisible();
  });

  test('"Approve all certain matches" is there for the ISIN-certain ones', async ({ page }) => {
    await page.goto('/demo/investments?tab=match');
    const all = page.getByRole('button', { name: 'Approve all 1 certain match' });
    await expect(all).toBeVisible();
    await all.click();
    await expect(page.getByRole('status').filter({ hasText: 'nothing is saved' })).toBeVisible();
  });

  test('the Match funds tab shows how many funds are waiting', async ({ page }) => {
    await page.goto('/demo/investments');
    await expect(page.getByText('3 without a live price')).toBeVisible();
  });
});

test.describe('It fits the screen', () => {
  for (const width of [412, 810]) {
    test(`no sideways scroll at ${width}px, also in a wide font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/demo/investments?tab=match');
      await expect(page.getByTestId('funds-without-price')).toBeVisible();
      await noSideways(page);
      await noSidewaysWide(page);
      // with a search result open as well
      const unsure = ask(page, 'Sample Value Fund');
      await unsure.getByRole('searchbox').fill('sample value');
      await unsure.getByRole('button', { name: 'Search' }).click();
      await expect(unsure.getByRole('radio', { name: /IDCW/ }).first()).toBeVisible();
      await noSideways(page);
      await noSidewaysWide(page);
    });
  }
});
