import { expect, test, type Page } from '@playwright/test';

const noSideScroll = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe('Rates board (public sample)', () => {
  test('lists each bank with its best rates, the savings steps, where the rates came from and when', async ({
    page,
  }) => {
    await page.goto('/demo/rates');
    await expect(page.getByRole('heading', { name: 'Rates (sample)', level: 1 })).toBeVisible();
    const cards = page.locator('article.rt-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(4);
    const jan = page.locator('article.rt-card', { hasText: 'Sample Jan Bank' });
    await expect(jan.getByText('Savings, best')).toBeVisible();
    await expect(jan.getByText('NRE deposit, best')).toBeVisible();
    await expect(jan.getByRole('img', { name: /Savings rate by balance/ })).toBeVisible();
    await expect(jan.getByText('Where from')).toBeVisible();
    await expect(jan.getByText('Read from rates.sample-jan.invalid')).toBeVisible();
    await expect(jan.getByText('Edited by you')).toBeVisible();
    await expect(jan.getByText(/Last move: NRE deposit, 3 yr, down 0.50 pts/)).toBeVisible();
    await noSideScroll(page);
  });

  test('says when the weekly refresh could not read a bank page, why, and what to do', async ({
    page,
  }) => {
    await page.goto('/demo/rates?view=all');
    const yes = page.locator('article.rt-card', { hasText: 'Sample Yes Bank' });
    await expect(yes.getByText(/refused the automatic read/)).toBeVisible();
    await expect(yes.getByText(/copy the rates and paste them/)).toBeVisible();
  });

  test('sorting and filtering are links, so the choice is in the address', async ({ page }) => {
    await page.goto('/demo/rates');
    const held = await page.locator('article.rt-card').count();
    await page.getByRole('link', { name: 'Highest savings' }).click();
    await expect(page).toHaveURL(/sort=saving/);
    // the highest savings rate among the banks used is Jan's 7%
    await expect(page.locator('article.rt-card h2').first()).toContainText('Sample Jan Bank');
    await page.getByRole('link', { name: 'Bank name' }).click();
    await expect(page).toHaveURL(/sort=name/);
    const names = await page.locator('article.rt-card h2').allTextContents();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    await page.getByRole('link', { name: 'All banks on file' }).click();
    await expect(page).toHaveURL(/view=all/);
    expect(await page.locator('article.rt-card').count()).toBeGreaterThan(held);
    await page.getByRole('link', { name: 'Oldest check first' }).click();
    // Esaf's rates were last checked in August: the oldest
    await expect(page.locator('article.rt-card h2').first()).toContainText('Sample Esaf Bank');
    await noSideScroll(page);
  });

  test('each card opens its own bank page', async ({ page }) => {
    await page.goto('/demo/rates');
    await page.getByRole('link', { name: 'Sample Jan Bank' }).first().click();
    await expect(page).toHaveURL(/\/demo\/rates\/sample-jan-bank/);
    await expect(page.getByRole('heading', { name: 'Sample Jan Bank', level: 1 })).toBeVisible();
  });
});

test.describe('One bank’s rates (public sample)', () => {
  test('rows can be edited; a figure the bank page gave asks why you are changing it', async ({
    page,
  }) => {
    await page.goto('/demo/rates/sample-jan-bank');
    await expect(page.getByRole('heading', { name: 'Savings, by balance' })).toBeVisible();
    const fromPage = page.locator('ul.rt-rows > li', { hasText: 'NRE deposit, 2 yr' }).first();
    const save = fromPage.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await fromPage.getByLabel(/Rate in percent/).fill('7.5');
    await expect(save).toBeEnabled();
    await expect(fromPage.getByText(/Why is the page.s figure wrong/)).toBeVisible();
    await expect(
      fromPage.getByRole('option', { name: 'It was the senior-citizen rate' }),
    ).toBeAttached();
    // a figure you typed yourself does not ask
    const mine = page.locator('ul.rt-rows > li', { hasText: 'NRE deposit, 3 yr' }).first();
    await mine.getByLabel(/Rate in percent/).fill('7.7');
    await expect(mine.getByText(/Why is the page.s figure wrong/)).toHaveCount(0);
    await noSideScroll(page);
  });

  test('shows what the page says when it differs, and the correction made earlier', async ({
    page,
  }) => {
    await page.goto('/demo/rates/sample-jan-bank');
    await expect(
      page.getByRole('heading', { name: 'The bank page says something different' }),
    ).toBeVisible();
    await expect(page.getByText(/You corrected this from 8.1%/)).toBeVisible();
  });

  test('tabs: history chart with the full change log, and how the refresh reads the page', async ({
    page,
  }) => {
    await page.goto('/demo/rates/sample-jan-bank');
    await page.getByRole('link', { name: /History and log/ }).click();
    await expect(page).toHaveURL(/tab=history/);
    await expect(page.getByRole('heading', { name: 'Best rates over time' })).toBeVisible();
    await expect(page.getByRole('img', { name: /Best rates over time/ })).toBeVisible();
    const log = page.getByRole('table');
    await expect(log).toContainText('Corrected by you');
    await expect(log).toContainText('It was the senior-citizen rate');
    await expect(log).toContainText('Weekly refresh');
    await noSideScroll(page);

    await page.getByRole('link', { name: /How it is read/ }).click();
    await expect(page).toHaveURL(/tab=reading/);
    await expect(page.getByText('Read, but some rates need a look.')).toBeVisible();
    await expect(page.getByRole('heading', { name: /What the refresh has learned/ })).toBeVisible();
    await expect(page.getByText(/read the regular \(non-senior\) column/)).toBeVisible();
    await expect(page.getByText('Ignore the table headed Special Deposits.')).toBeVisible();
    await noSideScroll(page);
  });

  test('an unknown bank is a not-found page', async ({ request }) => {
    expect((await request.get('/demo/rates/no-such-bank')).status()).toBe(404);
  });
});

test.describe('New money (public sample)', () => {
  test('gives five reasoned options and one recommendation, with no dropdowns to fill in', async ({
    page,
  }) => {
    await page.goto('/demo/new-money?amount=2500000');
    await expect(page.getByRole('heading', { name: 'New money', level: 1 })).toBeVisible();
    await expect(page.locator('form.nmo-form select')).toHaveCount(0);
    await expect(page.getByText(/Recommended for/)).toBeVisible();
    await expect(page.locator('.nmo-pick li').first()).toBeVisible();
    await expect(page.locator('details.nmo-card')).toHaveCount(5);
    for (const t of ['Highest return', 'Balanced', 'Ladder', 'Safest spread', 'Stay flexible'])
      await expect(page.locator('details.nmo-card', { hasText: t }).first()).toBeVisible();
    // exactly one is marked recommended and it is open, with its lines and its checks
    await expect(page.locator('details.nmo-card.rec')).toHaveCount(1);
    const rec = page.locator('details.nmo-card.rec');
    await expect(rec).toHaveAttribute('open', '');
    await expect(rec.locator('.nmo-line').first()).toContainText('Sample');
    await expect(rec.getByText('Inside the deposit-insurance limit at every bank')).toBeVisible();
    await expect(rec.getByText('More than plain savings')).toBeVisible();
    await noSideScroll(page);
  });

  test('another option opens to show its own lines and reasons', async ({ page }) => {
    await page.goto('/demo/new-money?amount=2500000');
    const ladder = page.locator('details.nmo-card', { hasText: 'Ladder' }).first();
    await ladder.locator('summary').click();
    await expect(ladder.locator('.nmo-line').first()).toBeVisible();
    await expect(ladder.locator('.nmo-why li').first()).toBeVisible();
    await noSideScroll(page);
  });

  test('NRO and the other person are links under the amount', async ({ page }) => {
    await page.goto('/demo/new-money?amount=2500000');
    await page.getByRole('link', { name: 'NRO', exact: true }).click();
    await expect(page).toHaveURL(/kind=NRO/);
    await expect(page.getByText('after tax').first()).toBeVisible();
    await noSideScroll(page);
  });

  test('reads an amount typed in words and keeps it when you change tab', async ({ page }) => {
    await page.goto('/demo/new-money');
    await page.getByLabel(/Amount/).fill('25 lakh');
    await page.getByRole('button', { name: 'Show the best ways' }).click();
    await expect(page.getByText(/Recommended for/)).toBeVisible();
    await page.getByRole('link', { name: /Earning more elsewhere/ }).click();
    await expect(page).toHaveURL(/tab=better/);
    await expect(page).toHaveURL(/amount=25(\+|%20)lakh/);
    await expect(
      page.getByRole('heading', { name: 'Your money against the market' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Insurance room' }).click();
    await expect(page.getByRole('heading', { name: 'Who holds what today' })).toBeVisible();
    await noSideScroll(page);
  });
});

test.describe('Goals (public sample)', () => {
  test('a progress card per goal with funded share, monthly top-up and the funds set aside', async ({
    page,
  }) => {
    await page.goto('/demo/goals');
    await expect(page.getByRole('heading', { name: 'Goals (sample)', level: 1 })).toBeVisible();
    const edu = page.locator('article.gl-card', { hasText: 'Sample overseas education' });
    await expect(edu.getByRole('img', { name: /set aside today/ })).toBeVisible();
    await expect(edu.getByText('Extra needed each month')).toBeVisible();
    await expect(edu.getByText('Sample Flexi Cap Fund')).toBeVisible();
    await expect(page.locator('article.gl-card', { hasText: 'Sample wedding' })).toContainText(
      'On track',
    );
    await expect(page.locator('article.gl-card', { hasText: 'Sample new flat' })).toContainText(
      'Set a target and a date',
    );
    await noSideScroll(page);
  });

  test('the second tab lists money no goal has claimed yet', async ({ page }) => {
    await page.goto('/demo/goals');
    await page.getByRole('link', { name: /Money not set aside/ }).click();
    await expect(page).toHaveURL(/tab=free/);
    await expect(
      page.getByRole('heading', { name: 'Money not set aside for any goal' }),
    ).toBeVisible();
    await expect(page.getByText('Sample Equity Bank savings')).toBeVisible();
    await noSideScroll(page);
  });
});

test.describe('Tasks (public sample)', () => {
  test('open tasks are grouped by when they are due and say what they concern', async ({
    page,
  }) => {
    await page.goto('/demo/tasks');
    await expect(page.getByRole('heading', { name: 'Tasks (sample)', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Overdue/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Due in the next 7 days/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Later/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^No date/ })).toBeVisible();
    await expect(page.getByText('6 days overdue')).toBeVisible();
    await expect(page.getByText('I need money', { exact: true })).toBeVisible();
    await expect(page.getByText('Tax harvest', { exact: true })).toBeVisible();
    await noSideScroll(page);
  });

  test('finished and dropped tasks are on their own tab', async ({ page }) => {
    await page.goto('/demo/tasks');
    await page.getByRole('link', { name: /Done or dropped/ }).click();
    await expect(page).toHaveURL(/tab=done/);
    await expect(page.getByText('Update KYC at Sample AU Bank')).toBeVisible();
    await expect(page.getByText('Dropped', { exact: true })).toBeVisible();
    await noSideScroll(page);
  });
});

test.describe('Can I retire now? tabs (public sample)', () => {
  test('the verdict stays on top and the tabs hold the inputs and the comparisons', async ({
    page,
  }) => {
    await page.goto('/demo/retire');
    await expect(page.getByRole('heading', { name: 'About you' })).toBeVisible();
    await expect(page.getByText('Retire at age')).toBeVisible();
    // ages read as years, not as percentages
    await expect(page.getByText(/Projected corpus at 55 /)).toBeVisible();
    await page.getByRole('link', { name: 'Compare' }).click();
    await expect(page).toHaveURL(/tab=compare/);
    await expect(page.getByRole('heading', { name: 'Compare retirement ages' })).toBeVisible();
    await expect(page.locator('.statusline')).toBeVisible();
    await noSideScroll(page);
  });
});
