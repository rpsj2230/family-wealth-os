import { expect, test, type Page } from '@playwright/test';

/** The family handbook, on its public sample with invented people (/demo/emergency). */
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('Family handbook (public sample)', () => {
  test.beforeEach(async ({ page }) => {
    // the reading choices and the sample's ticks are remembered per browser: start each test afresh
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('hb-e2e')) {
        localStorage.clear();
        sessionStorage.setItem('hb-e2e', '1');
      }
    });
  });

  test('starts with a calm card: the family’s words, whom to call first and what there is', async ({
    page,
  }) => {
    await page.goto('/demo/emergency');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('family handbook');
    const start = page.getByRole('region', { name: 'Start here' });
    await expect(start).toBeVisible();
    await expect(start).toContainText('We made this so you are never left wondering');
    await expect(page.getByTestId('hb-call-first')).toHaveAttribute('href', 'tel:+6590000000');
    await expect(page.getByTestId('hb-call-first')).toContainText('Call Ravi Menon first');
    await expect(page.getByTestId('hb-have')).toHaveText(
      /^About ₹[\d.]+ (L|Cr) in 3 banks, 4 funds and 2 insurance policies — details below\.$/,
    );
    await expect(page.getByText('not legal or tax advice').first()).toBeVisible();
    // the order of the page
    const order = await page
      .locator('.hb2 h2')
      .evaluateAll((hs) => hs.map((h) => h.textContent?.trim()));
    expect(order.slice(0, 1)).toEqual(['Start here']);
    expect(order).toEqual(
      expect.arrayContaining([
        'Who to call, in this order',
        'The first days, step by step',
        'Where things are',
        'Banks, funds and insurance',
        'Other things we own',
        'Who is who',
        'For the children',
      ]),
    );
    // the read-only view has no "what is missing" meter
    await expect(page.getByText(/Handbook \d+% complete/)).toHaveCount(0);
  });

  test('has a card per bank, fund house and insurer with the nominee, a helpline to dial and the papers to claim', async ({
    page,
  }) => {
    await page.goto('/demo/emergency');
    const harbour = page.getByRole('article', { name: 'Sample Harbour Bank' });
    await expect(harbour).toContainText('Savings account (NRE) …4411');
    await expect(harbour).toContainText('Nominee: Vikram, 100%');
    await expect(harbour).toContainText('Nominee: Not recorded');
    await expect(harbour.getByRole('link', { name: /Helpline/ })).toHaveAttribute(
      'href',
      'tel:18000001111',
    );
    await expect(harbour).toContainText('How to claim: papers to collect');
    await expect(harbour.getByText('0 of 7 done')).toBeVisible();
    const lotus = page.getByRole('article', { name: 'Sample Lotus Bank' });
    await expect(lotus.locator('.hb-help')).toContainText('Not recorded');
    const funds = page.getByRole('article', { name: 'Sample Alpha Mutual Fund' });
    await expect(funds).toContainText('Transmission request form');
    await expect(funds).toContainText('SIP of ₹15,000 a month running');
    const life = page.getByRole('article', { name: 'Sample Shield Life' });
    await expect(life).toContainText('Life (term) cover');
    await expect(life).toContainText('Original policy document found');
    // no full account number anywhere: only the last four digits
    await expect(page.locator('.hb2')).not.toContainText(/\d{9,}/);
  });

  test('ticks work in the sample, in this browser only, and count per group', async ({ page }) => {
    await page.goto('/demo/emergency');
    await expect(
      page.getByText('In this sample, ticks stay in this browser only. Nothing is saved.'),
    ).toBeVisible();
    const week = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'First week' }) });
    await expect(week.getByText('0 of 7 done')).toBeVisible();
    await week.getByLabel(/certified copies of the death certificate/).check();
    await expect(week.getByText('1 of 7 done')).toBeVisible();
    await expect(week.getByText(/Ticked by you on/)).toBeVisible();
    const harbour = page.getByRole('article', { name: 'Sample Harbour Bank' });
    await harbour.getByLabel(/Bank informed/).check();
    await expect(harbour.getByText('1 of 7 done')).toBeVisible();
    // remembered in this browser
    await page.reload();
    await expect(week.getByText('1 of 7 done')).toBeVisible();
    await harbour.getByLabel(/Bank informed/).uncheck();
    await expect(harbour.getByText('0 of 7 done')).toBeVisible();
  });

  test('switches to Hindi and simple words, and remembers the choice', async ({ page }) => {
    await page.goto('/demo/emergency');
    await page.getByRole('button', { name: 'हिन्दी' }).click();
    await expect(page.getByRole('heading', { name: 'पहला हफ़्ता' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'किसे फ़ोन करें, इसी क्रम में' })).toBeVisible();
    await expect(page.getByTestId('hb-call-first')).toContainText(
      'सबसे पहले Ravi Menon को फ़ोन करें',
    );
    // names, banks and the family's own message stay as written
    await expect(page.getByRole('article', { name: 'Sample Harbour Bank' })).toBeVisible();
    await expect(page.getByText('We made this so you are never left wondering')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'पहला हफ़्ता' })).toBeVisible();
    await page.getByRole('button', { name: 'English' }).click();
    const long = page.getByText(/Almost every bank, fund house and insurer asks for one/);
    await expect(long).toBeVisible();
    await page.getByLabel('Simple words').check();
    await expect(long).toHaveCount(0);
    await expect(page.getByText('Get 10 or more copies of the death certificate.')).toBeVisible();
    await page.getByLabel('Larger text').check();
    await expect(page.locator('.hb2')).toHaveClass(/hb-large/);
  });

  test('fits a 390px phone without sideways scroll, in English and Hindi', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/demo/emergency?owner=1');
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: 'हिन्दी' }).click();
    await page.getByLabel('बड़े अक्षर').check();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('the owner sees what is still missing, with where to fill it in', async ({ page }) => {
    await page.goto('/demo/emergency?owner=1');
    await expect(page.getByText(/Handbook \d+% complete/)).toBeVisible();
    await expect(page.getByRole('progressbar')).toBeVisible();
    const lotusGap = page.locator('[data-gap="helpline"]');
    await expect(lotusGap).toContainText('1 bank has no helpline');
    await expect(lotusGap.getByRole('link', { name: 'Fill in' })).toHaveAttribute(
      'href',
      '/accounts',
    );
    await expect(page.locator('[data-gap="nomineeAccounts"]')).toContainText('no nominee recorded');
    await page.goto('/demo/emergency?empty=1&owner=1');
    await expect(page.getByText('No one has been written down yet.')).toBeVisible();
    await expect(page.locator('[data-gap="contacts"]')).toContainText('No one to call first');
    await expect(page.locator('[data-gap="will"]')).toContainText(
      'Where is the will? Not written down yet',
    );
    await expect(
      page.locator('[data-gap="will"]').getByRole('link', { name: 'Fill in' }),
    ).toHaveAttribute('href', '/settings?tab=access');
  });

  test('a softer part for the children, with who looks after them', async ({ page }) => {
    await page.goto('/demo/emergency');
    const kids = page.getByRole('region', { name: 'For the children' });
    await expect(kids).toContainText('It is okay to feel sad');
    await expect(kids.getByRole('heading', { name: 'Who looks after you' })).toBeVisible();
    await expect(kids).toContainText('Asha');
    await expect(kids.getByRole('link', { name: 'Call Ravi Menon' })).toHaveAttribute(
      'href',
      'tel:+6590000000',
    );
  });

  test('prints as a clean document: options hidden, ticks as boxes', async ({ page }) => {
    await page.goto('/demo/emergency?owner=1');
    await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
    await expect(page.getByRole('button', { name: 'हिन्दी' })).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeHidden();
    await expect(page.getByText(/Handbook \d+% complete/)).toBeHidden();
    await expect(page.locator('.hb-pbox').first()).toBeVisible();
    await expect(page.locator('.hb-pbox').first()).toHaveText('☐');
    await expect(page.getByRole('heading', { name: 'Who to call, in this order' })).toBeVisible();
  });
});
