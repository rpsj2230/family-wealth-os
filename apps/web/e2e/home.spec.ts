import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

const hero = (page: Page) => page.getByRole('region', { name: 'Net worth', exact: true });

test.describe('Home (public sample)', () => {
  test('says, under the period tiles, that fund gains are approximate while funds have no ledger', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const note = page.getByTestId('hm-fund-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText(
      'Fund gains are approximate until you import your fund statements',
    );
    await expect(note).toContainText(/\d+ of \d+ funds? (has|have) no transaction ledger/);
    await noSideways(page);
  });

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
      'Own money put in (lifetime)',
      'Lifetime profit',
      'Yearly return (XIRR)',
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
      'Wealth movement',
      'By kind of holding',
      'Needs you',
      'Coming up',
      'Net worth over time',
      'Where the money is',
      'Goals',
    ])
      await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
    // each figure once: the panels whose figures live on their own pages are not repeated on Home
    for (const gone of [
      'Profit earned, by period',
      'In banks',
      'How fast can I get at it?',
      'What to watch',
    ])
      await expect(page.getByRole('heading', { name: gone, level: 2 })).toHaveCount(0);
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
    await expect(page.locator('table.hm-move-table caption')).toHaveCount(1);
    // headings never skip a level inside a card: h1, then h2 for cards, h3 for parts
    const levels = await page
      .locator('main h1, main h2, main h3')
      .evaluateAll((els) => els.map((e) => Number(e.tagName.slice(1))));
    for (let i = 1; i < levels.length; i++)
      expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
  });

  test('shows own money put in, profit so far, the yearly return and the matured money to place', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const figures = hero(page).getByRole('group', { name: 'Own money and profit' });
    for (const label of ['Own money put in (lifetime)', 'Lifetime profit', 'Yearly return (XIRR)'])
      await expect(figures.locator('.hm-cap-label', { hasText: label })).toBeVisible();
    await expect(figures.getByTestId('hm-own-money')).toHaveText(/^₹\d+\.\d\d (Cr|L)$/);
    await expect(figures.getByTestId('hm-profit-so-far')).toHaveText(/^[+−]₹[\d,]+$/);
    await expect(figures.getByTestId('hm-xirr')).toHaveText(/^-?\d+\.\d%$|^–$/);
    // money moved with nothing to say what it was is shown apart, never as profit
    await expect(figures).toContainText('worked out from balances');
    await expect(figures.getByText('est.', { exact: true }).first()).toBeVisible();
    // the proceeds of matured deposits are counted once, with a way to say where they went
    await expect(figures.getByTestId('hm-proceeds')).toHaveText(/^₹\d+\.\d\d (Cr|L)$/);
    await page.locator('[data-why="home.profitSoFar"]').first().click();
    await expect(page.getByTestId('why-panel')).toContainText('own money');
    await page.keyboard.press('Escape');
    await noSideways(page);
  });

  test('the period tiles start where the period really starts and say what they rest on', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const deltas = hero(page).getByLabel('How net worth changed');
    const month = deltas.locator('.bv-delta', { hasText: 'Last 30 days' });
    // the period begins on its own first day, not on "your first record"
    await expect(month).toContainText('since 26 Sep 2026');
    await expect(deltas).not.toContainText('first record');
    // how many holdings the first day rests on, and that net worth moved by a different amount
    await expect(month).toContainText(/\d+ of \d+ holdings had a value then/);
    await expect(month).toContainText('Net worth moved');
    // the "?" names the records the first day is built from
    await page.locator('[data-why="home.month"]').first().click();
    const panel = page.getByTestId('why-panel');
    await expect(panel).toContainText('nearest record on or before');
    await page.keyboard.press('Escape');
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
      for (const label of [
        'Cost of current holdings',
        'Earned since first record',
        'Gain on current holdings',
      ])
        await expect(card.getByText(label, { exact: true })).toBeVisible();
      await expect(card.getByText(/% of net worth/)).toBeVisible();
    }
    // a loss or a gain is an arrow and a word, never colour alone
    await expect(section.locator('.hm-signed .sr-only').first()).toHaveText(/up|down|no change/);
    // where the funds' value comes from, and whether their prices are fresh
    const split = section.getByTestId('hm-fund-split');
    await expect(split).toContainText('confirmed by fund statements');
    await expect(split).toContainText(/fund prices? older than|Every fund price is within/);
    // the definitions are stated, including where the cash rate comes from
    await section.getByText('How these are worked out').click();
    await expect(section.getByText('rate on the Rates list for its bank')).toBeVisible();
    await expect(section.getByText('Invested is the money still in the funds')).toBeVisible();
    // the same deposits as the Deposits page, plus those waiting to be confirmed (told in a note)
    await expect(section.getByTestId('hm-class-fd').getByText(/past their date/)).toBeVisible();
    await noSideways(page);
  });

  test('wealth movement: outside money apart from what was earned, for the period chosen, adding up', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const card = page.getByRole('region', { name: 'Wealth movement' });
    const nav = card.getByRole('navigation', { name: 'Period' });
    await expect(nav.getByRole('link', { name: 'This FY' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    const table = card.getByTestId('hm-move');
    for (const label of [
      'Net worth on 1 Apr 2026',
      'Outside money, confirmed',
      'Moved in or out, not yet explained',
      'Interest on savings',
      'Interest on deposits',
      'Fund gains and losses',
    ])
      await expect(table.getByRole('rowheader', { name: label })).toBeVisible();
    await expect(card).toContainText(/Earned [+−]₹/);
    // another period keeps the chart's range in the address
    await nav.getByRole('link', { name: '6 months' }).click();
    await expect(page).toHaveURL(/period=6m/);
    await expect(page).toHaveURL(/range=1Y/);
    await expect(nav.getByRole('link', { name: '6 months' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // custom months
    await page.goto('/demo/dashboard?period=custom&from=2026-04&to=2026-09');
    await expect(card.getByTestId('hm-move')).toContainText('Net worth on 1 Apr 2026');
    await expect(card.getByTestId('hm-move')).toContainText(/Net worth on 30 Sept? 2026/);
    // a period that begins before the records do begins where they do, and says so
    await page.goto('/demo/dashboard?period=custom&from=2020-01&to=2026-09');
    await expect(card).toContainText('The records start on');
    await noSideways(page);
  });

  test('wealth movement fits a phone without sideways scrolling', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto('/demo/dashboard');
    const box = await page.getByTestId('hm-move').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    await noSideways(page);
    await context.close();
  });

  test('acceptance test 15: the summary at the top states each figure once, with no repeated headline metric', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const hero = page.getByRole('region', { name: 'Net worth' });
    const labels = (
      await hero.locator('.bv-eyebrow, .bv-delta-label, .hm-cap-label, dl dt').allInnerTexts()
    )
      .map((t) => t.replace(/\?/g, '').replace(/\s+/g, ' ').trim().toLowerCase())
      .filter(Boolean);
    expect(labels.length).toBeGreaterThan(5);
    expect(new Set(labels).size).toBe(labels.length);
    // net worth is shown once at the top: no second "total" tile repeats it
    await expect(page.getByTestId('hm-total')).toHaveCount(1);
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

  for (const w of [412, 810]) {
    test(`the period tiles do not scroll sideways with a wide font at ${w}px`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: { width: w, height: 900 } });
      const page = await context.newPage();
      await page.goto('/demo/dashboard');
      await page.addStyleTag({
        content: '* { font-family: "DejaVu Sans", sans-serif !important; }',
      });
      await noSideways(page);
      await expect(hero(page).getByText('holdings had a value then').first()).toBeVisible();
      await context.close();
    });
  }
  test('money position: each kind of money on its own card, with its basis, status, date and a link', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const pos = page.getByTestId('hm-position');
    await expect(pos.getByRole('heading', { name: 'Money position' })).toBeVisible();
    for (const key of [
      'networth',
      'people',
      'cash-inr',
      'cash-all',
      'fd',
      'funds',
      'liquid',
      'lent',
      'cover',
      'stale',
    ])
      await expect(pos.getByTestId(`hm-pos-${key}`)).toBeVisible();
    // cash in a foreign currency shows its own amount before the rupee value, with the rate and its date
    const sgd = pos.getByTestId('hm-pos-cash-sgd');
    await expect(sgd.getByTestId('hm-pos-cash-sgd-native')).toHaveText(/^SGD [\d,.]+$/);
    await expect(sgd.getByText(/^₹[\d.]+ per SGD, the .+ of \d{1,2} \w{3} \d{4}$/)).toBeVisible();
    // deposits keep principal and interest apart; every card says how sure it is and how it is worked out
    const fd = pos.getByTestId('hm-pos-fd');
    await expect(fd.getByText('Principal', { exact: true })).toBeVisible();
    await expect(fd.getByText('Interest earned so far (estimated)')).toBeVisible();
    await expect(fd.getByText('Estimated', { exact: true })).toBeVisible();
    await fd.getByText('How it is worked out').click();
    await expect(fd.getByText(/not counted twice/)).toBeVisible();
    // the four kind-of-holding cards below are untouched
    await expect(page.locator('.hm-class')).toHaveCount(4);
  });

  test('money position fits a 390 px screen in light and in dark', async ({ browser }) => {
    for (const colorScheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        colorScheme,
      });
      const page = await context.newPage();
      await page.goto('/demo/dashboard');
      await expect(page.getByTestId('hm-position')).toBeVisible();
      await noSideways(page);
      const widths = await page
        .locator('.hm-pos')
        .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
      expect(new Set(widths).size).toBe(1);
      await context.close();
    }
  });
});
