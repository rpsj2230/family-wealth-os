import { expect, test, type Page } from '@playwright/test';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const WIDE_FONT = '* { font-family: "DejaVu Sans", sans-serif !important; }';

const btn = (page: Page, id: string) => page.locator(`[data-why="${id}"]`).first();
const panel = (page: Page) => page.getByTestId('why-panel');

/** The card stays inside the window on every side and never makes the page scroll sideways. */
async function inside(page: Page) {
  const box = await panel(page).boundingBox();
  const vp = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height + 0.5);
  expect(await overflow(page)).toBeLessThanOrEqual(0);
}

test.describe('the "?" explainer (public sample)', () => {
  test('opens with the mouse, states both denominators, the basis and the dates, and closes again', async ({
    page,
  }) => {
    await page.goto('/demo/investments');
    const b = btn(page, 'invest.profit');
    await b.scrollIntoViewIfNeeded();
    await expect(b).toHaveAttribute('aria-expanded', 'false');
    await b.click();
    await expect(b).toHaveAttribute('aria-expanded', 'true');
    const p = panel(page);
    await expect(p).toBeVisible();
    await expect(p).toHaveAttribute('role', 'dialog');
    await expect(p.getByRole('heading', { level: 2 })).toContainText('Profit or loss');
    // both percentages name what they are a share of
    await expect(p).toContainText('money put in =');
    await expect(p).toContainText('today’s value =');
    await expect(p).toContainText('Exact:');
    // the data states are words as well as colours
    await expect(p.locator('.why-chip').first()).toContainText(
      /statement|recorded|calculated|estimated|missing/,
    );
    await expect(p.getByText('How complete is it?')).toBeVisible();
    await expect(p.locator('.why-level')).toContainText(
      /Complete|Partly estimated|Estimated|Missing data/,
    );
    // dates are written the way the app writes them
    await expect(p).toContainText(/\d{1,2} [A-Z][a-z]{2} 20\d\d/);
    await inside(page);
    await p.getByRole('button', { name: 'Close' }).click();
    await expect(p).toHaveCount(0);
    await expect(b).toHaveAttribute('aria-expanded', 'false');
    await expect(b).toBeFocused();
  });

  test('works from the keyboard: Enter and Space open, Escape closes and focus returns', async ({
    page,
  }) => {
    await page.goto('/demo/investments');
    const b = btn(page, 'invest.value');
    await b.scrollIntoViewIfNeeded();
    await b.focus();
    await page.keyboard.press('Enter');
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(b).toBeFocused();
    await page.keyboard.press('Space');
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toContainText('latest price');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await expect(b).toBeFocused();
  });

  test('a press outside closes it, and pressing the button again toggles', async ({ page }) => {
    await page.goto('/demo/investments');
    const b = btn(page, 'invest.moneyIn');
    await b.scrollIntoViewIfNeeded();
    await b.click();
    await expect(panel(page)).toBeVisible();
    // on a phone the sheet covers the button, so only a wider window can press it again
    if ((page.viewportSize()?.width ?? 0) > 700) {
      await b.click();
      await expect(panel(page)).toHaveCount(0);
      await b.click();
      await expect(panel(page)).toBeVisible();
    }
    const vp = page.viewportSize()!;
    // a press on empty page space, well away from the card
    await page.mouse.click(vp.width > 700 ? vp.width - 6 : 4, 4);
    await expect(panel(page)).toHaveCount(0);
  });

  test('the ring says what it is a share of, and the headline percentage says what it is on', async ({
    page,
  }) => {
    await page.goto('/demo/investments');
    const hero = page.getByRole('region', { name: 'Mutual funds at a glance' });
    await expect(hero).toContainText(/\d+% of today’s value is growth/);
    await expect(hero).toContainText(/on the ₹[\d.]+ (L|Cr) put in/);
    // the rounded amounts carry the exact rupees
    await expect(hero.locator('dd.v[title^="₹"]').first()).toHaveAttribute('title', /₹[\d,]+/);
    await btn(page, 'invest.ring').scrollIntoViewIfNeeded();
    await btn(page, 'invest.ring').click();
    await expect(panel(page)).toContainText('today’s value is growth');
    await expect(panel(page)).toContainText('money put in');
    await inside(page);
  });

  test('the statements explainer says which funds and why, with links to the data check and Import', async ({
    page,
  }) => {
    await page.goto('/demo/investments');
    const b = btn(page, 'invest.statements');
    await b.scrollIntoViewIfNeeded();
    await b.click();
    const p = panel(page);
    await expect(p).toContainText(/\d+ of \d+ funds have statement lines/);
    await expect(p).toContainText('not reconciled');
    await expect(p.getByRole('link', { name: /data check/i })).toBeVisible();
    await expect(p.getByRole('link', { name: 'Import a fund statement' })).toHaveAttribute(
      'href',
      '/demo/import',
    );
    await inside(page);
  });

  test('every tab of Investments carries "?" buttons that open', async ({ page }) => {
    for (const [tab, id] of [
      ['overview', 'invest.dataCheck'],
      ['performance', 'invest.returns'],
      ['performance', 'invest.pl'],
      ['funds', 'invest.fundsTable'],
      ['breakdown', 'invest.keyFigures'],
    ] as const) {
      await page.goto(`/demo/investments?tab=${tab}`);
      const b = btn(page, id);
      await b.scrollIntoViewIfNeeded();
      await b.click();
      await expect(panel(page)).toBeVisible();
      await inside(page);
      await page.keyboard.press('Escape');
      await expect(panel(page)).toHaveCount(0);
    }
  });

  test('Home, Accounts, Deposits and Cash explain their figures with dates and denominators', async ({
    page,
  }) => {
    for (const [path, id, text] of [
      ['/demo/dashboard', 'home.netWorth', /calculated/],
      ['/demo/dashboard', 'home.profit', /÷ ₹[\d,]+ invested/],
      ['/demo/dashboard', 'home.periods', /money at work/],
      ['/demo/dashboard', 'home.classFunds', /÷ ₹[\d,]+ net worth/],
      ['/demo/accounts', 'accounts.profit', /÷/],
      ['/demo/deposits', 'deposits.journey', /÷/],
      ['/demo/cash', 'cash.interestYear', /tax at source/],
      ['/demo/reports', 'reports.fdRate', /weighted|Σ/],
      ['/demo/reports?tab=funds', 'reports.fundXirr', /average/],
      ['/demo/tax-harvest', 'tax.allowance', /still free/],
      ['/demo/monthly', 'monthly.status', /up to date/],
      ['/demo/new-money?amount=1500000', 'newmoney.options', /a year/],
      ['/demo/rates', 'rates.freshness', /rates? on file/],
    ] as const) {
      await page.goto(path);
      const b = btn(page, id);
      await b.scrollIntoViewIfNeeded();
      await b.click();
      await expect(panel(page)).toBeVisible();
      await expect(panel(page)).toContainText(text);
      await expect(panel(page).locator('.why-chip').first()).toBeVisible();
      await expect(panel(page)).toContainText(/\d{1,2} [A-Z][a-z]{2} 20\d\d/);
      await inside(page);
      await page.keyboard.press('Escape');
      await expect(panel(page)).toHaveCount(0);
    }
  });

  test('a fund page explains its tiles', async ({ page }) => {
    await page.goto('/demo/asset?kind=fund&id=f1');
    for (const id of ['fund.value', 'fund.moneyIn', 'fund.profit', 'fund.xirr']) {
      const b = btn(page, id);
      await b.scrollIntoViewIfNeeded();
      await b.click();
      await expect(panel(page)).toBeVisible();
      await expect(panel(page)).toContainText('How it is worked out');
      await inside(page);
      await page.keyboard.press('Escape');
    }
  });

  test.describe('dark theme', () => {
    test.use({ colorScheme: 'dark' });
    test('is legible', async ({ page }) => {
      await page.goto('/demo/investments');
      const b = btn(page, 'invest.profit');
      await b.scrollIntoViewIfNeeded();
      await b.click();
      const colours = await panel(page).evaluate((el) => {
        const parse = (c: string) =>
          c
            .match(/[\d.]+/g)!
            .slice(0, 3)
            .map(Number);
        const lum = ([r, g, bl]: number[]) => {
          const f = (v: number) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(bl!);
        };
        const cs = getComputedStyle(el);
        const bg = lum(parse(cs.backgroundColor));
        const fg = lum(parse(cs.color));
        const level = el.querySelector('.why-level');
        const lv = level ? getComputedStyle(level) : null;
        const lbg = lv ? lum(parse(lv.backgroundColor)) : bg;
        const lfg = lv ? lum(parse(lv.color)) : fg;
        const ratio = (a: number, c: number) => (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
        return { body: ratio(bg, fg), level: ratio(lbg, lfg), bg };
      });
      expect(colours.bg).toBeLessThan(0.2); // a dark card, not a white one
      expect(colours.body).toBeGreaterThan(7);
      expect(colours.level).toBeGreaterThan(4.5);
    });
  });

  for (const width of [412, 810]) {
    test(`stays inside the window with a wide font at ${width}px`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await ctx.newPage();
      for (const path of [
        '/demo/investments',
        '/demo/investments?tab=performance',
        '/demo/investments?tab=breakdown',
        '/demo/asset?kind=fund&id=f1',
        '/demo/dashboard',
        '/demo/accounts',
        '/demo/deposits',
        '/demo/cash',
        '/demo/reports',
        '/demo/tax-harvest',
        '/demo/monthly',
        '/demo/new-money?amount=1500000',
        '/demo/rates',
      ]) {
        await page.goto(path);
        await page.addStyleTag({ content: WIDE_FONT });
        expect(await overflow(page), `${path} before opening`).toBeLessThanOrEqual(0);
        const first = page.locator('[data-why]').first();
        await first.scrollIntoViewIfNeeded();
        await first.click();
        await expect(panel(page)).toBeVisible();
        await inside(page);
        await page.keyboard.press('Escape');
      }
      await ctx.close();
    });
  }

  test('the button is a 44 px target on a phone', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone', 'phones only');
    await page.goto('/demo/investments');
    const box = await btn(page, 'invest.profit').boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});
