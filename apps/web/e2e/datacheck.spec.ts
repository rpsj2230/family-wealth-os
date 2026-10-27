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

test.describe('The data check on Investments (public sample)', () => {
  test('under each person: how many funds reconcile, what is missing and how to fix it', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=funds');
    const checks = page.getByTestId('data-check');
    await expect(checks).toHaveCount(2);
    const anil = checks.first();
    await expect(anil).toContainText('Data check');
    await expect(anil).toContainText('3 of 4 funds reconcile');
    await expect(anil).toContainText('1 need earlier history');
    await expect(anil).toContainText('earliest transaction on file is 12 Jul 2021');
    // the list of funds that need something opens by itself and names the units before the first line
    await expect(anil).toContainText('Sample Small Cap Fund');
    await expect(anil).toContainText('300 units were held before');
    await expect(anil).toContainText('DETAILED');
    await expect(anil).toContainText('1 Jan 2021');
    const beena = checks.nth(1);
    await expect(beena).toContainText('1 of 4 funds reconciles');
    await expect(beena).toContainText('has missing lines');
    await expect(beena).toContainText('Gap: lines missing');
    await noSideways(page);
  });

  test('every fund carries a status chip, and a fund that does not add up carries est.', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=funds');
    await expect(page.getByText('✓ Reconciled').first()).toBeVisible();
    await expect(page.getByText('⚠ Starts midway: 300 units before first line')).toBeVisible();
    await expect(page.getByText(/⚠ Gap: .* to /)).toBeVisible();
    await expect(page.getByText('– No transactions').first()).toBeVisible();
    // the figures of the funds that do not reconcile carry the mark, and so do the group totals they are part of
    await expect(page.locator('.fundslist tr.fl-row abbr.bv-est').first()).toBeVisible();
    await noSideways(page);
  });

  test('the overview asks "Is the history complete?" and marks the headline figures', async ({
    page,
  }) => {
    await page.goto('/demo/investments');
    await expect(page.getByRole('heading', { name: 'Is the history complete?' })).toBeVisible();
    const hero = page.getByRole('region', { name: 'Mutual funds at a glance' });
    await expect(hero.locator('abbr.bv-est').first()).toBeVisible();
    await expect(hero).toContainText('not reconciled yet');
    await noSideways(page);
  });

  test('wide fonts: no sideways scroll on the funds tab or the overview', async ({ page }) => {
    for (const path of ['/demo/investments?tab=funds', '/demo/investments']) {
      await page.goto(path);
      await noSidewaysWide(page);
    }
  });
});

test.describe('The fund page (public sample)', () => {
  test('a fund that reconciles: "Does this add up?" is a closed one-liner with the facts inside', async ({
    page,
  }) => {
    await page.goto('/demo/asset?kind=fund&id=f7');
    const block = page.getByTestId('adds-up');
    await expect(block).toContainText('Does this add up?');
    await expect(block).toContainText('Reconciled');
    await expect(block).not.toHaveAttribute('open', '');
    await block.locator('summary').click();
    await expect(block).toContainText('First transaction');
    await expect(block).toContainText('Units held');
    await noSideways(page);
  });

  test('a fund that starts midway or has a gap says so, open, with the numbers', async ({
    page,
  }) => {
    await page.goto('/demo/asset?kind=fund&id=f2');
    const mid = page.getByTestId('adds-up');
    await expect(mid).toHaveAttribute('open', '');
    await expect(mid).toContainText('Starts midway: 300 units before first line');
    await expect(mid).toContainText('Held before the first line');
    await expect(mid).toContainText('DETAILED');
    await expect(page.locator('.fundhero abbr.bv-est').first()).toBeVisible();

    await page.goto('/demo/asset?kind=fund&id=f3');
    const gap = page.getByTestId('adds-up');
    await expect(gap).toHaveAttribute('open', '');
    await expect(gap).toContainText('Where the lines do not follow each other');
    await expect(gap).toContainText(/units appear that no line explains/);
    await noSideways(page);
  });

  test('exit load and tax: under the load, short and long term, and what to take out', async ({
    page,
  }) => {
    await page.goto('/demo/asset?kind=fund&id=f1');
    const panel = page.getByTestId('tax-panel');
    await expect(panel.getByRole('heading', { name: 'Exit load and tax' })).toBeVisible();
    await expect(page.getByTestId('exit-load-status')).toContainText(
      /Exit load applies today to [\d.,]+ units \(1%\) until/,
    );
    await expect(panel).toContainText('Not set for this fund');
    await expect(panel.getByRole('link', { name: 'Set it for this fund' })).toBeVisible();
    for (const label of [
      'Under exit load',
      'Free of exit load',
      'Short-term (STCG)',
      'Long-term (LTCG)',
      'At a loss',
    ])
      await expect(panel).toContainText(label);
    const lots = panel.locator('details.tp-lots');
    await lots.locator('summary').click();
    await expect(lots.getByRole('columnheader', { name: 'Exit-load free from' })).toBeVisible();
    await expect(lots.getByRole('columnheader', { name: 'Long-term from' })).toBeVisible();
    await expect(lots.locator('tbody tr').first()).toContainText('LTCG');
    await expect(lots.locator('tbody tr').last()).toContainText('Exit load');
    await expect(lots.locator('tbody tr').last()).toContainText('STCG');
    await expect(lots.locator('tfoot')).toContainText('under');
    // the harvest advice and the way to the Tax page
    const advice = page.getByTestId('harvest-advice');
    await expect(advice).toContainText('Nothing to do now');
    await expect(advice).toContainText('Used on this fund instead');
    await expect(advice.getByRole('link', { name: /Tax page/ })).toHaveAttribute(
      'href',
      '/demo/tax-harvest',
    );
    // how much to take out for an amount
    await panel.getByLabel(/How much to take out/).fill('100000');
    await expect(panel).toContainText(/Sell about [\d.,]+ units for ₹1,00,000/);
    await expect(panel).toContainText('Exit load about');
    await noSideways(page);
  });

  test('a fund the plan picks says how much to sell now; its own exit load is shown as set', async ({
    page,
  }) => {
    await page.goto('/demo/asset?kind=fund&id=f8');
    const advice = page.getByTestId('harvest-advice');
    await expect(advice).toContainText(/Take out about ₹/);
    await expect(advice).toContainText('oldest units first');
    await expect(advice.locator('table')).toBeVisible();
    await page.goto('/demo/asset?kind=fund&id=f2');
    const panel = page.getByTestId('tax-panel');
    await expect(panel).not.toContainText('Not set for this fund');
    await expect(panel).toContainText('est.');
    await panel.locator('details.tp-lots summary').click();
    await expect(panel.locator('details.tp-lots')).toContainText('Before the first line');
    await noSideways(page);
  });

  test('a fund bought within the exit-load window, a gold fund and a fund with no purchases', async ({
    page,
  }) => {
    await page.goto('/demo/asset?kind=fund&id=f7');
    await expect(page.getByTestId('exit-load-status')).toContainText('Exit load applies today to');
    await expect(page.getByTestId('harvest-advice')).toContainText('Nothing to do now');
    await page.goto('/demo/asset?kind=fund&id=f5');
    await expect(page.getByTestId('harvest-advice')).toContainText('no yearly tax-free allowance');
    await page.goto('/demo/asset?kind=fund&id=f4');
    await expect(page.getByTestId('tax-panel')).toContainText('No purchases are on file');
    await noSideways(page);
  });

  test('wide fonts: no sideways scroll on the fund pages', async ({ page }) => {
    for (const id of ['f1', 'f2', 'f3', 'f7']) {
      await page.goto(`/demo/asset?kind=fund&id=${id}`);
      await noSidewaysWide(page);
    }
  });
});
