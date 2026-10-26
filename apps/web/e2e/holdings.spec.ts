import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' });

test('the old Funds and fund-update addresses and every holdings page need a sign-in', async ({
  request,
}) => {
  for (const path of [
    '/accounts',
    '/accounts?tab=manage',
    '/investments',
    '/investments?tab=match',
    '/investments/update',
    '/funds',
    '/others',
    '/others?tab=policies',
    '/deposits?tab=cover',
    '/policy/00000000-0000-0000-0000-000000000001',
  ]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toMatch(/\/login$/);
  }
});

test.describe('Accounts (public sample)', () => {
  test('shows the summary, banks as an accordion, foreign money and fits the screen', async ({
    page,
  }) => {
    await page.goto('/demo/accounts');
    await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible();
    const kpis = page.getByRole('region', { name: 'Accounts at a glance' });
    await expect(kpis).toContainText('In banks today');
    await expect(kpis).toContainText('Fixed deposits today');
    await expect(kpis).toContainText('Updated in');
    await expect(page.locator('details.bankdet').first()).toBeVisible();
    await expect(page.getByText(/Foreign-currency accounts/)).toBeVisible();
    await noSideways(page);
  });

  test('Manage holds the editor, the order and the notes in one place', async ({ page }) => {
    await page.goto('/demo/accounts');
    await tabs(page)
      .getByRole('link', { name: /Manage/ })
      .click();
    await expect(page).toHaveURL(/tab=manage/);
    await expect(page.getByRole('heading', { name: 'Correct tags and details' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Change the order' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tidy bank notes' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the editor' })).toHaveAttribute(
      'href',
      '/demo/accounts/edit',
    );
    await noSideways(page);
    await tabs(page).getByRole('link', { name: 'Banks' }).click();
    await expect(page.locator('details.bankdet').first()).toBeVisible();
  });
});

test.describe('Deposits (public sample)', () => {
  test('three tabs: the register, the maturities and the insurance cover', async ({ page }) => {
    await page.goto('/demo/deposits');
    await expect(page.getByRole('heading', { name: 'Deposits', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Deposits at a glance' })).toContainText(
      'Fixed deposits today',
    );
    await expect(page.getByRole('heading', { name: 'All fixed deposits' })).toBeVisible();
    await noSideways(page);

    await tabs(page)
      .getByRole('link', { name: /Maturities/ })
      .click();
    await expect(page).toHaveURL(/tab=maturities/);
    await expect(page.getByRole('heading', { name: /Confirm what happened/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Maturing in the next 90 days/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Maturity calendar' })).toBeVisible();
    await noSideways(page);

    await tabs(page)
      .getByRole('link', { name: /Insurance cover/ })
      .click();
    await expect(page).toHaveURL(/tab=cover/);
    await expect(page.getByRole('heading', { name: 'By bank' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By ownership name' })).toBeVisible();
    await expect(page.getByText(/not your life or health insurance/)).toBeVisible();
    await noSideways(page);
  });

  test('choosing a person narrows the list and keeps the tab', async ({ page }) => {
    await page.goto('/demo/deposits?tab=maturities');
    await page
      .getByRole('link', { name: /^Beena/ })
      .first()
      .click();
    await expect(page).toHaveURL(/tab=maturities/);
    await expect(page).toHaveURL(/p=p2/);
    await expect(tabs(page).getByRole('link', { name: /Maturities/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(tabs(page).getByRole('link', { name: /Maturities/ })).toHaveAttribute(
      'href',
      /p=p2/,
    );
  });

  test('the register can be searched', async ({ page }) => {
    await page.goto('/demo/deposits');
    const rows = page.locator('table tbody tr:visible');
    const before = await rows.count();
    expect(before).toBeGreaterThan(3);
    await page.getByLabel('Search this list').fill('Esaf');
    await expect.poll(async () => rows.count()).toBeLessThan(before);
  });
});

test.describe('Lent, policies, property (public sample)', () => {
  test('money lent: what is owed, what is late, and a form that says what happened', async ({
    page,
  }) => {
    await page.goto('/demo/others');
    await expect(
      page.getByRole('heading', { name: 'Lent, policies, property', level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: /at a glance/ })).toContainText('Owed to you');
    await expect(page.getByText(/days? overdue/).first()).toBeVisible();
    await expect(page.getByRole('list', { name: 'Loans' }).getByRole('listitem')).toHaveCount(4);
    // a gift is kept for the record and says it is not counted
    await expect(page.getByText('gift · not counted')).toBeVisible();
    await page.getByText('Add a loan or a gift').click();
    await page.getByLabel('Lent to').fill('Someone');
    await page.getByLabel('Amount (₹)').fill('1,00,000');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'nothing is saved' })).toBeVisible();
    await noSideways(page);
  });

  test('policies: the date to look at comes first, quick update and add form are there', async ({
    page,
  }) => {
    await page.goto('/demo/others?tab=policies');
    await expect(page.getByRole('list', { name: 'Policies' }).getByRole('listitem')).toHaveCount(4);
    await expect(page.getByText(/renew it, or enter the new date/)).toBeVisible();
    await expect(page.getByText('Add a policy')).toBeVisible();
    await expect(page.getByText('Update dates, nominee and documents').first()).toBeVisible();
    await noSideways(page);
  });

  test('property and other: values with their date and source, and a way to record a new one', async ({
    page,
  }) => {
    await page.goto('/demo/others?tab=property');
    await expect(page.getByRole('heading', { name: 'Holdings' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sample Flat' })).toBeVisible();
    await expect(page.getByText('no value yet').first()).toBeVisible();
    await expect(page.getByText('Record a new value')).toBeVisible();
    await noSideways(page);
  });

  test('tabs switch between the three views', async ({ page }) => {
    await page.goto('/demo/others');
    await tabs(page)
      .getByRole('link', { name: /Policies/ })
      .click();
    await expect(page).toHaveURL(/tab=policies/);
    await tabs(page)
      .getByRole('link', { name: /Property and other/ })
      .click();
    await expect(page).toHaveURL(/tab=property/);
    await tabs(page)
      .getByRole('link', { name: /Money lent/ })
      .click();
    await expect(page.getByRole('list', { name: 'Loans' })).toBeVisible();
  });
});

test.describe('Investments (public sample)', () => {
  test('funds by person, with the Match funds and Update funds tabs inside', async ({ page }) => {
    await page.goto('/demo/investments');
    await expect(page.getByRole('heading', { name: 'Investments', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: /at a glance/ })).toContainText('Value now');
    await expect(page.getByText('Sample Flexi Cap Fund')).toBeVisible();
    await expect(page.getByText(/PAN/).first()).toBeVisible();
    await expect(tabs(page).getByRole('link')).toHaveCount(4);
    await noSideways(page);
  });

  test('growth shows the chart and what carrying on at this pace gives', async ({ page }) => {
    await page.goto('/demo/investments');
    await tabs(page).getByRole('link', { name: 'Growth' }).click();
    await expect(page).toHaveURL(/tab=growth/);
    await expect(page.getByRole('heading', { name: 'If you carry on like this' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Who holds what' })).toBeVisible();
    await noSideways(page);
  });

  test('update funds: the monthly grid and the transaction form', async ({ page }) => {
    await page.goto('/demo/investments?tab=update');
    await expect(page.getByRole('button', { name: 'Save fund figures' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a transaction' })).toBeVisible();
    await page.getByLabel('Sample Flexi Cap Fund units').fill('1000');
    await page.getByRole('button', { name: 'Save fund figures' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'nothing is saved' })).toBeVisible();
    await noSideways(page);
  });

  test('match funds: what to check first, what is matched, and confirming', async ({ page }) => {
    await page.goto('/demo/investments?tab=match');
    await expect(page.getByRole('heading', { name: /To check/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Matched/ })).toBeVisible();
    await expect(page.getByText('Sample Hybrid Fund - Direct Plan - Growth')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'nothing is saved' })).toBeVisible();
    await noSideways(page);
  });

  test('a person filter keeps the tab and narrows the funds', async ({ page }) => {
    await page.goto('/demo/investments?tab=growth');
    await page
      .getByRole('link', { name: /^Beena/ })
      .first()
      .click();
    await expect(page).toHaveURL(/tab=growth/);
    await expect(page).toHaveURL(/p=p2/);
    await expect(page.getByRole('heading', { name: 'Who holds what' })).toHaveCount(0);
  });
});
