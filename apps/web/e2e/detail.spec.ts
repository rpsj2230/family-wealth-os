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
  await expect(page.getByRole('img', { name: /NAV from/ })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Activity log' })).toContainText(
    'Fund position updated',
  );
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
