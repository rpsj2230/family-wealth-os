import { expect, test, type Frame, type Page } from '@playwright/test';

/**
 * Cash held in another currency (the sample household has S$ 41,250 and US$ 6,200 in Sample Jan Bank): the main Cash figure stays the
 * rupee total of all cash; the foreign balance is listed beneath it with its rupee value, the rate and the day of the rate.
 */
const WIDE = '* { font-family: "DejaVu Sans", sans-serif !important; }';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/**
 * Elements that stick out to the right of the window: the page itself may not scroll, but a clipped card would hide this. The bank
 * tables are a wide sheet that scrolls inside its own frame (as before), so what is inside one is judged by where it starts.
 */
const cutOff = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll(sel)]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return e.closest('.xlwrap') ? r.left > vw - 40 : r.right > vw + 1;
      })
      .map((e) => `${e.tagName}.${String(e.className).slice(0, 30)}`);
  }, selector);

test.describe('Foreign cash (public sample)', () => {
  test('Home: the Cash card keeps the rupee total and lists S$ and US$ beneath it', async ({
    page,
  }) => {
    await page.goto('/demo/dashboard');
    const card = page.getByTestId('hm-class-cash');
    await expect(card.getByTestId('hm-class-cash-current')).toHaveText(/^₹\d+\.\d\d (Cr|L)$/);
    const fx = card.getByTestId('hm-class-cash-fx');
    await expect(fx).toBeVisible();
    const sgd = fx.getByTestId('hm-class-cash-fx-SGD');
    await expect(sgd).toContainText('S$ 41,250');
    // the small line: the rupee value, the rate used and the day of that rate
    await expect(sgd).toContainText('≈ ₹23.14 L at 1 SGD = ₹56.1, rate of 26 Oct');
    await expect(fx.getByTestId('hm-class-cash-fx-USD')).toContainText('US$ 6,200');
    // biggest first, and no other card carries one
    await expect(fx.locator('li').first()).toContainText('S$');
    await expect(page.getByTestId('hm-class-fd').getByTestId('hm-class-fd-fx')).toHaveCount(0);
    await expect(page.getByTestId('hm-class-funds').locator('.fxc')).toHaveCount(0);
    // the "?" explains it and how the rate was chosen
    await card.locator('[data-why="home.classCash"]').click();
    await expect(page.getByTestId('why-panel')).toContainText('already inside the figure');
    await expect(page.getByTestId('why-panel')).toContainText('with no rate on file');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('Accounts: the Savings and cash figure lists the foreign part; banks and people say how much of it they hold', async ({
    page,
  }) => {
    await page.goto('/demo/accounts');
    const panel = page.getByRole('region', { name: 'Money in banks' });
    const fx = panel.getByTestId('bv-cash-fx');
    await expect(fx.getByTestId('bv-cash-fx-SGD')).toContainText('S$ 41,250');
    await expect(fx.getByTestId('bv-cash-fx-SGD')).toContainText('rate of 26 Oct');
    // the bank that holds it says how much of its total is S$ and US$; a bank without any says nothing
    const bank = page.locator('section.xlbank', { hasText: 'Sample Jan Bank' });
    await expect(bank.getByTestId('bt-bank-fx').first()).toContainText('incl. S$ 41,250');
    await expect(bank.getByTestId('bt-person-fx').first()).toContainText('of it S$ 41,250');
    await expect(
      page.locator('section.xlbank', { hasText: 'Sample Equity Bank' }).getByTestId('bt-bank-fx'),
    ).toHaveCount(0);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('Accounts: filtering to a person who holds none shows no foreign line', async ({ page }) => {
    await page.goto('/demo/accounts?p=p3');
    await expect(page.getByTestId('bv-cash-fx')).toHaveCount(0);
    await expect(page.getByTestId('bt-bank-fx')).toHaveCount(0);
  });

  test('Cash: the total stays in rupees with the S$ balance beneath, and the register shows the balance and the rate', async ({
    page,
  }) => {
    await page.goto('/demo/cash');
    const p = page.getByRole('region', { name: 'Savings and cash overview' });
    await expect(p.getByTestId('cv-current')).toHaveText(/^₹\d+\.\d\d (Cr|L)$/);
    await expect(p.getByTestId('cv-fx-SGD')).toContainText('S$ 41,250');
    await expect(p.getByTestId('cv-fx-SGD')).toContainText('at 1 SGD = ₹56.1');
    const reg = page.locator('section.cashreg');
    await expect(reg.getByText('S$ 41,250').first()).toBeVisible();
    await expect(reg.getByTestId('cr-fx').first()).toContainText('= ₹');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('the daily summary preview shows the S$ line under the savings tile and in the text', async ({
    page,
  }) => {
    await page.goto('/demo/digest');
    const phone = page.frameLocator('[data-testid=dp-phone]');
    await expect(phone.getByText('S$ 41,250').first()).toBeVisible();
    await expect(page.getByTestId('dp-text')).toContainText('of it S$ 41,250');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('Foreign cash fits every width, with a wide font', () => {
  const paths = ['/demo/dashboard', '/demo/accounts', '/demo/cash'];
  for (const width of [390, 412, 810, 1280]) {
    test(`no sideways scrolling or cut-off lines at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      for (const path of paths) {
        await page.goto(path);
        await page.addStyleTag({ content: WIDE });
        await page.waitForTimeout(150);
        expect(await overflow(page), `${path} at ${width}`).toBeLessThanOrEqual(0);
        expect(await cutOff(page, '.fxc, .fxc li, .fxc-inline'), `${path} at ${width}`).toEqual([]);
      }
      await context.close();
    });
  }

  test('dark mode keeps the small line readable', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 900 },
      colorScheme: 'dark',
    });
    const page = await context.newPage();
    await page.goto('/demo/dashboard');
    const small = page.getByTestId('hm-class-cash-fx-SGD').locator('.fxc-inr');
    await expect(small).toBeVisible();
    const [c, bg] = await small.evaluate((el) => [
      getComputedStyle(el).color,
      getComputedStyle(document.body).backgroundColor,
    ]);
    expect(c).not.toBe(bg);
    await context.close();
  });

  test('the e-mail frames do not widen with a wide font', async ({ page }) => {
    await page.goto('/demo/digest');
    for (const id of ['dp-phone', 'dp-desktop']) {
      const handle = await page.getByTestId(id).elementHandle();
      const f: Frame = (await handle!.contentFrame())!;
      await f.evaluate(() => {
        const st = document.createElement('style');
        st.textContent = '* { font-family: "DejaVu Sans", sans-serif !important; }';
        document.head.append(st);
      });
      const s = await f.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(s.scroll, id).toBeLessThanOrEqual(s.client);
    }
  });
});
