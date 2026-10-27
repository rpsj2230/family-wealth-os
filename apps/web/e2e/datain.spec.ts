import { expect, test, type Page } from '@playwright/test';

const noOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe('Monthly update (public sample)', () => {
  test('summarises which banks are current, and how the latest values arrived', async ({
    page,
  }) => {
    await page.goto('/demo/monthly');
    await expect(page.getByRole('heading', { name: 'Monthly update', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Where each bank stands' })).toBeVisible();
    await expect(page.getByText(/banks are up to date/).first()).toBeVisible();
    await expect(page.getByText('How the latest balances arrived:')).toBeVisible();
    await expect(page.getByRole('link', { name: /Banks and deposits/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Property, loans and other' })).toBeVisible();
    // every line of the sheet says where its last value came from
    await expect(page.locator('.srcchip').first()).toBeVisible();
    await noOverflow(page);
  });

  test('the new-balance box is reachable on every screen and typing shows what changed', async ({
    page,
  }) => {
    await page.goto('/demo/monthly');
    const box = page.locator('input[data-bal]').first();
    await box.scrollIntoViewIfNeeded();
    await expect(box).toBeVisible();
    const placeholder = Number(await box.getAttribute('placeholder'));
    await box.fill(String(placeholder + 1000));
    await expect(page.getByText(/since last/).first()).toBeVisible();
    await box.fill(String(placeholder * 50));
    await expect(page.getByText(/Check the digits/).first()).toBeVisible();
    await noOverflow(page);
  });

  test('"Same" carries one balance forward and "Nothing changed" a whole bank', async ({
    page,
  }) => {
    await page.goto('/demo/monthly');
    const first = page.locator('input[data-bal]').first();
    await first.scrollIntoViewIfNeeded();
    await page
      .getByRole('button', { name: /^Same as last for/ })
      .first()
      .click();
    await expect(first).not.toHaveValue('');
    await expect(page.getByRole('status').filter({ hasText: /1 change/ })).toBeVisible();
    await page.getByRole('button', { name: /^Nothing changed at Sample Equity Bank/ }).click();
    await expect(page.getByRole('status').filter({ hasText: /carried forward/ })).toBeVisible();
    // nothing is saved by this, and it can be dropped
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(first).toHaveValue('');
  });

  test('a column pasted from Excel fills the boxes below', async ({ page }) => {
    await page.goto('/demo/monthly');
    const boxes = page.locator('input[data-bal]');
    await boxes.first().scrollIntoViewIfNeeded();
    await boxes.first().evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '1000\n2000\n3000');
      el.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    });
    await expect(boxes.nth(0)).toHaveValue('1000');
    await expect(boxes.nth(2)).toHaveValue('3000');
  });

  test('the status board jumps to a bank that is waiting', async ({ page }) => {
    await page.goto('/demo/monthly');
    await page.getByRole('button', { name: 'Go to Sample Equity Bank' }).click();
    await expect(page.locator('#sample-equity-bank')).toBeInViewport();
  });

  test('the other-items tab keeps property, pension and loans', async ({ page }) => {
    await page.goto('/demo/monthly?tab=other');
    await expect(page.getByText('Sample Flat')).toBeVisible();
    await expect(page.getByText('Sample Pension Plan')).toBeVisible();
    await noOverflow(page);
  });
});

test.describe('Bank emails (public sample)', () => {
  test('the review queue explains each message and offers apply or ignore', async ({ page }) => {
    await page.goto('/demo/inbox');
    await expect(page.getByRole('heading', { name: 'Bank emails', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Needs your review/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByText(/read from an email/).first()).toBeVisible();
    await expect(page.getByText(/not recorded without your say-so/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply to this account' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ignore' }).first()).toBeVisible();
    await noOverflow(page);
  });

  test('a sample apply says it is a sample', async ({ page }) => {
    await page.goto('/demo/inbox');
    await page.getByRole('button', { name: 'Apply to this account' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /sample/ })).toBeVisible();
  });

  test('skipped messages say why, and the filter narrows them by reason', async ({ page }) => {
    await page.goto('/demo/inbox?tab=skipped');
    await expect(
      page.locator('li strong', { hasText: 'Not a balance email' }).first(),
    ).toBeVisible();
    await expect(page.getByText(/same age or newer/)).toBeVisible();
    await expect(page.getByText(/No SGD exchange rate/)).toBeVisible();
    await page.getByRole('link', { name: /Reader problems/ }).click();
    await expect(page).toHaveURL(/f=problem/);
    await expect(page.getByText(/No SGD exchange rate/)).toBeVisible();
    await expect(page.locator('li strong', { hasText: 'Not a balance email' })).toHaveCount(0);
    await noOverflow(page);
  });

  test('a recorded balance shows the email with the number marked, and the number can be corrected', async ({
    page,
  }) => {
    await page.goto('/demo/inbox?tab=recorded');
    const card = page.locator('li', { hasText: 'account ending 1134' });
    await card.getByText('Show the email').click();
    await expect(card.getByTestId('read-number')).toHaveText('2,22,400.00');
    await expect(card.getByLabel('Balance read from this email')).toHaveValue('222400');
    await card.getByRole('button', { name: 'Save number' }).click();
    await expect(card.getByRole('alert').filter({ hasText: /sample/ })).toBeVisible();
    await noOverflow(page);
  });

  test('a skipped email can be read again by the AI', async ({ page }) => {
    await page.goto('/demo/inbox?tab=skipped');
    const card = page.locator('li', { hasText: 'Our new savings rates are here' });
    await card.getByRole('button', { name: 'Read again' }).click();
    await expect(card.getByRole('alert').filter({ hasText: /sample/ })).toBeVisible();
    await card.getByText('Show the email').click();
    await expect(card.getByText('Festive offers')).toBeVisible();
    await noOverflow(page);
  });

  test('recorded messages and the automation tab', async ({ page }) => {
    await page.goto('/demo/inbox?tab=recorded');
    await expect(page.getByText(/recorded by itself/).first()).toBeVisible();
    await page.goto('/demo/inbox?tab=automation');
    for (const t of ['Bank email reader', 'Market data', 'Daily summary', 'Bank rate pages'])
      await expect(page.getByRole('heading', { name: new RegExp(t) })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How emails get in' })).toBeVisible();
    await noOverflow(page);
  });
});

test.describe('Import (public sample)', () => {
  test('workbook tab: layout, last import and the rules', async ({ page }) => {
    await page.goto('/demo/import?tab=workbook');
    await expect(page.getByRole('heading', { name: 'Import', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Keep your Excel order' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Last workbook import' })).toBeVisible();
    await expect(page.getByText('sample-household.xlsx')).toBeVisible();
    // the kind pages lead back to the front door
    await expect(page.getByRole('link', { name: '‹ Import any file' })).toHaveAttribute(
      'href',
      '/demo/import',
    );
    await noOverflow(page);
  });

  test('the front door has one box for any file and a card for each kind', async ({ page }) => {
    await page.goto('/demo/import');
    await expect(page.getByRole('heading', { name: 'Choose a file' })).toBeVisible();
    await expect(page.getByText('nothing is uploaded')).toBeVisible();
    for (const [name, tab] of [
      ['Excel workbook', 'workbook'],
      ['Fund statement', 'cas'],
      ['Fund app export (CSV)', 'csv'],
      ['Tax statement', 'tax'],
    ] as const) {
      const card = page.locator('article.pickcard', {
        has: page.getByRole('heading', { name, exact: true }),
      });
      await expect(card.getByRole('link', { name: 'Open' })).toHaveAttribute(
        'href',
        `/demo/import?tab=${tab}`,
      );
    }
    await noOverflow(page);
  });

  test('a workbook is recognised and offers the two things it can do', async ({ page }) => {
    await page.goto('/demo/import');
    await page.locator('.dropzone input[type=file]').setInputFiles({
      name: 'Family finances 2026.xlsx',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('PK\x03\x04 sample'),
    });
    await expect(page.getByText(/This is an Excel workbook/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your Excel workbook' })).toBeVisible();
    const choice = page.getByRole('group', { name: 'What should the workbook do' });
    await expect(
      choice.getByRole('button', { name: 'Update order, names and links' }),
    ).toHaveAttribute('aria-pressed', 'true'); // a workbook was imported before, so the safe choice comes first
    await expect(page.getByText('Family finances 2026.xlsx').first()).toBeVisible();
    await choice.getByRole('button', { name: 'Import balances and deposits' }).click();
    await expect(page.getByRole('button', { name: /^Preview \(nothing/ })).toBeVisible();
    await noOverflow(page);
  });

  test('a fund export, a fund statement and a tax statement each open their own form', async ({
    page,
  }) => {
    await page.goto('/demo/import');
    const input = page.locator('.dropzone input[type=file]');
    await input.setInputFiles({
      name: 'Anil_transactions.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Date,Folio Number,Name of the Fund,Order,Units,NAV,Current Nav,Amount\n2025-01-01,1,X,Buy,1,1,1,1\n',
      ),
    });
    await expect(page.getByText(/Folio, Units and Amount columns/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fund app export', level: 2 })).toBeVisible();
    // the person is taken from the first name in the file name
    await expect(page.getByLabel('Whose is Anil_transactions.csv')).toHaveValue('p1');

    await input.setInputFiles({
      name: 'Beena CAS 2026.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7'),
    });
    await expect(page.getByRole('heading', { name: 'Fund statement', level: 2 })).toBeVisible();
    await expect(page.getByLabel('Whose statement')).toHaveValue('p2');
    await expect(page.getByRole('button', { name: 'Import statement' })).toBeVisible();

    await input.setInputFiles({
      name: 'Form26AS_2025-26.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7'),
    });
    await expect(page.getByRole('heading', { name: 'Tax statement', level: 2 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Read this file' })).toBeVisible();
    await noOverflow(page);
  });

  test('a file whose kind cannot be told asks, and the answer opens the right form', async ({
    page,
  }) => {
    await page.goto('/demo/import');
    const input = page.locator('.dropzone input[type=file]');
    await input.setInputFiles({
      name: 'scan0001.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.7'),
    });
    await expect(page.getByText(/does not say which kind/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import statement' })).toHaveCount(0);
    await page.getByLabel('What is this file?').selectOption('cas');
    await expect(page.getByRole('button', { name: 'Import statement' })).toBeVisible();

    await input.setInputFiles({
      name: 'holiday.png',
      mimeType: 'image/png',
      buffer: Buffer.from('x'),
    });
    await expect(page.getByText(/not one the app can read/)).toBeVisible();
  });

  test('fund statement tab: password rule, PAN on file, recent results and what needs review', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=cas');
    await expect(page.getByText('Password.', { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/PAN on file/)).toBeVisible();
    await expect(page.getByText('Check some items')).toBeVisible();
    await expect(page.getByText(/need a look/)).toBeVisible();
    await expect(page.getByText(/ends 234F/)).toBeVisible();
    await noOverflow(page);
  });

  test('tax statement tab: where to get 26AS and AIS, and what is on file', async ({ page }) => {
    await page.goto('/demo/import?tab=tax');
    await expect(page.getByRole('heading', { name: 'Upload a tax statement' })).toBeVisible();
    await expect(page.getByText(/date of birth as DDMMYYYY/)).toBeVisible();
    await expect(page.getByText('AI: check the figures')).toBeVisible();
    await noOverflow(page);
  });
});

test('the old Monthly "all items" address and the new pages need a sign-in', async ({
  request,
}) => {
  for (const path of ['/monthly/all', '/inbox', '/import?tab=cas', '/monthly?tab=other']) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toMatch(/\/login$/);
  }
});
