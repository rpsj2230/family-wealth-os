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
    await expect(h.getByText('est.', { exact: true }).first()).toBeVisible();
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
      'By kind of holding',
      'Profit earned, by period',
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

  test('shows what was put in, what it is worth, the profit and what was earned today', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const figures = hero(page).getByRole('group', { name: 'Money figures' });
    for (const label of [
      'Total invested',
      'Current value',
      'Maturity value',
      'Total profit so far',
      'Earned today',
    ])
      await expect(figures.locator('.bv-delta-label', { hasText: label })).toBeVisible();
    // big lakh or crore figures, the exact amount beneath, and the net worth is the current value
    for (const id of ['hm-invested', 'hm-current', 'hm-maturity', 'hm-profit', 'hm-earned-today'])
      await expect(figures.getByTestId(id)).toHaveText(/^₹[\d,]+(\.\d\d (Cr|L))?$/);
    await expect(figures.getByTestId('hm-current')).toHaveText(
      await hero(page).getByTestId('hm-total').innerText(),
    );
    await expect(figures.locator('.bv-exact').first()).toHaveText(/^₹\d{1,2},\d\d,\d\d,\d{3}$/);
    // a gain says so in words as well as in colour, and today’s earning is marked as an estimate
    await expect(figures.locator('.bv-delta.up .sr-only').first()).toHaveText(/Up/);
    await expect(figures.getByText('est.', { exact: true }).first()).toBeVisible();
    await noSideways(page);
  });

  test('four small cards, one per kind of holding, each linking to its own page', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const section = page.getByRole('region', { name: 'By kind of holding' });
    await expect(section.getByRole('heading', { level: 3 })).toHaveText([
      'Fixed deposits ›',
      'Mutual funds ›',
      'Cash ›',
      'Others ›',
    ]);
    const hrefs: Record<string, string> = {
      fd: '/demo/deposits',
      funds: '/demo/investments',
      cash: '/demo/cash',
      others: '/demo/others',
    };
    for (const [key, href] of Object.entries(hrefs)) {
      const card = section.getByTestId(`hm-class-${key}`);
      await expect(card.getByRole('link').first()).toHaveAttribute('href', href);
      for (const label of ['Invested', 'Earned so far', 'Profit so far'])
        await expect(card.getByText(label, { exact: true })).toBeVisible();
      await expect(card.getByText(/% of net worth/)).toBeVisible();
    }
    // a loss or a gain is an arrow and a word, never colour alone
    await expect(section.locator('.hm-signed .sr-only').first()).toHaveText(/up|down|no change/);
    // the definitions are stated, including where the cash rate comes from
    await section.getByText('How these are worked out').click();
    await expect(section.getByText('rate on the Rates list for its bank')).toBeVisible();
    await expect(section.getByText('Invested is the money still in the funds')).toBeVisible();
    // the same deposits as the Deposits page, plus those waiting to be confirmed (told in a note)
    await expect(section.getByTestId('hm-class-fd').getByText(/past their date/)).toBeVisible();
    await noSideways(page);
  });

  test('profit by period: every kind and the total, in six periods, with the money moved shown apart', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const card = page.getByRole('region', { name: 'Profit earned, by period' });
    const table = card.getByTestId('hm-periods');
    await expect(table.getByRole('columnheader')).toHaveText([
      /Kind/,
      /Last 30 days/,
      /This month/,
      /This quarter/,
      /This financial year/,
      /Last financial year/,
      /Since the start/,
    ]);
    await expect(table.getByRole('rowheader')).toHaveText([
      'Fixed deposits',
      'Mutual funds',
      'Cash',
      'Others',
      'Total',
    ]);
    // each cell is an arrow and a word, and money put in or paid out is told beneath, never counted as profit
    await expect(table.locator('tbody .sr-only').first()).toHaveText(
      /Up|Down|No change|nothing held/,
    );
    await expect(table.getByText(/put in/).first()).toBeVisible();
    await expect(table.getByText(/paid out/).first()).toBeVisible();
    await expect(table.getByText('est.', { exact: true }).first()).toBeVisible();
    // a sentence says the same in words
    await expect(card.getByTestId('hm-periods-summary')).toContainText(/last 30 days earned ₹/);
    await card.getByText('How these are worked out').click();
    await expect(card.getByText('an exchange rate is not interest')).toBeVisible();
    await noSideways(page);
  });

  test('profit by period reads as one card per kind on a phone, without sideways scrolling', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/demo/dashboard');
    const rows = page.getByTestId('hm-periods').locator('tbody tr');
    await expect(rows).toHaveCount(5);
    // stacked: each cell carries its period as a label on the left
    await expect(rows.first().locator('td').first()).toHaveCSS('display', 'flex');
    const box = await page.getByTestId('hm-periods').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    await noSideways(page);
    await context.close();
  });

  test('the four cards sit in a row on a wide screen, two by two and then one by one when narrow', async ({
    browser,
  }) => {
    const cols = async (width: number) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      await page.goto('/demo/dashboard');
      const tops = await page
        .locator('.hm-class')
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      await context.close();
      return new Set(tops).size;
    };
    expect(await cols(1500)).toBe(1);
    expect(await cols(390)).toBe(4);
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
