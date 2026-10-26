import { expect, test, type Page } from '@playwright/test';

const noOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

/** The sample must work with no Google access at all: remember every address the page asks for. */
const watchNetwork = (page: Page) => {
  const asked: string[] = [];
  page.on('request', (r) => asked.push(r.url()));
  return () => asked.filter((u) => /googleapis\.com|accounts\.google|docs\.google\.com/.test(u));
};

test.describe('Sync with Google Sheet (public sample)', () => {
  test('the Import page previews the sync from invented data, then explains that nothing is written', async ({
    page,
  }) => {
    const google = watchNetwork(page);
    await page.goto('/demo/import');
    const card = page.locator('#google-sheet');
    await expect(card.getByRole('heading', { name: 'Sync with Google Sheet' })).toBeVisible();
    await expect(card.getByText('Connected', { exact: true })).toBeVisible();
    await expect(card.getByText(/Last sync, Sep 2026/)).toBeVisible();
    // nothing to confirm before a preview exists
    await expect(card.getByRole('button', { name: /Confirm and write/ })).toHaveCount(0);

    await card.getByRole('button', { name: 'Preview sync' }).click();
    await expect(card.getByText(/Will go to the tab “Oct 2026”/)).toBeVisible();
    await expect(card.getByText(/created as a copy of “Sep 2026”, to its left/)).toBeVisible();
    // each row shows old, then new, in words that a screen reader reads too
    const cash = card.locator('.ss-row', { hasText: 'Cash-NRE-1100' });
    await expect(cash).toContainText('Amount');
    await expect(cash).toContainText('40,000');
    await expect(cash).toContainText('47,315.42');
    await expect(cash.locator('.sr-only').first()).toHaveText('was ');
    // a status word on every kind of row, not only a colour
    await expect(card.getByText('By hand', { exact: true })).toBeVisible();
    await expect(card.getByText('New row', { exact: true }).first()).toBeVisible();
    await expect(card.getByText('Change', { exact: true }).first()).toBeVisible();
    // the lists that only need a look are folded; opening one shows its rows, each with its word
    await card.locator('summary', { hasText: /Closed in the app, still in the sheet/ }).click();
    await expect(card.getByText('Closed in the app', { exact: true })).toBeVisible();
    await card.locator('summary', { hasText: 'In the sheet, not in the app' }).click();
    await expect(card.getByText('Not matched', { exact: true })).toBeVisible();
    await noOverflow(page);

    await card.getByRole('button', { name: 'Confirm and write to Google Sheet' }).click();
    await expect(card.getByText(/This is a sample: nothing is written anywhere/)).toBeVisible();
    expect(google()).toEqual([]);
  });

  test('a preview can be discarded', async ({ page }) => {
    await page.goto('/demo/import');
    const card = page.locator('#google-sheet');
    await card.getByRole('button', { name: 'Preview sync' }).click();
    await expect(card.getByRole('button', { name: 'Discard preview' })).toBeVisible();
    await card.getByRole('button', { name: 'Discard preview' }).click();
    await expect(card.getByText(/Will go to the tab/)).toHaveCount(0);
  });

  test('the Monthly update page has the button in its header and opens the same panel', async ({
    page,
  }) => {
    const google = watchNetwork(page);
    await page.goto('/demo/monthly');
    await page.getByRole('button', { name: 'Sync with Google Sheet' }).click();
    const dialog = page.getByRole('dialog', { name: 'Sync with Google Sheet' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Preview sync' }).click();
    await expect(dialog.getByText(/Will go to the tab “Oct 2026”/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Confirm and write/ })).toBeVisible();
    await noOverflow(page);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(google()).toEqual([]);
  });

  test('Settings > Connections has the Google Sheet card with the status, the steps and a test', async ({
    page,
  }) => {
    const google = watchNetwork(page);
    await page.goto('/demo/settings?tab=connections');
    const card = page.locator('#google-sheet');
    await expect(card.getByRole('heading', { name: 'Google Sheet' })).toBeVisible();
    await expect(
      card.getByText('portal-sync@sample-project.iam.gserviceaccount.com'),
    ).toBeVisible();
    await expect(card.getByText('saved on the server (it cannot be shown again)')).toBeVisible();
    // the key cannot be read back: the box is empty and only a placeholder is shown
    const key = card.getByLabel(/Service-account key/);
    await expect(key).toHaveValue('');
    await expect(key).toBeDisabled();
    await card.getByRole('button', { name: 'Test connection' }).click();
    await expect(
      card.getByText(/All good. The next sync fills “Oct 2026”, copied from “Sep 2026”/),
    ).toBeVisible();
    await expect(card.getByText(/may edit the spreadsheet/)).toBeVisible();
    await card.getByText('How to connect (about ten minutes, free)').click();
    await expect(card.getByText(/Create service account/)).toBeVisible();
    await expect(card.getByText(/Editor/).first()).toBeVisible();
    await noOverflow(page);
    expect(google()).toEqual([]);
  });

  test('the old in-page address #google-sheet opens the Connections section', async ({ page }) => {
    await page.goto('/demo/settings#google-sheet');
    await expect(
      page.getByRole('heading', { name: 'Connections', level: 2, exact: true }),
    ).toBeVisible();
  });
});
