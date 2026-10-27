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

test.describe('The statement is the top priority (public sample)', () => {
  test('says so in plain words at the top, with what it replaces, adds and confirms', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    const note = page.locator('.fc-priority');
    await expect(note).toContainText('The statement is the most accurate record.');
    await expect(note).toContainText(
      'Where it differs from what you have, the statement wins; your older lines are kept in a hidden list, not deleted.',
    );
    await expect(note.locator('.fc-counts')).toContainText('2 lines on file in 1 fund replaced');
    await expect(note.locator('.fc-counts')).toContainText('confirmed');
  });

  test('a fund shows how many lines on file are replaced, added and confirmed, and lists them', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    const flexi = row(page, 'Sample Flexi Cap');
    await expect(flexi.locator('.fc-chip', { hasText: '2 replaced' })).toBeVisible();
    const box = flexi.locator('.fc-replace');
    await expect(box).toContainText(
      'This statement replaces 2 lines on file (from 1 app export, 1 estimated), adds 2, confirms 6.',
    );
    await expect(box).toContainText('kept in a hidden list on the fund page, not deleted');
    await box.locator('summary').click();
    await expect(box.locator('.fc-table')).toContainText('App export');
    await expect(box.locator('.fc-table')).toContainText('Estimated');
    await expect(box.locator('.fc-table')).toContainText('20 Apr 2026');
  });

  test('is ticked by default and can be unticked to keep the person’s own lines', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    const flexi = row(page, 'Sample Flexi Cap');
    const replace = flexi.getByRole('checkbox', { name: /Replace the lines on file for/ });
    const fund = flexi.getByRole('checkbox', { name: /Apply the changes to Sample Flexi Cap/ });
    await expect(replace).toBeChecked();
    await replace.uncheck();
    await expect(flexi.locator('.fc-replace')).toHaveClass(/off/);
    await expect(flexi.locator('.fc-replace')).toContainText('Your own lines stay as they are');
    // the fund stays ticked: its own new lines are still added
    await expect(fund).toBeChecked();
    await replace.check();
    await fund.uncheck();
    await expect(replace).toBeDisabled();
    await expect(replace).not.toBeChecked();
  });

  test('a fund missing from a statement made from an email address is "check", not sold', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    const charu = person(page, 'Charu');
    for (const name of ['Sample Dividend Fund', 'Sample Tax Saver Fund']) {
      const r = row(page, name);
      await expect(r.locator('.fc-chip', { hasText: 'Not on this statement' })).toBeVisible();
      // it says what it suggests, instead of "check"
      await expect(r).toContainText('What I suggest');
      await expect(r).toContainText('Leave it as it is.');
      await expect(r.locator('.fc-chip', { hasText: 'Sold' })).toHaveCount(0);
      await expect(r.getByRole('checkbox')).toHaveCount(0);
      await expect(r).toContainText('registered under another email');
    }
    await expect(charu).toContainText('none was marked as sold');
    // Anil's fund that a complete statement does not list is still a sale
    await expect(
      row(page, 'Sample Old Fund').locator('.fc-chip', { hasText: 'Sold' }),
    ).toBeVisible();
  });

  test('the fund page lists replaced lines in a collapsed group', async ({ page }) => {
    await page.goto('/demo/asset?kind=fund&id=f2&tab=transactions');
    const group = page.locator('details.replaced-lines');
    await expect(group.locator('summary')).toContainText('Replaced by the statement (2 lines)');
    await expect(group.locator('table')).toBeHidden();
    await group.locator('summary').click();
    await expect(group).toContainText('left out of every figure');
    await expect(group.locator('table')).toContainText('statement dated 25 Oct 2026');
    await expect(group.locator('table')).toContainText('App export');
    await noSideways(page);
  });
});

test.describe('It fits the screen', () => {
  for (const width of [412, 810]) {
    test(`preview: no sideways scroll at ${width}px, also in a wide font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/demo/import?tab=cas');
      await expect(person(page, 'Anil')).toBeVisible();
      for (const d of await page.locator('details.fc-lines').all())
        await d.locator('summary').click();
      await noSideways(page);
      await noSidewaysWide(page);
    });
    test(`fund page: no sideways scroll at ${width}px, also in a wide font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/demo/asset?kind=fund&id=f2&tab=transactions');
      await page.locator('details.replaced-lines summary').click();
      await noSideways(page);
      await noSidewaysWide(page);
    });
  }
});
