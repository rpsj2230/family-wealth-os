import { expect, test, type Page } from '@playwright/test';

const noSideways = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

const tabs = (page: Page) => page.getByRole('navigation', { name: 'Sections' });

test('the investments pages need a sign-in', async ({ request }) => {
  for (const path of [
    '/investments',
    '/investments?tab=performance',
    '/investments?tab=transactions',
    '/investments?tab=growth',
  ]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([307, 308]).toContain(res.status());
    expect(res.headers()['location']).toMatch(/\/login$/);
  }
});

test.describe('Investments (public sample)', () => {
  test('overview: the headline, goals, movers, instalments and the people side by side', async ({
    page,
  }) => {
    await page.goto('/demo/investments');
    await expect(page.getByRole('heading', { name: 'Investments', level: 1 })).toBeVisible();
    const hero = page.getByRole('region', { name: 'Mutual funds at a glance' });
    for (const label of [
      'Current value of mutual funds',
      'Amount invested now',
      'Profit on amount invested now',
      'Yearly return on amount invested (XIRR)',
      'Profit booked by selling',
      'SIP a month',
      'Long-term share',
    ])
      await expect(hero).toContainText(label);
    await expect(hero).toContainText('Maturity value: not applicable');
    await expect(hero.getByRole('img', { name: /is the money put in/ })).toBeVisible();
    await expect(tabs(page).getByRole('link')).toHaveCount(8);
    await expect(page.getByRole('heading', { name: 'Value and money put in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Return over time' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Goal by goal' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Value by goal' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Movers' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Next monthly investments' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Person against person' })).toBeVisible();
    await noSideways(page);
  });

  test('performance: periods against the benchmark, profit and loss by period, month grid, risk', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=performance');
    await expect(page.getByText('Time-weighted return', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Return over time' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Benchmark \(proxy\)/ })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Return over each period' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Profit and loss by period' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Profit or loss by month' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Month by month' })).toBeVisible();
    await expect(page.getByRole('table', { name: /Return in each month/ })).toBeVisible();
    await expect(page.getByText('Best month')).toBeVisible();
    await expect(page.getByText('Worst month')).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Growth of 100 against the benchmark' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fall from the highest point' })).toBeVisible();
    await expect(page.getByText('Sharpe ratio')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Rolling returns' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'The same money in the index fund' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Value and money put in' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'If you carry on like this' })).toBeVisible();
    await noSideways(page);
  });

  test('performance: profit and loss by week, quarter, financial year and year, and the comparisons', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=performance');
    const by = page.getByRole('navigation', { name: 'By' });
    const compare = page.getByRole('navigation', { name: 'Compare' });
    await by.getByRole('link', { name: 'Week', exact: true }).click();
    await expect(page).toHaveURL(/by=week/);
    await expect(page.getByRole('img', { name: 'Profit or loss by week' })).toBeVisible();
    await by.getByRole('link', { name: 'Quarter' }).click();
    await expect(page).toHaveURL(/by=quarter/);
    await expect(page.getByRole('cell', { name: /^Q2 FY 2026-27/ })).toBeVisible();
    await by.getByRole('link', { name: 'Financial year' }).click();
    await expect(page).toHaveURL(/by=fy/);
    await expect(page.getByRole('cell', { name: 'FY 2025-26', exact: true })).toBeVisible();
    await by.getByRole('link', { name: 'Calendar year' }).click();
    await expect(page).toHaveURL(/by=year/);
    await expect(page.getByRole('cell', { name: '2025', exact: true })).toBeVisible();
    await by.getByRole('link', { name: 'Month', exact: true }).click();
    await expect(page.getByRole('cell', { name: /^Oct 2026/ })).toBeVisible();

    await compare.getByRole('link', { name: /one before/ }).click();
    await expect(page).toHaveURL(/compare=prev/);
    await expect(page.getByLabel('This period against the one before')).toContainText('Difference');
    await compare.getByRole('link', { name: 'Person against person' }).click();
    await expect(page.getByRole('columnheader', { name: /Anil/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Beena/ })).toBeVisible();
    await compare.getByRole('link', { name: 'Fund against fund' }).click();
    await expect(page.getByRole('columnheader', { name: /Sample Flexi Cap Fund/ })).toBeVisible();
    await noSideways(page);
  });

  test('performance: the month grid switches between financial and calendar years, and the range changes the value graph', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=performance');
    await expect(page.getByRole('table', { name: /by financial year/ })).toBeVisible();
    await page.getByRole('link', { name: 'Calendar', exact: true }).click();
    await expect(page).toHaveURL(/heat=calendar/);
    await expect(page.getByRole('table', { name: /by calendar year/ })).toBeVisible();
    const range = page.getByRole('navigation', { name: 'Time range' });
    await range.getByRole('link', { name: '6M' }).click();
    await expect(page).toHaveURL(/range=6m/);
    await expect(page).toHaveURL(/heat=calendar/);
    await expect(page.getByText('Change in the last 6 months')).toBeVisible();
    await noSideways(page);
  });

  test('performance: the chart reads out values with the arrow keys and offers a table', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=performance&range=1y');
    const chart = page.getByRole('img', {
      name: /Value of mutual funds against the money put in/,
    });
    await chart.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.plot-tip').first()).toContainText('Value');
    await page.getByText('Show the figures as a table').first().click();
    await expect(page.getByRole('table').first()).toBeVisible();
  });

  test('the old Growth address opens Performance', async ({ page }) => {
    await page.goto('/demo/investments?tab=growth');
    await expect(tabs(page).getByRole('link', { name: 'Performance' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('funds: one compact line each, grouped, with totals, search and sort', async ({
    page,
  }, info) => {
    await page.goto('/demo/investments?tab=funds');
    const link = page.getByRole('link', { name: 'Sample Flexi Cap Fund' }).first();
    await expect(link).toBeVisible();
    await expect(page.getByText('Anil', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('All funds shown')).toBeVisible();
    await expect(page.getByText('No live price').first()).toBeVisible();
    await expect(page.getByText(/average cost|avg ₹/).first()).toBeVisible();
    // a row is one compact line on a wide screen
    if ((page.viewportSize()?.width ?? 0) >= 1100 && info.project.name === 'desktop') {
      const row = page.locator('tr.fl-row').first();
      const box = await row.boundingBox();
      expect(box!.height).toBeLessThanOrEqual(60);
    }
    await page.getByLabel('Search this list').fill('small cap');
    await expect(page.locator('tr.fl-row')).toHaveCount(1);
    await page.getByLabel('Search this list').fill('');
    await page.getByLabel('Sort by').selectOption('xirr');
    await expect(page.locator('tr.fl-row').first()).toBeVisible();
    await noSideways(page);
  });

  test('funds: group by goal, kind of fund and fund house, with the goal summary', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=funds');
    const group = page.getByRole('navigation', { name: 'Group by' });
    await group.getByRole('link', { name: 'Goal' }).click();
    await expect(page).toHaveURL(/group=goal/);
    await expect(page.getByRole('heading', { name: 'Goal by goal' })).toBeVisible();
    await expect(page.getByText('Education fund').first()).toBeVisible();
    await expect(page.getByText('No goal').first()).toBeVisible();
    await group.getByRole('link', { name: 'Kind of fund' }).click();
    await expect(page.getByText('Small cap').first()).toBeVisible();
    await group.getByRole('link', { name: 'Fund house' }).click();
    await expect(page.getByText('Fund house not known')).toBeVisible();
    await group.getByRole('link', { name: 'No grouping' }).click();
    await expect(page.locator('tr.fl-row')).toHaveCount(8);
    await noSideways(page);
  });

  test('funds: the person filter keeps the tab and the grouping', async ({ page }) => {
    await page.goto('/demo/investments?tab=funds&group=kind');
    await page
      .getByRole('link', { name: /^Beena/ })
      .first()
      .click();
    await expect(page).toHaveURL(/p=p2/);
    await expect(page).toHaveURL(/tab=funds/);
    await expect(page).toHaveURL(/group=kind/);
    await expect(page.getByRole('link', { name: 'Sample Index Fund' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sample Flexi Cap Fund' })).toHaveCount(0);
  });

  test('editing a fund from its row opens the side panel, with instant feedback', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=funds');
    await page.getByRole('button', { name: 'Edit Sample Flexi Cap Fund' }).click();
    const panel = page.getByRole('dialog');
    await expect(panel.getByRole('heading', { name: 'Sample Flexi Cap Fund' })).toBeVisible();
    await expect(panel.getByRole('status')).toContainText('No changes yet');
    await panel.getByLabel('Units held').fill('11000');
    await expect(panel.getByText(/Worth ₹/)).toBeVisible();
    await panel.getByLabel(/SIP a month/).fill('30000');
    await panel.getByLabel('Goal').selectOption({ label: 'No goal' });
    await expect(panel.getByRole('status')).toContainText('Changed: units, SIP, goal.');
    // a wrong value is explained, and nothing can be saved until it is fixed
    await panel.getByLabel(/Amount invested/).fill('lots');
    await expect(panel.getByRole('alert')).toContainText('amount invested');
    await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await panel.getByLabel(/Amount invested/).fill('1646495');
    await panel.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('nothing is saved');
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('add a fund and add a transaction open as side panels and check what was typed', async ({
    page,
  }) => {
    await page.goto('/demo/investments');
    await page.getByRole('button', { name: 'Add a fund' }).click();
    const panel = page.getByRole('dialog');
    await expect(panel.getByRole('heading', { name: 'Add a fund' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Add the fund' })).toBeDisabled();
    await panel.getByLabel('Fund name').fill('Sample New Fund');
    await panel.getByLabel('Whose').selectOption({ label: 'Anil' });
    await panel.getByLabel(/Amount invested/).fill('50000');
    await panel.getByLabel(/Value now/).fill('52000');
    await panel.getByRole('button', { name: 'Add the fund' }).click();
    await expect(panel.getByRole('status')).toContainText('nothing is saved');
    await panel.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: 'Add a transaction' }).click();
    const txn = page.getByRole('dialog');
    await expect(txn.getByRole('heading', { name: 'Add a transaction' })).toBeVisible();
    await txn.getByLabel('Fund').selectOption({ label: 'Sample Flexi Cap Fund (Anil)' });
    await txn
      .getByLabel(/Amount/)
      .first()
      .fill('5000');
    await expect(txn.getByRole('alert')).toContainText('units or the price per unit');
    await txn.getByLabel(/Price per unit/).fill('241.08');
    await txn.getByRole('button', { name: 'Add the transaction' }).click();
    await expect(txn.getByRole('status')).toContainText('nothing is saved');
  });

  test('transactions: every line of every fund, filtered, searched and exported', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=transactions');
    await expect(page.getByText(/of \d+ lines/)).toBeVisible();
    await expect(page.getByText('Switch out').first()).toBeVisible();
    await page.getByRole('button', { name: 'Sales', exact: true }).click();
    await expect(page.getByText('booked').first()).toBeVisible();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('Search the transactions').fill('Index Fund');
    await expect(page.getByText(/^\d+ of \d+ lines/)).toBeVisible();
    await page.getByLabel('Year').selectOption('2025-26');
    await expect(page.getByText(/^\d+ of \d+ lines/)).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    expect((await download).suggestedFilename()).toMatch(/^transactions-.*\.csv$/);
    await noSideways(page);
  });

  test('transactions: a long ledger shows a page at a time', async ({ page }) => {
    await page.goto('/demo/investments?tab=transactions');
    await expect(page.getByRole('button', { name: /^Show \d+ more/ })).toBeVisible();
    await page.getByRole('button', { name: /^Show \d+ more/ }).click();
    await noSideways(page);
  });

  test('breakdown: people side by side, kinds, houses, plans, age of the units, gains and SIPs', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=breakdown');
    await expect(page.getByRole('heading', { name: 'By person' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Last 1Y' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Key figures' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By kind of fund' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By fund house' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By fund', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Direct and Regular plans' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'How old the units are' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Gain or loss on each fund' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'How much is long-term already' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Monthly investments (SIP)' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Gains already booked by selling' }),
    ).toBeVisible();
    await expect(page.getByRole('cell', { name: /2026-27/ })).toBeVisible();
    await noSideways(page);
  });

  test('breakdown for one person drops the person table and keeps the colours', async ({
    page,
  }) => {
    await page.goto('/demo/investments?tab=breakdown&p=p2');
    await expect(page.getByRole('heading', { name: 'By person' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Key figures' })).toBeVisible();
    await noSideways(page);
  });

  test('update funds: the monthly grid and the transaction form', async ({ page }) => {
    await page.goto('/demo/investments?tab=update');
    await expect(page.getByRole('button', { name: 'Save fund figures' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a transaction' })).toBeVisible();
    await page.getByLabel('Sample Flexi Cap Fund units').fill('1000');
    await page.getByRole('button', { name: 'Save fund figures' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'nothing is saved' })).toBeVisible();
    await noSideways(page);
  });

  test('match funds: what to check first, what is matched, and confirming', async ({ page }) => {
    await page.goto('/demo/investments?tab=match');
    await expect(page.getByRole('heading', { name: /Funds without a price/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Matched/ })).toBeVisible();
    const hybrid = page.getByRole('form', { name: 'Decision: Sample Hybrid Fund' });
    await expect(hybrid).toContainText('Sample Hybrid Fund');
    await hybrid.getByRole('button', { name: /^Approve: use Sample Hybrid Fund/ }).click();
    await expect(page.getByRole('status').filter({ hasText: 'nothing is saved' })).toBeVisible();
    await noSideways(page);
  });

  test('a person filter keeps the tab and narrows the funds', async ({ page }) => {
    await page.goto('/demo/investments?tab=performance');
    await page
      .getByRole('link', { name: /^Beena/ })
      .first()
      .click();
    await expect(page).toHaveURL(/tab=performance/);
    await expect(page).toHaveURL(/p=p2/);
    await expect(page.getByRole('heading', { name: 'Value by person' })).toHaveCount(0);
  });

  test('fund links open the sample fund page of that fund', async ({ page }) => {
    await page.goto('/demo/investments?tab=funds');
    await page.getByRole('link', { name: 'Sample Index Fund' }).first().click();
    await expect(page).toHaveURL(/id=f3/);
    await expect(page.getByRole('heading', { name: 'Sample Index Fund', level: 1 })).toBeVisible();
  });
});
