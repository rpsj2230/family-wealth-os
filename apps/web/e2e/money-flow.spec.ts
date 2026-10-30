import { expect, test } from '@playwright/test';

const noSideways = async (page: import('@playwright/test').Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

test.describe('Money trail as a flow diagram (public sample)', () => {
  test('the details stay the first tab; the diagram shows where money started and where it is, and adds up', async ({
    page,
  }) => {
    await page.goto('/demo/trail');
    await expect(page.getByTestId('tr-one')).toBeVisible();
    await page.getByRole('link', { name: 'Flow diagram' }).click();
    const tab = page.getByTestId('flow-tab');
    await expect(tab.getByTestId('flow-diagram')).toBeVisible();
    await expect(tab.getByRole('button', { name: /^Singapore \(Wise or DBS\)/ })).toBeVisible();
    // the totals check against the money trail
    const checks = tab.getByTestId('flow-checks');
    await expect(checks).toContainText('Money in at the start equals money at the end');
    await expect(checks).toContainText(
      'Money still held equals the trail’s total of today’s money',
    );
    await expect(checks.locator('.fail')).toHaveCount(0);
    // legend: verified, matched and missing connections
    const legend = tab.getByTestId('flow-legend');
    await expect(legend).toContainText('Verified');
    await expect(legend).toContainText('Matched by amount and date');
    await expect(legend).toContainText('Missing or unverified');
    // every flow as a table
    await tab.getByText('See every flow as a table').click();
    await expect(tab.locator('.fl-table tbody tr').first()).toBeVisible();
    // tap a box: its figures and where to go next
    await tab.getByRole('button', { name: /^Singapore \(Wise or DBS\)/ }).click();
    const picked = tab.getByTestId('flow-picked');
    await expect(picked).toContainText('Singapore (Wise or DBS)');
    await expect(picked.getByRole('link', { name: 'Follow this money' })).toBeVisible();
    await expect(tab.getByRole('button', { name: 'Zoom in' })).toBeVisible();
    await expect(tab.getByTestId('flow-fit')).toBeVisible();
    await noSideways(page);
  });

  test('follow one source through the movements, and open a holding’s journey', async ({
    page,
  }) => {
    await page.goto('/demo/trail?tab=flow&view=movements&src=singapore');
    const tab = page.getByTestId('flow-tab');
    await expect(tab.getByTestId('flow-diagram')).toBeVisible();
    await expect(tab).toContainText('Money moved from');
    // a deposit's journey: back to Singapore through the two accounts
    await page.goto('/demo/trail?tab=flow&view=journey');
    await expect(page.getByTestId('flow-choose')).toBeVisible();
    const select = page.getByTestId('flow-filters').getByLabel('Holding');
    const options = await select.locator('option').allTextContents();
    const dep = options.find((o) => o.includes('FD'))!;
    await select.selectOption({ label: dep });
    await page.getByTestId('flow-filters').getByRole('button', { name: 'Show' }).click();
    const diagram = page.getByTestId('flow-diagram');
    await expect(diagram.getByRole('button', { name: /^Singapore \(Wise or DBS\)/ })).toBeVisible();
    await expect(diagram.getByRole('button', { name: /FD/ }).first()).toBeVisible();
    await noSideways(page);
  });

  test('the tree follows money from Singapore forward through every account to where it is', async ({
    page,
  }) => {
    await page.goto('/demo/trail?tab=tree');
    const tree = page.getByTestId('flow-tree');
    await expect(tree.getByTestId('flow-tree-title')).toContainText('Singapore (Wise or DBS)');
    const fwd = tree.getByTestId('flow-tree-forward');
    await expect(fwd).toContainText('Transfer from');
    await expect(fwd).toContainText('Booked');
    await expect(fwd).toContainText('Still in');
    await noSideways(page);
  });

  for (const scheme of ['light', 'dark'] as const)
    test(`fits a 390 px screen in ${scheme}`, async ({ browser }) => {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        colorScheme: scheme,
      });
      for (const url of [
        '/demo/trail?tab=flow',
        '/demo/trail?tab=flow&view=movements',
        '/demo/trail?tab=tree',
      ]) {
        await page.goto(url);
        await noSideways(page);
      }
      await page.close();
    });
});
