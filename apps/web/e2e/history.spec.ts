import { expect, test, type Page } from '@playwright/test';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const noOverflow = async (page: Page) => expect(await overflow(page)).toBeLessThanOrEqual(0);

/** A stand-in for the workbook: in the sample the file is only looked at in the browser, never read. */
const fakeWorkbook = {
  name: 'Summary - Bank Reports.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  buffer: Buffer.from('PK\u0003\u0004 not a real workbook'),
};

async function openHistory(page: Page) {
  await page.goto('/demo/import');
  await page.locator('input[type=file]').first().setInputFiles(fakeWorkbook);
  await page.getByRole('button', { name: 'History from all monthly tabs' }).click();
}

test.describe('Import: history from all monthly tabs (public sample)', () => {
  test('previews one line per month, with the check against each tab and what needs a decision', async ({
    page,
  }) => {
    await openHistory(page);
    // nothing is shown before the tabs are read
    await expect(page.getByTestId('hist-months')).toHaveCount(0);
    await page.getByTestId('hist-read').click();
    const headline = page.getByTestId('hist-headline');
    await expect(headline).toContainText('6 months found, Jun 2021 to Oct 2026');
    await expect(headline).toContainText('1 month does not add up');
    await expect(headline).toContainText('2 closed deposits would be added');
    await expect(headline).toContainText('1 conflict');

    const table = page.getByTestId('hist-months');
    await expect(table.locator('tbody tr')).toHaveCount(7); // seven tabs
    const dec = table.getByRole('row', { name: /Dec 2021/ });
    await expect(dec.getByTestId('hist-check')).toContainText('✗');
    await expect(dec.getByTestId('hist-check')).toContainText('Off by ₹1,000');
    // a month that does not add up is not selected for you; one that does is
    await expect(dec.getByRole('checkbox')).not.toBeChecked();
    const jun = table.getByRole('row', { name: /June 2021/ });
    await expect(jun.getByRole('checkbox')).toBeChecked();
    await expect(jun.getByTestId('hist-check')).toContainText('✓');
    await expect(jun).toContainText("Summary tab's date of checking");

    // the tab whose date cannot be right says so, cannot be ticked, and offers the months it could be
    const jan = table.getByRole('row', { name: /Jan 2023/ });
    await expect(jan).toContainText('Its contents are newer than its date');
    await expect(jan.getByRole('checkbox')).toBeDisabled();
    await expect(jan.getByRole('combobox')).toContainText('Jan 2024 (suggested)');

    // a copy is never selected
    const copy = table.getByRole('row', { name: /Copy of Oct 2026/ });
    await expect(copy.getByRole('checkbox')).not.toBeChecked();

    // a conflict, with the choice per item, defaulting to keep what is on file
    await expect(
      page.getByRole('heading', { name: /Values that disagree with what is on file \(1\)/ }),
    ).toBeVisible();
    const keep = page.getByRole('radio', { name: 'Keep what is on file' });
    await expect(keep).toBeChecked();
    await page.getByRole('radio', { name: 'Use the sheet' }).check();
    await expect(page.getByRole('radio', { name: 'Use the sheet' })).toBeChecked();

    // unmatched lines are listed with their cell
    await page.getByText(/Lines that could not be matched/).click();
    await expect(page.getByText('F12', { exact: true })).toBeVisible();
    await expect(page.getByText(/2 accounts fit this line/)).toBeVisible();
    await noOverflow(page);
  });

  test('choosing the real month for a doubtful tab makes it an ordinary month', async ({
    page,
  }) => {
    await openHistory(page);
    await page.getByTestId('hist-read').click();
    const row = page.getByTestId('hist-months').getByRole('row', { name: /Jan 2023/ });
    await row.getByRole('combobox').selectOption({ label: 'Jan 2024 (suggested)' });
    await expect(page.getByTestId('hist-headline')).toContainText('1 month does not add up');
    await expect(page.getByTestId('hist-headline')).not.toContainText('to date');
    const again = page.getByTestId('hist-months').getByRole('row', { name: /Jan 2023/ });
    await expect(again).toContainText('Month chosen: Jan 2024');
    await expect(again.getByRole('checkbox')).toBeEnabled();
    await expect(again.getByRole('checkbox')).toBeChecked();
  });

  test('imports the selected months one by one with a progress bar and a result, saving nothing in the sample', async ({
    page,
  }) => {
    await openHistory(page);
    await page.getByTestId('hist-read').click();
    await expect(page.getByTestId('hist-import')).toContainText('Import the selected months (4)');
    await page.getByTestId('hist-import').click();
    await expect(page.getByRole('progressbar', { name: 'Months imported' })).toBeVisible();
    await expect(page.getByTestId('hist-result')).toContainText(
      'This is a sample: 4 months were acted out and nothing was saved anywhere',
    );
    await expect(page.getByTestId('hist-progress')).toContainText('4 of 4 months done');
    await noOverflow(page);
  });

  test('the coverage panel shows each account month by month, with the gaps in words', async ({
    page,
  }) => {
    await page.goto('/demo/import');
    const panel = page.locator('#history-coverage');
    await expect(panel.getByRole('heading', { name: 'History coverage' })).toBeVisible();
    await expect(panel.getByTestId('cov-summary')).toContainText(
      '6 accounts and deposits, from Jun 2021',
    );
    await expect(panel.getByTestId('cov-summary')).toContainText('months missing');
    const rows = panel.getByTestId('cov-row');
    await expect(rows).toHaveCount(6);
    // accounts with the most holes come first, and the sentence names the months
    await expect(rows.first()).toContainText('Cash-NRE-1100');
    await expect(rows.first()).toContainText('months missing');
    await expect(rows.first()).toContainText('Missing: Aug 2021');
    // every strip is named for a screen reader as well
    await expect(rows.first().getByRole('img')).toHaveAttribute(
      'aria-label',
      /Cash-NRE-1100: Balances from Jun 2021/,
    );
    // the account that started part-way and the closed one say so
    await expect(rows.filter({ hasText: 'Cash-NRO-2200' })).toContainText('Balances from Sep 2022');
    await expect(rows.filter({ hasText: 'Cash- NRE' })).toContainText('closed');
    await noOverflow(page);
  });
});

// A wide default font (the one a CI machine falls back to) must not push the page sideways at phone and tablet widths.
for (const width of [412, 810]) {
  test(`no sideways overflow with a wide font at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openHistory(page);
    await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
    await page.getByTestId('hist-read').click();
    await expect(page.getByTestId('hist-months')).toBeVisible();
    await page.getByText(/Lines that could not be matched/).click();
    await page.getByText(/Closed deposits and accounts that would be added/).click();
    await noOverflow(page);
    await page.getByTestId('hist-import').click();
    await expect(page.getByTestId('hist-result')).toBeVisible();
    await noOverflow(page);
    await page.goto('/demo/import');
    await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
    await expect(page.locator('#history-coverage')).toBeVisible();
    await noOverflow(page);
  });
}
