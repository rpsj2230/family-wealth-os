import { expect, test } from '@playwright/test';

const noSideways = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test('sample deposit: facts, value chart, interest by year and the activity log', async ({
  page,
}) => {
  await page.goto('/demo/asset');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const facts = page.getByRole('region', { name: 'Key facts' });
  await expect(facts).toContainText('7.25%');
  await expect(facts).toContainText('At maturity');
  await expect(facts.getByRole('link', { name: /Cash-NRE-1100/ })).toHaveAttribute(
    'href',
    '/asset/s1',
  );
  await expect(page.getByRole('img', { name: /Value from/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Interest by financial year' })).toContainText(
    'Exempt (NRE)',
  );
  const log = page.getByRole('region', { name: 'Activity log' });
  await expect(log).toContainText('Details changed');
  await expect(log).toContainText('Account type');
  await expect(log).toContainText('You');
  await noSideways(page);
});

test('sample fund: ledger, lots, sales, recorded values and a price chart', async ({ page }) => {
  await page.goto('/demo/asset?kind=fund');
  await expect(page.getByRole('region', { name: 'Key facts' })).toContainText(
    'Return a year (XIRR)',
  );
  await expect(page.getByRole('region', { name: 'Key facts' })).toContainText('Education fund');
  await expect(page.getByRole('region', { name: 'Transactions' })).toContainText('SIP instalment');
  await expect(page.getByRole('region', { name: 'Units still held (oldest first)' })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Sales and the purchases they used' }),
  ).toContainText('Sale');
  const recorded = page.getByRole('region', { name: 'Recorded values' });
  await expect(recorded).toContainText('Replaced');
  // the fund page adds its own figures and graphs
  await expect(page.getByRole('region', { name: 'Fund in numbers' })).toContainText(
    'Average cost per unit',
  );
  await expect(page.getByRole('region', { name: 'Fund in numbers' })).toContainText(
    'Return a year (XIRR)',
  );
  await expect(
    page.getByRole('img', { name: /price per unit with purchases and average cost/ }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /value against money put in/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /units held after each transaction/ })).toBeVisible();
  await expect(page.getByRole('list', { name: /monthly investment by month/ })).toBeVisible();
  await expect(page.getByText('instalment made').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How much is long-term' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Activity log' })).toContainText(
    'Fund position updated',
  );
  await noSideways(page);
});

test('sample fund: the range switch changes the graphs', async ({ page }) => {
  await page.goto('/demo/asset?kind=fund');
  await page
    .getByRole('navigation', { name: 'Time range' })
    .getByRole('link', { name: '6M' })
    .click();
  await expect(page).toHaveURL(/range=6m/);
  await expect(page.getByRole('img', { name: /last 6 months/ }).first()).toBeVisible();
  await noSideways(page);
});

test('the detail pages need a sign-in', async ({ request }) => {
  const id = '00000000-0000-0000-0000-000000000001';
  for (const path of [`/asset/${id}`, `/bank/${id}`, `/tasks/${id}`, `/policy/${id}`]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toMatch(/\/login$/);
  }
});
