import { expect, test, type Page } from '@playwright/test';

const noOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

test.describe('Reports (public sample)', () => {
  test('deposit summaries: maturity and start by date, with a grand total, and the group-by switches work', async ({
    page,
  }) => {
    await page.goto('/demo/reports');
    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Deposits at a glance' })).toContainText(
      'Invested (principal)',
    );
    const maturity = page.getByRole('table', { name: 'Maturity summary' });
    await expect(maturity.getByRole('columnheader', { name: 'Maturity date' })).toBeVisible();
    await expect(maturity.getByRole('row', { name: /1 Nov 2026/ })).toContainText('15,00,000');
    await expect(maturity.getByRole('rowheader').first()).toContainText('Grand total');
    // the same deposits by financial year
    await page
      .getByRole('navigation', { name: 'Group maturities by' })
      .getByRole('link', { name: 'Financial year' })
      .click();
    await expect(
      page.getByRole('table', { name: 'Maturity summary' }).getByText('FY 2026-27'),
    ).toBeVisible();
    // the start summary has its own switch
    await expect(
      page
        .getByRole('table', { name: 'Start summary' })
        .getByRole('columnheader', { name: 'Start date' }),
    ).toBeVisible();
    // by person
    await page
      .getByRole('navigation', { name: 'Group deposits by' })
      .getByRole('link', { name: 'Person' })
      .click();
    const by = page.getByRole('table', { name: /Deposits by person/ });
    await expect(by.getByRole('row', { name: /Anil/ })).toBeVisible();
    await expect(by.getByRole('row', { name: /Beena/ })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Interest by financial year' })).toBeVisible();
    await noOverflow(page);
  });

  test('mutual fund summaries: by fund and person, SIP, money in and out, how long units are held', async ({
    page,
  }) => {
    await page.goto('/demo/reports?tab=funds');
    await expect(page.getByRole('region', { name: 'Mutual funds at a glance' })).toContainText(
      'Current value',
    );
    await expect(
      page
        .getByRole('table', { name: /Funds by fund/ })
        .getByRole('rowheader')
        .first(),
    ).toContainText('Grand total');
    await page
      .getByRole('navigation', { name: 'Group funds by' })
      .getByRole('link', { name: 'Person' })
      .click();
    await expect(
      page.getByRole('table', { name: /Funds by person/ }).getByRole('row', { name: /Anil/ }),
    ).toBeVisible();
    await expect(page.getByRole('table', { name: 'SIP summary' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Money in and out' })).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'How long the units have been held' }),
    ).toBeVisible();
    await noOverflow(page);
  });

  test('funds can be grouped by goal, with a total per goal and a "No goal" group', async ({
    page,
  }) => {
    await page.goto('/demo/reports?tab=funds');
    const group = page.getByRole('navigation', { name: 'Group funds by' });
    await expect(group.getByRole('link')).toHaveText([
      'Fund',
      'Person',
      'Kind of fund',
      'Fund house',
      'Goal',
      'Start date',
    ]);
    await group.getByRole('link', { name: 'Goal', exact: true }).click();
    await expect(page).toHaveURL(/fb=goal/);
    const table = page.getByRole('table', { name: /Funds by goal/ });
    await expect(table.getByRole('row', { name: /Education fund/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /No goal/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /Grand total/ })).toBeVisible();
    await noOverflow(page);
  });

  test('each report downloads as a CSV file', async ({ page }) => {
    await page.goto('/demo/reports');
    const download = page.waitForEvent('download');
    await page
      .getByRole('region', { name: 'Maturity summary' })
      .getByRole('button', { name: 'Download CSV' })
      .click();
    expect((await download).suggestedFilename()).toBe('fd-maturity.csv');
  });
});
