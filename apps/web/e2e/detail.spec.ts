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
  // one current value: the dark headline and the facts show the same figure, and no second "current value" is worked out
  const headline = (await page.getByTestId('fd-current').innerText()).trim();
  const facts = page.getByRole('region', { name: 'Key facts' });
  await expect(facts).toContainText(headline);
  await expect(facts).not.toContainText('Current value (estimate)');
  await expect(facts).toContainText('7.25%');
  await expect(facts).toContainText('Maturity value');
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

test('sample fund: headline, figures, graphs and every tab', async ({ page }) => {
  await page.goto('/demo/asset?kind=fund');
  const hero = page.getByRole('region', { name: 'This fund at a glance' });
  await expect(hero).toContainText('Current value');
  await expect(hero).toContainText(/XIRR -?\d+\.\d% a year/);
  await expect(hero).toContainText('Profit');
  await expect(hero).toContainText('Booked profit');
  await expect(hero).not.toContainText('Compound growth');
  await expect(hero).not.toContainText('Monthly investment');
  // overview: the figures and the graphs
  await expect(page.getByRole('region', { name: 'Fund in numbers' })).toContainText('Average cost');
  await expect(
    page.getByRole('img', { name: /price per unit with purchases and average cost/ }),
  ).toBeVisible();
  await expect(page.getByRole('img', { name: /current value against invested/ })).toBeVisible();
  await expect(page.getByRole('img', { name: /units held after each transaction/ })).toBeVisible();
  await expect(page.getByRole('list', { name: /monthly investment by month/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How much is long-term' })).toBeVisible();
  await noSideways(page);

  const tabs = page.getByRole('navigation', { name: 'Sections' });
  // lots and profit: purchases still held with their age, sales with the profit they booked
  await tabs.getByRole('link', { name: 'Lots and profit' }).click();
  await expect(page.getByRole('heading', { name: 'Units still held' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Booked profit', exact: true })).toBeVisible();
  await expect(page.getByText('Switch out').first()).toBeVisible();
  await noSideways(page);

  // records: details, recorded values and the activity log
  await tabs.getByRole('link', { name: 'Records' }).click();
  await expect(page.getByRole('region', { name: 'Key facts' })).toContainText('Education fund');
  await expect(page.getByRole('region', { name: 'Recorded values' })).toContainText('Replaced');
  // how today's value is worked out: statement units apart from the SIP instalments since, each marked
  const how = page.getByRole('region', { name: 'How today’s value is worked out' });
  await expect(how).toContainText('Units confirmed by a fund statement');
  await expect(how).toContainText('SIP instalments since, not yet on a statement: 2');
  await expect(how).toContainText('Projected');
  await expect(how).toContainText('Partly projected');
  await expect(page.getByRole('region', { name: 'Activity log' })).toContainText(
    'Fund position updated',
  );
  await noSideways(page);
});

test('sample fund: the returns tab shows the periods, the benchmark, years, months, risk and rolling returns', async ({
  page,
}) => {
  await page.goto('/demo/asset?kind=fund&tab=returns');
  await expect(page.getByRole('heading', { name: 'Return over each period' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Benchmark', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Month by month' })).toBeVisible();
  await expect(page.getByRole('table', { name: /Return in each month/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fall from the highest price' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Risk' })).toBeVisible();
  await expect(page.getByText('Sharpe ratio')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Rolling returns' })).toBeVisible();
  await expect(page.getByText(/category average and the expense ratio/)).toBeVisible();
  // financial or calendar years
  await page.getByRole('link', { name: 'Calendar', exact: true }).click();
  await expect(page).toHaveURL(/heat=calendar/);
  await expect(page.getByRole('table', { name: /by calendar year/ })).toBeVisible();
  await noSideways(page);
});

test('sample fund: returns start with your first purchase and show your own money, with the whole history one click away', async ({
  page,
}) => {
  await page.goto('/demo/asset?kind=fund&tab=returns');
  const show = page.getByRole('navigation', { name: 'Show' });
  await expect(show.getByRole('link', { name: /^Since you invested/ })).toHaveAttribute(
    'aria-current',
    'true',
  );
  await expect(page.getByRole('heading', { name: 'Your money over each period' })).toBeVisible();
  const own = page.getByRole('table', { name: 'Your money in this fund over each period' });
  await expect(own.getByRole('rowheader', { name: /Since you started/ })).toBeVisible();
  await expect(own.getByRole('columnheader', { name: 'Your return' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'How your money grew' })).toBeVisible();
  await expect(
    page.getByText(/Benchmark: .*with every purchase and sale of yours made in it/),
  ).toBeVisible();
  await expect(page.getByText(/Your XIRR in this fund: .*% a year/)).toBeVisible();
  await expect(page.getByText(/while your money has been in it/)).toBeVisible();
  // the month grid covers only the months since the first purchase; the whole history has at least as many
  const months = page.getByRole('table', { name: /Return in each month/ }).locator('[aria-label]');
  const mineCount = await months.count();
  expect(mineCount).toBeGreaterThan(0);
  await show.getByRole('link', { name: 'The fund’s whole price history' }).click();
  await expect(page).toHaveURL(/scope=whole/);
  await expect(page.getByText(/including the years before you invested/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your money over each period' })).toHaveCount(0);
  expect(await months.count()).toBeGreaterThanOrEqual(mineCount);
  await noSideways(page);
});

test('sample fund: every transaction can be filtered, searched, sorted and exported', async ({
  page,
}) => {
  await page.goto('/demo/asset?kind=fund&tab=transactions');
  const lines = page.getByText(/of 56 lines/);
  await expect(lines).toBeVisible();
  await page.getByRole('button', { name: 'Sales', exact: true }).click();
  await expect(page.getByText(/^1 of 56 lines/)).toBeVisible();
  await expect(page.getByText('booked').first()).toBeVisible();
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByLabel('Year', { exact: true }).selectOption('2024-25');
  await expect(page.getByText(/of 56 lines/)).toBeVisible();
  await page.getByLabel('Year', { exact: true }).selectOption('all');
  await page.getByLabel('Search the transactions').fill('dividend');
  await expect(page.getByText(/^2 of 56 lines/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByLabel('Sort by').selectOption('amount');
  await expect(page.getByRole('columnheader', { name: /Amount/ })).toHaveAttribute(
    'aria-sort',
    /ascending|descending/,
  );
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^transactions-.*\.csv$/);
  await noSideways(page);
});

test('sample fund: the edit panel opens from the fund page', async ({ page }) => {
  await page.goto('/demo/asset?kind=fund');
  await page.getByRole('button', { name: 'Edit Sample Flexi Cap Fund' }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('heading', { name: 'Sample Flexi Cap Fund' })).toBeVisible();
  await panel.getByLabel(/SIP a month/).fill('30000');
  await expect(panel.getByText('Changed: SIP.')).toBeVisible();
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(panel.getByRole('status')).toContainText('nothing is saved');
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

test.describe('the dark headline of a holding’s page at 390 px (money words v6)', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(colorScheme, () => {
      test.use({ colorScheme });

      test('a fixed deposit: current value, profit with XIRR, and the six tiles', async ({
        page,
      }) => {
        await page.goto('/demo/asset');
        const panel = page.getByRole('region', { name: 'This deposit at a glance' });
        await expect(panel).toContainText('Current value');
        await expect(page.getByTestId('fd-profit')).toContainText(
          /\+₹[\d,]+ \(\+\d+\.\d% overall\) Profit \(interest earned\) · XIRR \d+\.\d\d% a year/,
        );
        await expect(page.getByTestId('fd-asof')).toContainText(
          'est. · 7.25% a year, interest added quarterly · NRE (tax-free)',
        );
        for (const label of [
          'Invested (principal)',
          'Maturity value',
          'Interest still to come',
          'Interest earned this FY',
          'Rate after tax',
          'Insured',
        ])
          await expect(panel).toContainText(label);
        await expect(page.getByTestId('fd-tile-invested')).toContainText('opened 12 Mar 2025');
        await expect(page.getByTestId('fd-tile-maturity')).toContainText(
          /12 Mar 2028 · in \d+ days/,
        );
        await expect(page.getByTestId('fd-tile-tocome')).toContainText(/earned so far/);
        await expect(page.getByTestId('fd-tile-aftertax')).toContainText('NRE: tax-free');
        // the light key facts stay below the panel
        await expect(page.getByRole('region', { name: 'Key facts' })).toBeVisible();
        await noSideways(page);
      });

      test('a savings account: current value, today’s change, balance, rate, interest and deposits', async ({
        page,
      }) => {
        await page.goto('/demo/asset?kind=savings');
        const panel = page.getByRole('region', { name: 'This account at a glance' });
        await expect(panel).toContainText('Current value');
        await expect(page.getByTestId('sv-today')).toContainText('Today’s change');
        await expect(page.getByTestId('sv-asof')).toContainText(
          /est\. · Balance ₹4,10,000 on 15 Oct 2026 \+ ₹[\d,]+ interest not yet credited/,
        );
        await expect(page.getByTestId('sv-tile-balance')).toContainText('bank figure, 15 Oct 2026');
        await expect(page.getByTestId('sv-tile-rate')).toContainText('after tax: NRE tax-free');
        await expect(page.getByTestId('sv-tile-fy')).toContainText('Interest earned this FY');
        await expect(page.getByTestId('sv-tile-deposits')).toContainText(
          /a year.*average deposit rate/s,
        );
        await expect(page.getByRole('region', { name: 'Key facts' })).toBeVisible();
        await noSideways(page);
      });

      test('a fund: current value, profit and today’s change, and its tiles', async ({ page }) => {
        await page.goto('/demo/asset?kind=fund');
        const panel = page.getByRole('region', { name: 'This fund at a glance' });
        await expect(page.getByTestId('fund-profit')).toContainText(/overall\) Profit/);
        await expect(page.getByTestId('fund-asof')).toContainText(/units × NAV ₹[\d,.]+/);
        for (const label of [
          'Invested',
          'Benchmark XIRR, same money',
          'Booked profit',
          'SIP status',
          'Long-term',
          'Fund return, 1Y',
          'Also on this page',
        ])
          await expect(panel).toContainText(label);
        await expect(page.getByTestId('fund-tile-invested')).toContainText('Average cost');
        await expect(page.getByTestId('fund-tile-return')).toContainText(
          'the fund’s NAV, not your return',
        );
        await expect(page.getByTestId('fund-tile-sip')).toContainText(
          /Running|Paused|Stopped|None/,
        );
        await noSideways(page);
      });
    });
  }
});

test('the detail pages need a sign-in', async ({ request }) => {
  const id = '00000000-0000-0000-0000-000000000001';
  for (const path of [`/asset/${id}`, `/bank/${id}`, `/tasks/${id}`, `/policy/${id}`]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toMatch(/\/login$/);
  }
});
