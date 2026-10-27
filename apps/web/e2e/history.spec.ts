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

test.describe('Import: which account is each savings line (public sample)', () => {
  const lineOf = (page: Page, cell: string) =>
    page.getByTestId('hist-ident-line').filter({ hasText: `${cell}:` });

  test('shows what the other tabs say for each line: a chip, the reason, the tab it came from', async ({
    page,
  }) => {
    await openHistory(page);
    await page.getByTestId('hist-read').click();
    const block = page.getByTestId('hist-ident');
    await expect(
      block.getByRole('heading', { name: /Which account is each savings line\? \(6\)/ }),
    ).toBeVisible();
    await expect(page.getByTestId('hist-ident-head')).toHaveText(
      '2 savings lines identified from the other tabs; 1 to confirm; 3 still need your choice',
    );

    // the sure months are folded; those with something to look at are open
    await expect(block.getByText(/Dec 2021 \(2\)/)).toBeVisible();
    await block.getByText(/^Sep 2021 \(2\)/).click();
    const sure = page.getByTestId('hist-ident-line').filter({ hasText: 'F10:' }).first();
    await expect(sure.getByTestId('hist-chip')).toHaveText('inferred');
    await expect(sure.getByTestId('hist-ident-why')).toContainText(
      'Same position (1st of 2) in Sample Bank - Anil as in the June 2021 and Dec 2021 tabs',
    );
    await expect(sure).toContainText('Worked out from the June 2021 and Dec 2021 tabs');
    // a sure line is ticked for you
    await expect(sure.getByRole('checkbox', { name: /Use Cash-NRE-1100/ })).toBeChecked();

    // a likely line is shown but not ticked
    const likely = lineOf(page, 'F14');
    await expect(likely.getByTestId('hist-chip')).toHaveText('inferred, likely');
    await expect(likely.getByRole('checkbox', { name: /Use Cash-NRE-3300/ })).not.toBeChecked();
    await expect(likely.getByTestId('hist-ident-why')).toContainText('Confirm it to use it');

    // one that cannot be told lists its candidates and offers a dropdown
    const amb = lineOf(page, 'F12').nth(1);
    await expect(amb.getByTestId('hist-chip')).toHaveText('which account?');
    await expect(amb.getByTestId('hist-ident-why')).toContainText(
      'Could be the NRE account Cash-NRE-1100 or the NRO account Cash-NRO-2200',
    );
    await expect(amb.getByRole('combobox')).toBeVisible();
    await noOverflow(page);
  });

  test('ticking a likely line and choosing for an ambiguous one are used and counted', async ({
    page,
  }) => {
    await openHistory(page);
    await page.getByTestId('hist-read').click();
    await lineOf(page, 'F14')
      .getByRole('checkbox', { name: /Use Cash-NRE-3300/ })
      .check();
    const chosen = lineOf(page, 'F14');
    await expect(chosen.getByTestId('hist-chip')).toHaveText('chosen by you');
    await expect(chosen.getByRole('combobox')).toHaveValue('a-nre-3300');
    await expect(page.getByTestId('hist-ident-head')).toContainText('3 savings lines identified');

    const amb = page.getByTestId('hist-ident-line').filter({ hasText: 'F12:' }).nth(1);
    await expect(amb.getByTestId('hist-chip')).toHaveText('which account?');
    const pick = amb.getByRole('combobox');
    await expect(pick.locator('option')).toContainText([
      'Not chosen: leave this line out',
      'Cash-NRE-1100 (NRE, ending 1100)',
      'Cash-NRO-2200 (NRO, ending 2200)',
      'Cash-NRE JO-0278 (NRE, joint, ending 0278)',
    ]);
    await pick.selectOption({ label: 'Cash-NRO-2200 (NRO, ending 2200)' });
    await expect(amb.getByTestId('hist-chip')).toHaveText('chosen by you');
    await expect(page.getByTestId('hist-ident-head')).toContainText('4 savings lines identified');
    // the month's "On file" and "Not matched" counts follow the choice
    await expect(
      page.getByTestId('hist-months').getByRole('row', { name: /Mar 2022/ }),
    ).toContainText('18');

    // taking the choice back
    await amb.getByRole('combobox').selectOption({ label: 'Not chosen: leave this line out' });
    await expect(amb.getByTestId('hist-chip')).toHaveText('which account?');
    await noOverflow(page);
  });

  test('a choice can be given to every tab where the same label sits in the same place', async ({
    page,
  }) => {
    await openHistory(page);
    await page.getByTestId('hist-read').click();
    const mar = page.getByTestId('hist-ident-line').filter({ hasText: 'F12:' }).nth(1);
    await mar.getByRole('combobox').selectOption({ label: 'Cash-NRO-2200 (NRO, ending 2200)' });
    await mar
      .getByRole('checkbox', { name: /Also for every tab where .Cash. sits in the same place/ })
      .check();
    await expect(page.getByTestId('hist-ident-head')).toContainText('1 still needs your choice');
    const dec = page.getByTestId('hist-ident-line').filter({ hasText: 'F12:' }).first();
    await expect(dec.getByTestId('hist-chip')).toHaveText('chosen by you');
    await expect(dec.getByRole('combobox')).toHaveValue('a-nro-2200');
    // un-ticking takes it back from the other tab only
    await mar
      .getByRole('checkbox', { name: /Also for every tab where .Cash. sits in the same place/ })
      .uncheck();
    await expect(dec.getByTestId('hist-chip')).toHaveText('which account?');
    await expect(mar.getByTestId('hist-chip')).toHaveText('chosen by you');
  });

  test('a blocked line says why and still lets the person choose; a sure line can be left out', async ({
    page,
  }) => {
    await openHistory(page);
    await page.getByTestId('hist-read').click();
    const blocked = lineOf(page, 'F20');
    await expect(blocked.getByTestId('hist-chip')).toHaveText('not inferred');
    await expect(blocked.getByTestId('hist-ident-why')).toContainText(
      'Not inferred. It would be the NRE account Cash-NRE-4400',
    );
    await expect(blocked.getByTestId('hist-ident-why')).toContainText('is far from what');
    await expect(blocked.getByRole('combobox')).toBeVisible();

    await page
      .getByTestId('hist-ident')
      .getByText(/^Sep 2021 \(2\)/)
      .click();
    const sure = lineOf(page, 'F10');
    await sure.getByRole('checkbox', { name: /Use Cash-NRE-1100/ }).uncheck();
    await expect(sure).toContainText('Left out.');
    await expect(sure.getByTestId('hist-chip')).toHaveText('left out');
    await sure.getByRole('button', { name: 'Undo' }).click();
    await expect(sure.getByTestId('hist-chip')).toHaveText('inferred');
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
    // every month of the savings lines open, a choice made, and the long reasons and drop-down texts shown
    await page
      .getByTestId('hist-ident')
      .getByText(/^Sep 2021 \(2\)/)
      .click();
    await expect(page.getByTestId('hist-ident-line')).toHaveCount(6);
    const amb = page.getByTestId('hist-ident-line').filter({ hasText: 'F12:' }).nth(1);
    await amb
      .getByRole('combobox')
      .selectOption({ label: 'Cash-NRE JO-0278 (NRE, joint, ending 0278)' });
    await amb.getByRole('checkbox', { name: /Also for every tab/ }).check();
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

test.describe('Import > Excel workbook tab: history box', () => {
  test('the workbook tab offers history from all monthly tabs with its own file box', async ({
    page,
  }) => {
    await page.goto('/demo/import?tab=workbook');
    const box = page.locator('details', { hasText: 'History from all monthly tabs' });
    await box.locator('summary').click();
    await box.getByTestId('history-file').setInputFiles(fakeWorkbook);
    await expect(box.getByTestId('hist-read')).toBeVisible();
    await noOverflow(page);
  });
});
