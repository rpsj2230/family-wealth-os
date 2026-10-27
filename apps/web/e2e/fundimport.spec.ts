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
    await expect(sold).toContainText('is on file, but is not on the statement dated 25 Oct 2026');
    await expect(sold).toContainText('The statement lists all your funds, and this one is not among them.');
    await expect(sold.getByRole('button', { name: /^Approve: mark .* as sold on 25 Oct 2026/ })).toBeVisible();

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

test.describe('Questions the preview asks (public sample)', () => {
  const valueRows = (page: Page) => person(page, 'Beena').locator('li.fc-row', { hasText: 'Sample Value Fund' });

  test('a folio that could be several funds: what I found, what I suggest and why, Approve, and the other choices', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    const first = valueRows(page).nth(0);
    await expect(first.locator('.fc-chip', { hasText: 'Your decision' })).toBeVisible();
    await expect(first).toContainText('What I found');
    await expect(first).toContainText('folio …8540, 700 units, ₹70,000 invested');
    await expect(first).toContainText('What I suggest');
    await expect(first).toContainText('Apply folio …8540 to your fund "Sample Value Fund - Direct Growth".');
    await expect(first).toContainText('only "Sample Value Fund - Direct Growth" has folio …8540 on file');
    await expect(
      first.getByRole('button', {
        name: 'Approve: link folio …8540 to "Sample Value Fund - Direct Growth"',
      }),
    ).toBeVisible();
    // the other choices, each fund told apart by folio and units
    const choices = first.getByRole('group', { name: 'Or choose another answer' });
    await expect(choices.getByRole('radio')).toHaveCount(4);
    await expect(choices).toContainText('no folio on file, 3,047.333 units');
    await expect(choices.getByLabel('A new fund')).toBeVisible();
    await expect(choices.getByLabel('Leave it alone for now')).toBeChecked();
    // the old red "Needs a look" is gone
    await expect(page.getByText('Needs a look')).toHaveCount(0);
  });

  test('Approve takes the suggestion, shows what the fund becomes, and can be changed', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    const second = valueRows(page).nth(1);
    await second
      .getByRole('button', { name: /^Approve: link folio …3820 to "Sample Value Fund/ })
      .click();
    await expect(second.getByRole('status')).toContainText('Approved: link folio …3820');
    await expect(second.getByRole('status')).toContainText('It is applied when you press Apply.');
    await expect(second.getByLabel(/Same as .*no folio on file, 3,047.333 units/)).toBeChecked();
    await expect(second.locator('.fc-after')).toContainText('Nothing else changes; only the link is remembered.');
    // another answer: a new fund, with its changes shown, and Approve is offered again
    await second.getByLabel('A new fund').check();
    await expect(second.locator('.fc-after .fc-chip', { hasText: 'New fund' })).toBeVisible();
    await expect(second.locator('.fc-after')).toContainText('3,047.333');
    await expect(second.getByRole('button', { name: /^Approve: link folio …3820/ })).toBeVisible();
    // leaving it alone shows no change
    await second.getByLabel('Leave it alone for now').check();
    await expect(second.locator('.fc-after')).toHaveCount(0);
  });

  test('with no evidence it says it cannot tell, has no Approve, and a chosen fund shows its changes', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    const hybrid = person(page, 'Beena').locator('li.fc-row', { hasText: 'Sample Hybrid Fund' });
    await expect(hybrid).toContainText('I cannot tell which it is, so I am not guessing: please choose.');
    await expect(hybrid.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
    await hybrid.getByLabel(/folio …2200, 100 units/).check();
    await expect(hybrid.locator('.fc-after .fc-nums')).toContainText('410.5');
    await expect(hybrid.locator('.fc-after .fc-nums')).toContainText('100');
  });

  test('a fund the statement does not list: leave it (e-mail-keyed statement) or mark it sold on a date', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    const dormant = row(page, 'Sample Dormant');
    await expect(dormant.locator('.fc-chip', { hasText: 'Not on this statement' })).toBeVisible();
    await expect(dormant).toContainText('Leave it as it is.');
    await expect(dormant).toContainText('keyed on an e-mail address and may not list every folio');
    await expect(dormant.getByLabel('Leave as it is')).toBeChecked();
    await expect(dormant.getByLabel('Sold on')).toHaveCount(0);
    await dormant.getByLabel('Mark as sold').check();
    const date = dormant.getByLabel('Sold on');
    await expect(date).toHaveValue('2026-10-25');
    await date.fill('2026-10-20');
    await expect(date).toHaveValue('2026-10-20');
    await dormant.getByLabel('Leave as it is').check();
    await expect(dormant.getByLabel('Sold on')).toHaveCount(0);
    // a statement of everything the person holds: suggested sold, with the date
    const old = row(page, 'Sample Old Fund');
    await expect(old.getByLabel('Mark as sold')).toBeChecked();
    await expect(old.getByLabel('Sold on')).toHaveValue('2026-10-25');
  });

  test('a SIP that cannot be judged: keep it as recorded, or mark it stopped from a date', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    const bond = row(page, 'Sample Bond');
    await expect(bond.locator('.fc-chip', { hasText: 'SIP: your decision' })).toBeVisible();
    await expect(bond).toContainText('Keep the SIP as recorded (₹3,000 a month).');
    await expect(bond.getByRole('button', { name: 'Approve: keep the SIP as recorded' })).toBeVisible();
    await bond.getByLabel('Mark the SIP as stopped').check();
    await expect(bond.getByLabel('Stopped from')).toHaveValue('2026-10-24');
    await bond.getByRole('button', { name: 'Approve: keep the SIP as recorded' }).click();
    await expect(bond.getByRole('status')).toContainText('Approved: keep the SIP as recorded');
    await expect(bond.getByLabel('Stopped from')).toHaveCount(0);
  });
});

test.describe('The preview fits the screen', () => {
  for (const width of [390, 412, 810]) {
    test(`no sideways scroll at ${width}px, also in a wide font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/demo/import?tab=cas');
      await expect(person(page, 'Anil')).toBeVisible();
      for (const d of await page.locator('details.fc-lines').all())
        await d.locator('summary').click();
      await noSideways(page);
      await noSidewaysWide(page);
    });

    test(`no sideways scroll at ${width}px with answers open (approved, a date, a new fund)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/demo/import?tab=cas');
      const beena = person(page, 'Beena');
      await beena
        .locator('li.fc-row', { hasText: 'Sample Value Fund' })
        .nth(0)
        .getByRole('button', { name: /^Approve/ })
        .click();
      await beena
        .locator('li.fc-row', { hasText: 'Sample Value Fund' })
        .nth(1)
        .getByLabel('A new fund')
        .check();
      await beena
        .locator('li.fc-row', { hasText: 'Sample Hybrid Fund' })
        .getByLabel(/folio …2200/)
        .check();
      const dormant = row(page, 'Sample Dormant');
      await dormant.getByLabel('Mark as sold').check();
      await row(page, 'Sample Bond').getByLabel('Mark the SIP as stopped').check();
      await expect(dormant.getByLabel('Sold on')).toBeVisible();
      await noSideways(page);
      await noSidewaysWide(page);
    });
  }
});
