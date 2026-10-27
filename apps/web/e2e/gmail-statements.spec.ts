import { expect, test, type Page } from '@playwright/test';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const noOverflow = async (page: Page) => expect(await overflow(page)).toBeLessThanOrEqual(0);

const open = async (page: Page) => {
  await page.goto('/demo/import?tab=cas');
  return page.locator('#gmail-statements');
};

test.describe('Import > Fund statement: read my statements from Gmail (public sample)', () => {
  test('shows the state of the scan in plain words', async ({ page }) => {
    const card = await open(page);
    await expect(
      card.getByRole('heading', { name: 'Read my fund statements from Gmail' }),
    ).toBeVisible();
    for (const chip of ['Read only', 'No AI used', 'Switch off any time'])
      await expect(card.getByText(chip, { exact: true })).toBeVisible();
    await expect(card.getByText('a***@g***.com').first()).toBeVisible();
    for (const s of ['camsonline.com', 'kfintech.com', 'nsdl.co.in', 'cdslstatement.com'])
      await expect(card.getByText(s, { exact: true }).first()).toBeVisible();
    await expect(card.getByRole('link', { name: 'Edit in Settings' })).toHaveAttribute(
      'href',
      /settings\?tab=rules#gmail-statements/,
    );
    await expect(card.getByTestId('gm-last')).toContainText(
      /Last scan 26 Oct 2026, 08:41: 3 statements found, 2 imported, 1 problem/,
    );
    // the statements it read, with the registrar, the person and the plain result
    const rows = card.locator('table.gm-table tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('CAMS');
    await expect(rows.nth(0)).toContainText(
      'Fund statement from CAMS: 6 funds, 12 transactions added',
    );
    await expect(rows.nth(2)).toContainText('Could not open: none of the saved passwords fits');
    await expect(card.getByRole('link', { name: 'Recent statements' })).toHaveAttribute(
      'href',
      '#recent-statements',
    );
    // the sample cannot press the buttons
    await expect(card.getByRole('button', { name: 'Scan now' }).first()).toBeDisabled();
    await expect(card.getByRole('button', { name: 'Switch off' })).toBeDisabled();
    await noOverflow(page);
  });

  test('explains how to get statements into Gmail and how the app reads it', async ({ page }) => {
    const card = await open(page);
    await card.getByText('How to get statements in your Gmail').click();
    await expect(card.getByText('donotreply@camsonline.com')).toBeVisible();
    await expect(card.getByText(/PAN in capital letters/).first()).toBeVisible();
    await expect(
      card.getByText(/never sends, deletes, labels, moves or marks anything/),
    ).toBeVisible();
    await expect(card.getByText(/app password over IMAP, not with Google sign-in/)).toBeVisible();
    const search = card.getByRole('link', { name: 'Search your inbox for these senders' });
    await expect(search).toHaveAttribute('href', /mail\.google\.com\/mail\/u\/0\/#search\/from%3A/);
    expect(decodeURIComponent((await search.getAttribute('href')) ?? '')).not.toContain('@');
    await noOverflow(page);
  });

  test('the guided request sends nothing: it opens official pages in a new tab and notes the request', async ({
    page,
  }) => {
    const card = await open(page);
    await expect(
      card.getByRole('heading', { name: 'Request a full detailed statement' }),
    ).toBeVisible();
    await expect(card.getByText(/security check that a\s+program must not bypass/)).toBeVisible();
    await expect(card.getByText('Choose exactly these:')).toBeVisible();
    await expect(card.getByText('zero balance').first()).toBeVisible();
    const cams = card.getByRole('link', { name: /Open the CAMS request page/ });
    await expect(cams).toHaveAttribute('href', /^https:\/\/www\.camsonline\.com\//);
    await expect(cams).toHaveAttribute('target', '_blank');
    await expect(cams).toHaveAttribute('rel', /noopener/);
    await expect(
      card.getByRole('link', { name: /Open the KFintech request page/ }),
    ).toHaveAttribute('href', /^https:\/\/mfs\.kfintech\.com\//);
    await expect(
      card.getByRole('link', { name: /Open the MF Central request page/ }),
    ).toHaveAttribute('href', /^https:\/\/www\.mfcentral\.com/);
    // what is waiting, what is late, what arrived
    const list = card.getByRole('list', { name: 'Statements you asked for' });
    await expect(
      list.getByText(/Requested from CAMS for Anil on 25 Oct 2026: waiting/),
    ).toBeVisible();
    await expect(
      list.getByText(/Requested from KFintech for Beena on 20 Oct 2026: not arrived after 2 days/),
    ).toBeVisible();
    await expect(
      list.getByText(/Requested from MF Central for Anil .*arrived on 3 Oct 2026/),
    ).toBeVisible();
    await noOverflow(page);
  });

  test('statement passwords are write-only: only a count is shown', async ({ page }) => {
    const card = await open(page);
    await card.getByText('Statement passwords (if you did not use your PAN)').click();
    await expect(card.getByText('Anil: 1 saved')).toBeVisible();
    await expect(card.getByText('Beena: none saved')).toBeVisible();
    await expect(card.locator('input[name=statementPassword]')).toHaveAttribute('type', 'password');
    await expect(card.getByText(/never reads a password out of an e-mail/)).toBeVisible();
    await noOverflow(page);
  });

  test('Settings > Connections has a one-line state', async ({ page }) => {
    await page.goto('/demo/settings?tab=connections');
    const line = page.locator('#gmail-connection');
    await expect(line.getByText('Gmail fund statements')).toBeVisible();
    await expect(line).toContainText('Last scan 26 Oct 2026');
    await expect(line.getByRole('link', { name: 'Open on Import' })).toHaveAttribute(
      'href',
      '/demo/import?tab=cas#gmail-statements',
    );
    await noOverflow(page);
  });

  test('Settings > Money rules has the Gmail statements card', async ({ page }) => {
    await page.goto('/demo/settings?tab=rules');
    const card = page.locator('#gmail-statements');
    await expect(card.getByLabel(/Read my fund statements from Gmail/)).toBeChecked();
    await expect(card.getByLabel(/Senders a statement may come from/)).toHaveValue(
      /camsonline\.com/,
    );
    await expect(card.getByLabel(/First scan looks back/)).toHaveValue('400');
    await expect(card.getByLabel(/Every later scan looks back/)).toHaveValue('35');
    await noOverflow(page);
  });
});

// A wide default font (the one a CI machine falls back to) must not push the page sideways at phone and tablet widths.
for (const width of [412, 810]) {
  test(`no sideways overflow with a wide font at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const card = await open(page);
    await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
    await card.getByText('How to get statements in your Gmail').click();
    await card.getByText('Statement passwords (if you did not use your PAN)').click();
    await noOverflow(page);
    await page.goto('/demo/settings?tab=connections');
    await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
    await noOverflow(page);
    await page.goto('/demo/settings?tab=rules');
    await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
    await noOverflow(page);
  });
}
