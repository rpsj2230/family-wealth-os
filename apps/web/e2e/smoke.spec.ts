import { expect, test } from '@playwright/test';

test('signed-out visitors are sent to the login page, which fits the screen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Family Wealth OS' })).toBeVisible();
  await expect(page.getByAltText('RP')).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('every private page redirects to login', async ({ request }) => {
  for (const path of [
    '/',
    '/import',
    '/monthly',
    '/deposits',
    '/retire',
    '/tasks',
    '/emergency',
    '/raise',
    '/more',
  ]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toMatch(/\/login$/);
  }
});

test('login explains when the database is not connected and disables sign-in', async ({ page }) => {
  await page.goto('/login');
  // CI runs without Supabase variables; a configured deployment shows no such notice.
  const notice = page.getByText(/not connected to its database/);
  if (await notice.count()) {
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  }
});

test('the filing and refund CSVs need a sign-in', async ({ request }) => {
  for (const path of ['/tax/filing/csv', '/tax/refunds/csv']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([307, 308, 401]).toContain(res.status());
  }
});

test('health endpoint reports status without leaking secrets', async ({ request }) => {
  const res = await request.get('/api/health');
  const text = await res.text();
  expect([200, 503]).toContain(res.status());
  const body = JSON.parse(text);
  expect(typeof body.ok).toBe('boolean');
  expect(Object.keys(body.env).sort()).toEqual([
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);
  expect(text).not.toMatch(/supabase\.co|sb_(publishable|secret)_|eyJ/);
});

test('security headers are present', async ({ request }) => {
  const res = await request.get('/login');
  expect(res.headers()['x-frame-options']).toBe('DENY');
  expect(res.headers()['x-content-type-options']).toBe('nosniff');
});

test('security headers are sent and no page breaks under the content policy', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /content security policy|refused to/i.test(m.text()))
      problems.push(m.text());
  });
  const res = await page.goto('/demo/retire');
  const h = res!.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['strict-transport-security']).toContain('max-age=');
  expect(h['x-frame-options']).toBe('DENY');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('the sample dashboard fits every screen and has working navigation', async ({ page }) => {
  await page.goto('/demo/dashboard');
  await expect(page.getByText('Household net worth')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const nav = page.getByRole('navigation', { name: /Main/ }).filter({ visible: true });
  await expect(nav).toHaveCount(1);
});

test('sample accounts: sections name their owner, the person filter narrows the list, nothing scrolls sideways', async ({
  page,
}) => {
  await page.goto('/demo/accounts');
  await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible();
  await expect(page.getByText('Sample Equity Bank').first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const all = await page.locator('tr.secthead').count();
  await page
    .getByRole('link', { name: /^Beena/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\?p=p2/);
  const mine = await page.locator('tr.secthead').count();
  expect(mine).toBeGreaterThan(0);
  expect(mine).toBeLessThan(all);
  for (const t of await page.locator('tr.secthead').allTextContents()) expect(t).toContain('Beena');
});

test('sample accounts: each deposit shows rate, start, maturity, invested, amount at maturity and current value', async ({
  page,
}) => {
  await page.goto('/demo/accounts');
  const head = page.locator('table.xl thead').first();
  for (const h of [
    'Rate',
    'Start',
    'Maturity',
    'Invested / balance',
    'At maturity',
    'Current value',
    'Notes',
  ])
    await expect(head).toContainText(h);
  await expect(page.locator('tr.xlrow').filter({ hasText: /FD-N/ }).first()).toContainText('%');
  await expect(page.locator('tr.xlrow').filter({ hasText: /FD-N/ }).first()).toContainText(
    'FD no.',
  );
});

test('sample monthly update: type a balance, Enter moves down, the save bar counts the change', async ({
  page,
}) => {
  await page.goto('/demo/monthly');
  const boxes = page.locator('input[data-bal]');
  await expect(boxes.first()).toBeVisible();
  await boxes.first().fill('123456');
  await expect(page.getByRole('status')).toContainText('1 change');
  await boxes.first().press('Enter');
  await expect(boxes.nth(1)).toBeFocused();
  await boxes.nth(1).fill('12abc');
  await expect(page.getByRole('alert').first()).toContainText('plain number');
});

test('sample "I need money": amounts, dates and costs by deadline, nothing scrolls sideways', async ({
  page,
}) => {
  await page.goto('/demo/raise?amount=200000');
  await expect(page.getByRole('heading', { name: /I need money/, level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'By when' })).toBeVisible();
  await expect(page.getByText('Cheapest, no deadline').first()).toBeVisible();
  await expect(page.getByText('Fastest').first()).toBeVisible();
  // a small amount is covered by cash in the bank today at no cost
  await expect(page.getByText(/Nothing is lost on this plan/).first()).toBeVisible();

  await page.goto('/demo/raise?amount=30000000');
  // a large sum needs funds, deposits that are broken early, and says what it costs
  await expect(page.getByText(/Mutual funds/).first()).toBeVisible();
  await expect(page.getByText(/withheld at source/).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('sample hard need: step by step with bank, account code and the date it all arrives', async ({
  page,
}) => {
  await page.goto('/demo/raise?amount=15000000&urgency=hard');
  await expect(page.getByText(/whatever it takes/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Step by step' })).toBeVisible();
  // accounts are named by bank and sheet-style code
  await expect(page.getByText(/Sample .* Bank · (Cash|FD)-/).first()).toBeVisible();
  await expect(page.getByText('Today', { exact: true }).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // the soft view lists the accounts behind each deadline
  await page.goto('/demo/raise?amount=15000000');
  await page.getByText('Show the accounts').first().click();
  await expect(page.getByText(/Sample .* Bank · (Cash|FD)-/).first()).toBeVisible();
});
