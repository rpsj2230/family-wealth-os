import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

const hero = (page: Page) => page.getByRole('region', { name: 'Net worth', exact: true });

test.describe('Home (public sample)', () => {
  test('answers the first questions: worth, what changed, how verified, what needs you', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    await expect(page.getByRole('heading', { name: 'Family wealth', level: 1 })).toBeVisible();
    const h = hero(page);
    await expect(h.getByRole('heading', { name: 'Net worth today', level: 2 })).toBeVisible();
    await expect(h.getByTestId('hm-total')).toHaveText(/^₹\d+\.\d\d (Cr|L)$/);
    await expect(h.getByTestId('hm-verified')).toHaveText(/^\d+%$/);
    for (const label of [
      'Today',
      'Last 30 days',
      'This financial year',
      'Confirmed recently',
      'Older or unconfirmed',
      'Cash and deposits',
      'Next maturity',
      'Goals on track',
      'Above the insured limit',
    ])
      await expect(h.getByText(label, { exact: false }).first()).toBeVisible();
    // a change is an arrow and a word as well as a colour
    await expect(h.locator('.bv-delta .sr-only').first()).toHaveText(/Up|Down|No change/);
    await expect(h.getByText('estimate', { exact: true })).toBeVisible();
    await h.getByText('How these figures are worked out').click();
    await expect(
      h.getByText('Verified means a value recorded within its refresh window'),
    ).toBeVisible();

    const needs = page.getByRole('region', { name: 'Needs you' });
    await expect(needs).toBeVisible();
    expect(await needs.locator('.hm-need').count()).toBeGreaterThan(0);
    await expect(needs.locator('.hm-need .hm-tag').first()).toHaveText(/Late|Soon|Note/);
    await noSideways(page);
  });

  test('every card has a heading, a chart has a text alternative and tables have captions', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    for (const name of [
      'Needs you',
      'Coming up',
      'What changed',
      'Net worth over time',
      'Where the money is',
      'How fast can I get at it?',
      'In banks',
      'Fixed deposits',
      'Mutual funds',
      'Goals',
      'What to watch',
    ])
      await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
    // split bars say their cuts in words
    await expect(
      page.getByRole('img', { name: /Net worth by kind of holding: Bank balances \d+%/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('img', { name: /How the total is known: Confirmed recently/ }),
    ).toBeVisible();
    // the trend chart is an image with a caption and the same figures as a table
    await expect(
      page.getByRole('img', { name: /Household net worth over the last year/ }),
    ).toBeVisible();
    await expect(page.getByText('Show the figures as a table')).toBeVisible();
    await expect(page.locator('table.hm-raise caption')).toHaveCount(1);
    // headings never skip a level inside a card: h1, then h2 for cards, h3 for parts
    const levels = await page
      .locator('main h1, main h2, main h3')
      .evaluateAll((els) => els.map((e) => Number(e.tagName.slice(1))));
    for (let i = 1; i < levels.length; i++)
      expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
  });

  test('the period switch is a set of links that change the chart and keep an address', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const nav = page.getByRole('navigation', { name: 'Time range' });
    await expect(nav.getByRole('link', { name: '1Y' })).toHaveAttribute('aria-current', 'true');
    await nav.getByRole('link', { name: '3M' }).click();
    await expect(page).toHaveURL(/range=3M/);
    await expect(nav.getByRole('link', { name: '3M' })).toHaveAttribute('aria-current', 'true');
    await expect(
      page.getByRole('img', { name: /Household net worth over the last 3 months/ }),
    ).toBeVisible();
    await page.goto('/demo/dashboard?range=ALL');
    await expect(nav.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByText('the same length before it')).toHaveCount(0);
    await page.goto('/demo/dashboard?range=nonsense');
    await expect(nav.getByRole('link', { name: '1Y' })).toHaveAttribute('aria-current', 'true');
  });

  test('the banks and deposits figures are the ones Accounts and Deposits show', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const banks = await page.getByTestId('hm-banks-total').innerText();
    const deposits = await page.getByTestId('hm-deposits-total').innerText();
    const funds = await page.getByTestId('hm-funds-total').innerText();
    await page.goto('/demo/accounts');
    await expect(page.getByTestId('bv-current')).toHaveText(banks);
    await page.goto('/demo/deposits');
    await expect(page.getByTestId('dv-current')).toHaveText(deposits);
    await page.goto('/demo/investments');
    await expect(page.getByText(funds).first()).toBeVisible();
  });

  test('links from Home stay inside the sample', async ({ page }) => {
    await page.goto('/demo/dashboard');
    const hrefs = await page
      .locator('main a[href]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    for (const h of hrefs) {
      if (h.startsWith('#') || h.startsWith('?')) continue;
      expect(h, h).toMatch(/^\/(demo|login)(\/|\?|$)/);
    }
    await page.locator('main').getByRole('link', { name: 'I need money' }).first().click();
    await expect(page).toHaveURL(/\/demo\/raise/);
  });

  test('fits a 390 px screen in one column, in light and in dark', async ({ browser }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme,
      });
      const page = await context.newPage();
      await page.goto('/demo/dashboard');
      await expect(hero(page).getByTestId('hm-total')).toBeVisible();
      await noSideways(page);
      // one column: every card is as wide as the next
      const widths = await page
        .locator('.hm-grid > section')
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
      expect(new Set(widths).size).toBe(1);
      await context.close();
    }
  });

  test('fits the screen at the size of the project and in dark mode', async ({ page }) => {
    await page.goto('/demo/dashboard');
    await noSideways(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await noSideways(page);
  });
});
