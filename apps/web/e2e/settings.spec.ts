import { expect, test, type Page } from '@playwright/test';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const SECTIONS = [
  ['setup', 'Setup'],
  ['people', 'People'],
  ['rules', 'Money rules'],
  ['tax', 'Tax rules'],
  ['notifications', 'Notifications'],
  ['connections', 'Connections'],
  ['access', 'Emergency and access'],
] as const;

test.describe('Settings (public sample)', () => {
  test('every section opens at its own address, has its heading and fits the screen', async ({
    page,
  }) => {
    for (const [key, label] of SECTIONS) {
      await page.goto(`/demo/settings?tab=${key}`);
      await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: label, level: 2, exact: true })).toBeVisible();
      await expect(
        page
          .getByRole('navigation', { name: 'Settings sections' })
          .getByRole('link', { name: label }),
      ).toHaveAttribute('aria-current', 'page');
      expect(await overflow(page), `${key} overflows`).toBeLessThanOrEqual(0);
    }
  });

  test('an address with no section opens the Setup view', async ({ page }) => {
    await page.goto('/demo/settings');
    await expect(page.getByRole('heading', { name: 'Setup', level: 2, exact: true })).toBeVisible();
    await page.goto('/demo/settings?tab=nonsense');
    await expect(page.getByRole('heading', { name: 'Setup', level: 2, exact: true })).toBeVisible();
  });

  test('clicking a section switches the view and the back button returns', async ({ page }) => {
    await page.goto('/demo/settings?tab=setup');
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await nav.getByRole('link', { name: 'Notifications' }).click();
    await expect(page).toHaveURL(/tab=notifications/);
    await expect(page.getByRole('heading', { name: 'Daily summary e-mail' })).toBeVisible();
    await nav.getByRole('link', { name: 'Connections' }).click();
    await expect(page.getByRole('heading', { name: 'Bank rate pages' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { name: 'Daily summary e-mail' })).toBeVisible();
  });

  test('the setup checklist says what is done and links each open item to where it is done', async ({
    page,
  }) => {
    await page.goto('/demo/settings?tab=setup');
    const list = page.getByRole('region', { name: 'What is set up' });
    await expect(list).toContainText('5 of 12 done');
    await expect(list.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '5');
    await expect(list.getByText('PAN missing: Vikram.')).toBeVisible();
    for (const [name, href] of [
      ['People: date of birth and PAN last four', /tab=people/],
      ['Telegram daily summary on', /tab=notifications#telegram/],
      ['Emergency contacts and who can open the handbook', /tab=access/],
      ['First fund statement imported', /\/import$/],
      ['26AS and AIS imported', /\/tax\/filing$/],
    ] as const) {
      await expect(list.getByRole('link', { name, exact: true }).first()).toHaveAttribute(
        'href',
        href,
      );
    }
    // a section with open items carries a badge in the list
    const nav = page.getByRole('navigation', { name: 'Settings sections' });
    await expect(nav.getByRole('link', { name: /People/ })).toContainText('to do');
  });

  test('older links such as #email, #tax, #telegram and #liquidity find their section', async ({
    page,
  }) => {
    for (const [hash, tab, heading] of [
      ['email', 'connections', 'Bank e-mails and AI'],
      ['rates', 'connections', 'Bank rate pages'],
      ['tax', 'tax', 'Financial year 2026-27'],
      ['telegram', 'notifications', 'Daily summary on Telegram (automatic)'],
      ['limits', 'rules', 'Deposits'],
      ['liquidity', 'rules', 'When I need money'],
      ['emergency', 'access', 'Who can open the handbook, and when'],
      ['people', 'people', 'Income and spending'],
    ] as const) {
      await page.goto(`/demo/settings#${hash}`);
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
      await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
    }
  });

  test('money rules: each card says what it changes and whether it is still the built-in numbers', async ({
    page,
  }) => {
    await page.goto('/demo/settings?tab=rules');
    await expect(page.getByText('11 of 12 cards still run on the built-in numbers.')).toBeVisible();
    // the day clubbing counts from has its own card
    await expect(
      page.locator('#trail').getByLabel(/Count money moved between you for clubbing from/),
    ).toBeVisible();
    const harvest = page.locator('#harvest-rules');
    await expect(harvest.getByText('Confirmed by you')).toBeVisible();
    const deposits = page.locator('#limits');
    await expect(deposits.getByText('Built-in numbers: please confirm')).toBeVisible();
    await expect(
      deposits.getByText(/Sets the insured and uninsured split on Accounts/),
    ).toBeVisible();
    await expect(deposits.getByLabel(/Deposit insurance cover per ownership name/)).toHaveValue(
      '500000',
    );
    await expect(deposits.getByRole('button', { name: 'Save Deposits' })).toBeVisible();
    await expect(
      page.locator('#liquidity').getByLabel(/Deadlines shown as separate plans/),
    ).toHaveValue('0, 3, 14, 45, 120');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('people: PAN is write-only and missing details are flagged', async ({ page }) => {
    await page.goto('/demo/settings?tab=people');
    await expect(page.getByText('PAN saved, ends 4321')).toBeVisible();
    await expect(page.getByText('PAN not saved')).toBeVisible();
    // the PAN box never carries the saved value
    const pans = page.locator('input[name="pan"]');
    for (let i = 0; i < (await pans.count()); i++) await expect(pans.nth(i)).toHaveValue('');
    await expect(page.getByLabel('Amount for Salary')).toHaveValue('6200');
    await expect(page.getByText(/About .* a month at today’s exchange rates/)).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('connections: the AI keys are write-only', async ({ page }) => {
    await page.goto('/demo/settings?tab=connections');
    const key = page.getByLabel(/^API key/);
    await expect(key).toHaveAttribute('type', 'password');
    await expect(key).toHaveValue('');
    await expect(page.getByText('2 AI keys on')).toBeVisible();
    await expect(page.getByText('12 rates read', { exact: false })).toBeVisible();
  });

  test('notifications: channels, Telegram token field and delivery log', async ({ page }) => {
    await page.goto('/demo/settings?tab=notifications');
    const channels = page.getByRole('list', { name: 'Where the summary goes' });
    await expect(channels).toContainText('E-mail');
    await expect(channels).toContainText('Telegram');
    await expect(channels).toContainText('WhatsApp');
    await expect(page.getByLabel(/^Bot token/)).toHaveAttribute('type', 'password');
    await expect(page.getByText('Failed: mail server busy')).toBeVisible();
    await expect(page.getByText('24 Oct 2026')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('emergency and access: choices, contacts and what is still empty', async ({ page }) => {
    await page.goto('/demo/settings?tab=access');
    await expect(page.getByRole('radio', { name: /Only when I release it/ })).toBeVisible();
    await expect(page.getByLabel('Call these people first: name, row 1')).toHaveValue('Ravi Menon');
    await expect(page.getByText(/Still empty:/)).toBeVisible();
    // the contacts form's own button (the inactivity alert card has one too)
    const add = page
      .locator('form', { has: page.getByLabel('Call these people first: name, row 1') })
      .getByRole('button', { name: 'Add a person' });
    await add.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await add.click();
    await expect(page.getByLabel('Call these people first: name, row 2')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('inactivity alert: numbers with a preview, people in order, write-only WhatsApp key, a test to me only', async ({
    page,
  }) => {
    await page.goto('/demo/settings?tab=access');
    const card = page.getByTestId('inactivity-alert');
    await expect(
      page.getByRole('heading', { name: 'If you stop using the portal: the inactivity alert' }),
    ).toBeVisible();
    await expect(card.getByTestId('alert-preview')).toHaveText(
      'With these: you are reminded daily from day 20; Ragini is told after 30 days; Amit after 38 days if Ragini has not confirmed. Each person is reminded 3 times, 2 days apart.',
    );
    await expect(card.getByText(/get an e-mail copy of every message/)).toBeVisible();
    // the saved key is never shown back: only that it is saved, with Replace
    await expect(card.getByText('WhatsApp key saved')).toBeVisible();
    await expect(
      card.getByRole('button', { name: 'Replace the WhatsApp key of person 1' }),
    ).toBeVisible();
    await expect(card.getByText('WhatsApp not activated for Amit', { exact: false })).toBeVisible();
    // order: move Amit up and the preview follows
    await card.getByRole('button', { name: 'Move person 2 up' }).click();
    await expect(card.getByLabel('Person 1: name')).toHaveValue('Amit');
    await expect(card.getByTestId('alert-preview')).toContainText('Amit is told after 30 days');
    // a warning day on or after the alert day is refused in plain words
    await card.getByLabel('Warn me from day').fill('30');
    await expect(card.getByTestId('alert-preview')).toHaveText(
      'Warn me from day: it must be before day 30, when the first person is told.',
    );
    await expect(card.getByRole('button', { name: 'Save the alert' })).toBeDisabled();
    await card.getByLabel('Warn me from day').fill('20');
    await card.getByRole('button', { name: 'Send a test to me' }).click();
    await expect(page.getByTestId('alert-test')).toContainText('[TEST]');
    await expect(page.getByTestId('alert-test')).toContainText('nothing is sent');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('tax rules: this year first, other years folded away', async ({ page }) => {
    await page.goto('/demo/settings?tab=tax');
    await expect(page.getByText('This year')).toBeVisible();
    await expect(page.getByText('Built-in numbers, not confirmed by you')).toBeVisible();
    await page.getByText('Other years (1)').click();
    await expect(page.getByRole('heading', { name: 'Financial year 2025-26' })).toBeVisible();
    await expect(page.getByText('Entered by you and checked')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

// the family handbook's public sample has its own spec: handbook.spec.ts

test.describe('More menu (public sample)', () => {
  test('groups everything that is not in the bottom bar and shows what is left to set up', async ({
    page,
  }) => {
    await page.goto('/demo/more');
    await expect(page.getByRole('heading', { name: 'More', level: 1 })).toBeVisible();
    for (const g of [
      'What we hold',
      'Bring data in',
      'Decide and plan',
      'Tax',
      'Settings and safety',
    ])
      await expect(page.getByRole('heading', { name: g, level: 2 })).toBeVisible();
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: /Family emergency guide/ })).toHaveAttribute(
      'href',
      '/emergency',
    );
    await expect(main.getByRole('link', { name: /Share today’s summary/ })).toHaveAttribute(
      'href',
      '/share',
    );
    // the compact checklist: what is open, with a way to see all
    const setup = page.getByRole('region', { name: 'Setup checklist' });
    await expect(setup).toContainText('of 12 done');
    await expect(
      setup.getByRole('link', { name: /See all|Open the full checklist/ }),
    ).toHaveAttribute('href', '/settings?tab=setup');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});

test('the private pages still need a sign-in', async ({ request }) => {
  for (const path of ['/settings', '/settings?tab=tax', '/share', '/emergency', '/more']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toMatch(/\/login$/);
  }
});
