import { expect, test, type Frame, type Page } from '@playwright/test';

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The document inside a sandboxed frame (the frame has no same-origin access, so it is reached through the browser's own frame tree). */
async function frameOf(page: Page, id: 'dp-phone' | 'dp-desktop'): Promise<Frame> {
  const handle = await page.getByTestId(id).elementHandle();
  const frame = await handle!.contentFrame();
  expect(frame, `${id} has a document`).not.toBeNull();
  return frame!;
}

/** A wide default font (the one a CI machine falls back to). A sandboxed frame is changed through the browser, not through a script of its own. */
const wideFont = (f: Frame) =>
  f.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '* { font-family: "DejaVu Sans", sans-serif !important; }';
    document.head.append(st);
  });

const sideways = (f: Frame) =>
  f.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));

test.describe('Preview of the daily e-mail (public sample)', () => {
  test('shows the subject, the preview line and the message at phone and laptop width', async ({
    page,
  }) => {
    await page.goto('/demo/digest');
    await expect(
      page.getByRole('heading', { name: 'Preview today’s e-mail', level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId('dp-subject')).toContainText(
      /^Family Wealth Summary · 26 Oct 2026 · Net worth ₹/,
    );
    await expect(page.getByTestId('dp-preheader')).toContainText('Net worth ₹');
    for (const id of ['dp-phone', 'dp-desktop'] as const) {
      const frame = page.getByTestId(id);
      await expect(frame).toBeVisible();
      // an empty sandbox: nothing in the message can run, submit or navigate
      expect(await frame.getAttribute('sandbox')).toBe('');
    }
    const phone = page.frameLocator('[data-testid=dp-phone]');
    await expect(phone.getByText('Family wealth', { exact: true })).toBeVisible();
    await expect(phone.getByText('Net worth', { exact: true }).first()).toBeVisible();
    await expect(phone.getByText('IN FDS', { exact: false }).first()).toBeVisible();
    await expect(phone.getByText('are we on track at this pace?')).toBeVisible();
    await expect(phone.getByText('Retirement at 55')).toBeVisible();
    await expect(phone.getByText('Not enough data: set a target amount and date.')).toBeVisible();
    await expect(phone.getByRole('link', { name: 'Open the portal' })).toBeVisible();
    await expect(page.getByTestId('dp-text')).toContainText('GOALS');
  });

  test('the page never scrolls sideways', async ({ page }) => {
    await page.goto('/demo/digest');
    await expect(page.getByTestId('dp-phone')).toBeVisible();
    expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
  });

  test('the message fits its frame in both widths, with the normal and with a wide font', async ({
    page,
  }) => {
    await page.goto('/demo/digest');
    for (const id of ['dp-phone', 'dp-desktop'] as const) {
      const f = await frameOf(page, id);
      const s = await sideways(f);
      expect(s.scroll, `${id} content wider than its frame`).toBeLessThanOrEqual(s.client);
      await wideFont(f);
      const w = await sideways(f);
      expect(w.scroll, `${id} with a wide font`).toBeLessThanOrEqual(w.client);
    }
  });

  test('is readable in a dark scheme: a dark page, light text, nothing white', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/demo/digest');
    const f = await frameOf(page, 'dp-phone');
    const bg = await f.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const [r, g, b] = (bg.match(/\d+/g) ?? []).map(Number);
    expect(Math.max(r!, g!, b!)).toBeLessThan(60);
    const ink = await f.evaluate(
      () => getComputedStyle(document.querySelector('.ink') as Element).color,
    );
    const [ir, ig, ib] = (ink.match(/\d+/g) ?? []).map(Number);
    expect(Math.min(ir!, ig!, ib!)).toBeGreaterThan(180);
    const s = await sideways(f);
    expect(s.scroll).toBeLessThanOrEqual(s.client);
  });

  test('the message has no script, no image and no remote file', async ({ page }) => {
    await page.goto('/demo/digest');
    const f = await frameOf(page, 'dp-desktop');
    const found = await f.evaluate(() => ({
      scripts: document.querySelectorAll('script').length,
      images: document.querySelectorAll('img, iframe, link, object, embed').length,
      handlers: [...document.querySelectorAll('*')].filter((e) =>
        e.getAttributeNames().some((n) => n.startsWith('on')),
      ).length,
    }));
    expect(found).toEqual({ scripts: 0, images: 0, handlers: 0 });
  });

  for (const width of [412, 810]) {
    test(`no sideways overflow with a wide font at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/demo/digest');
      await page.addStyleTag({
        content: '* { font-family: "DejaVu Sans", sans-serif !important; }',
      });
      for (const id of ['dp-phone', 'dp-desktop'] as const) {
        const f = await frameOf(page, id);
        await wideFont(f);
        const s = await sideways(f);
        expect(s.scroll, `${id} at ${width}`).toBeLessThanOrEqual(s.client);
      }
      expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test('the live preview needs a sign-in', async ({ request }) => {
    const res = await request.get('/settings/notifications/preview', { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toMatch(/\/login$/);
  });

  test('Settings > Notifications links to the preview and has the goals switch', async ({
    page,
  }) => {
    await page.goto('/demo/settings?tab=notifications');
    await expect(page.getByLabel('Include the goals view')).toBeChecked();
    await expect(page.getByLabel('Include the retirement view')).toBeChecked();
    await page.getByRole('link', { name: 'Preview today’s e-mail' }).click();
    await expect(page).toHaveURL(/\/demo\/digest$/);
    await expect(page.getByTestId('dp-phone')).toBeVisible();
  });
});
