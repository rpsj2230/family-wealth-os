import { expect, test, type Page } from '@playwright/test';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const noOverflow = async (page: Page) => expect(await overflow(page)).toBeLessThanOrEqual(0);

const row = (page: Page, bank: string) =>
  page.getByTestId('sync-row').filter({ has: page.getByRole('heading', { name: bank }) });

/** The Sync bank rates page on the public sample (invented banks): the buttons act the sync out and save nothing. */
test.describe('Sync bank rates (public sample)', () => {
  test('lists every bank with its pages, last result, rates on file and a status chip', async ({
    page,
  }) => {
    await page.goto('/demo/rates/sync');
    await expect(
      page.getByRole('heading', { name: 'Sync bank rates (sample)', level: 1 }),
    ).toBeVisible();
    await expect(
      page.getByText("Rates are only ever read from the bank's own pages."),
    ).toBeVisible();
    await expect(page.getByTestId('sync-row')).toHaveCount(4);

    const north = row(page, 'Sample North Bank');
    await expect(north.getByTestId('sync-chip')).toHaveText('Synced today');
    await expect(north).toContainText('14 rates on file');
    await expect(north).toContainText('checked today');
    await expect(north).toContainText('14 rates saved: 2 new, 3 changed, 9 unchanged');

    const lake = row(page, 'Sample Lake Bank');
    await expect(lake.getByTestId('sync-chip')).toHaveText('Unchanged');
    await expect(lake).toContainText('Unchanged since 2026-10-20');
    // the PDF a link on the bank's own page led to, and the date the bank gives
    await expect(lake.getByTestId('rate-doc')).toContainText(
      'Rates document: www.lake.example.test/assets/rates/savings-2026-10.pdf',
    );
    await expect(lake.getByTestId('rate-doc')).toContainText('effective from 2026-10-04');
    // each document with its kind and how it went
    await expect(lake.locator('.sync-docs li')).toHaveCount(2);
    await expect(lake.locator('.sync-docs li').first()).toContainText('Fixed deposits');
    await expect(lake.locator('.sync-docs li').first()).toContainText('Read OK, 5,310 characters');
    await expect(lake.locator('.sync-docs li').nth(1)).toContainText('Savings');

    const coast = row(page, 'Sample Coast Bank');
    await expect(coast.getByTestId('sync-chip')).toHaveText('Not synced yet');
    await expect(coast).toContainText('No rates on file');
    await expect(coast.locator('.sync-docs li')).toHaveCount(2); // two pages saved for the bank
  });

  test('says plainly when a bank cannot be read, and offers the paste box right there', async ({
    page,
  }) => {
    await page.goto('/demo/rates/sync');
    const hill = row(page, 'Sample Hill Bank');
    await expect(hill.getByTestId('sync-chip')).toHaveText('Cannot read');
    await expect(hill).toContainText(
      'Cannot read: Sample Hill Bank’s site refused the automated visit (403 Access Denied)',
    );
    await expect(hill.getByTestId('cannot-hint')).toContainText('expand every section');
    // the paste box is open for a bank that cannot be read
    const paste = hill.locator('details.pastepage');
    await expect(paste).toHaveJSProperty('open', true);
    await paste.getByRole('textbox').fill('Savings 3.5% fixed deposit 7.1% '.repeat(20));
    await paste.getByRole('button', { name: 'Read the rates' }).click();
    await expect(paste).toContainText('This is a sample');
    await noOverflow(page);
  });

  test('warns about rates from comparison websites and removes them only after a confirm step', async ({
    page,
  }) => {
    await page.goto('/demo/rates/sync');
    const note = page.getByTestId('third-party');
    await expect(note).toContainText(
      '3 saved rates came from comparison websites (third party). They are kept until the bank’s own page is synced, then replaced.',
    );
    await expect(row(page, 'Sample Hill Bank')).toContainText('3 from comparison websites');
    await note.getByRole('button', { name: 'Remove rates from comparison websites' }).click();
    await expect(note).toContainText(
      'Remove the 3 saved rates that came from comparison websites?',
    );
    await note.getByRole('button', { name: 'Cancel' }).click();
    await expect(note.getByRole('button', { name: 'Yes, remove them' })).toHaveCount(0);
    await note.getByRole('button', { name: 'Remove rates from comparison websites' }).click();
    await note.getByRole('button', { name: 'Yes, remove them' }).click();
    await expect(note).toContainText('This is a sample: nothing was removed.');
  });

  test('Sync all banks goes one bank at a time with live progress, then a result', async ({
    page,
  }) => {
    await page.goto('/demo/rates/sync');
    await page.getByTestId('sync-all').click();
    const progress = page.getByTestId('sync-progress');
    await expect(progress).toHaveText('Syncing 1 of 4: Sample Coast Bank…');
    await expect(page.getByTestId('busy-note').first()).toBeVisible();
    await expect(progress).toHaveText('Syncing 2 of 4: Sample Hill Bank…');
    await expect(progress).toHaveText('Syncing 3 of 4: Sample Lake Bank…');
    await expect(page.getByTestId('sync-summary')).toContainText(
      'Done: 4 of 4 banks. 2 synced, 1 unchanged, 1 cannot be read.',
    );
    // each row shows its own result line and chip
    const coast = row(page, 'Sample Coast Bank');
    await expect(coast.getByTestId('sync-chip')).toHaveText('Synced today');
    await expect(coast).toContainText('Just now: 9 rates saved: 9 new, 0 changed, 0 unchanged');
    await expect(row(page, 'Sample Hill Bank').getByTestId('sync-chip')).toHaveText('Cannot read');
    await expect(row(page, 'Sample North Bank').getByTestId('sync-chip')).toHaveText('Unchanged');
    await noOverflow(page);
  });

  test('Stop ends the run between banks', async ({ page }) => {
    await page.goto('/demo/rates/sync');
    await page.getByTestId('sync-all').click();
    await expect(page.getByTestId('sync-progress')).toHaveText(
      'Syncing 1 of 4: Sample Coast Bank…',
    );
    await page.getByTestId('sync-stop').click();
    await expect(page.getByTestId('sync-summary')).toContainText('Stopped after 1 of 4 banks');
    await expect(row(page, 'Sample Coast Bank').getByTestId('sync-chip')).toHaveText(
      'Synced today',
    );
    // the banks not reached keep what they had
    await expect(row(page, 'Sample Lake Bank').getByTestId('sync-chip')).toHaveText('Unchanged');
  });

  test('one bank can be synced on its own, and another page can be added for it', async ({
    page,
  }) => {
    await page.goto('/demo/rates/sync');
    await row(page, 'Sample Hill Bank')
      .getByRole('button', { name: 'Sync Sample Hill Bank' })
      .click();
    await expect(row(page, 'Sample Hill Bank').getByTestId('busy-note')).toBeVisible();
    await expect(row(page, 'Sample Hill Bank')).toContainText('Just now: Cannot read:');
    const lake = row(page, 'Sample Lake Bank');
    await lake.getByText('Add another page for this bank').click();
    await lake
      .getByLabel('Address of another Sample Lake Bank rate page')
      .fill('https://www.lake.example.test/savings');
    await lake.getByRole('combobox').selectOption({ label: 'Savings' });
    await lake.getByRole('button', { name: 'Add page' }).click();
    await expect(lake).toContainText('This is a sample: nothing was saved anywhere.');
  });

  test('the Rates sample has a Sync rates button that leads here', async ({ page }) => {
    await page.goto('/demo/rates');
    await page.getByRole('link', { name: 'Sync rates' }).click();
    await expect(page).toHaveURL(/\/demo\/rates\/sync$/);
    await expect(page.getByRole('heading', { name: /Sync bank rates/, level: 1 })).toBeVisible();
  });

  test('fits the screen', async ({ page }) => {
    await page.goto('/demo/rates/sync');
    await noOverflow(page);
  });
});

// A wide default font (the one a CI machine falls back to) must not push the page sideways at phone and tablet widths.
for (const width of [412, 810]) {
  test(`no sideways overflow with a wide font at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/demo/rates/sync');
    await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
    await noOverflow(page);
    // a bank that cannot be read, with its long sentence and the paste box open
    const hill = row(page, 'Sample Hill Bank');
    await hill.locator('details.pastepage').getByRole('textbox').fill('x '.repeat(200));
    await noOverflow(page);
    await row(page, 'Sample Lake Bank').getByText('Add another page for this bank').click();
    await page
      .getByTestId('third-party')
      .getByRole('button', { name: 'Remove rates from comparison websites' })
      .click();
    await noOverflow(page);
    await page.getByTestId('sync-all').click();
    await expect(page.getByTestId('sync-progress')).toBeVisible();
    await noOverflow(page);
    await expect(page.getByTestId('sync-summary')).toBeVisible();
    await noOverflow(page);
  });
}

test('the private Sync bank rates page needs a sign-in', async ({ page }) => {
  await page.goto('/rates/sync');
  await expect(page).toHaveURL(/\/login/);
});
