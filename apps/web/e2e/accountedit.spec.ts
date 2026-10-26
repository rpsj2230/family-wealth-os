import { expect, test } from '@playwright/test';

test.describe('correct tags and details (sample)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/accounts/edit');
    await expect(
      page.getByRole('heading', { name: 'Correct tags and details', level: 1 }),
    ).toBeVisible();
  });

  test('changing a type marks the row and counts it in the save bar', async ({ page }) => {
    const save = page.getByRole('region', { name: 'Save' });
    await expect(save).toContainText('0 rows changed');
    const type = page.getByLabel(/^Type, /).first();
    const current = await type.inputValue();
    const next = current === 'FCNR' ? 'SB' : 'FCNR';
    await type.selectOption(next);
    await expect(save).toContainText('1 row changed');
    await expect(page.getByText('changed', { exact: true }).first()).toBeAttached();
    await expect(page.locator('tr.aeg-changed')).toHaveCount(1);
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(save).toContainText('0 rows changed');
    await expect(type).toHaveValue(current);
  });

  test('bulk: tick rows and set the type to NRE', async ({ page }) => {
    const boxes = page.getByLabel(/^Select (?!all)/);
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(page.getByText('2 selected')).toBeVisible();
    await page.getByRole('button', { name: 'NRO', exact: true }).click();
    await page.getByRole('button', { name: 'NRE', exact: true }).click();
    const types = page.getByLabel(/^Type, /);
    await expect(types.nth(0)).toHaveValue('NRE');
    await expect(types.nth(1)).toHaveValue('NRE');
    // a row whose stored type was already NRE does not count as changed
    const changed = await page.locator('tr.aeg-changed').count();
    await expect(page.getByRole('region', { name: 'Save' })).toContainText(`${changed} row`);
  });

  test('suggesting types highlights proposed rows and saves nothing', async ({ page }) => {
    // the sample's deposits carry no type, so each can take the type of its person's savings account at that bank
    await expect(page.locator('tr.aeg-proposed')).toHaveCount(0);
    await page.getByRole('button', { name: 'Suggest types for empty rows' }).click();
    const proposed = page.locator('tr.aeg-proposed');
    expect(await proposed.count()).toBeGreaterThan(0);
    const save = page.getByRole('region', { name: 'Save' });
    await expect(save).toContainText('suggested');
    // a suggestion is only a draft: the sample reports that nothing is stored when Save is pressed
    await page.getByRole('button', { name: 'Save all' }).click();
    await expect(save).toContainText('sample');
    // and Discard takes the suggestions away
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page.locator('tr.aeg-proposed')).toHaveCount(0);
    await expect(save).toContainText('0 rows changed');
  });

  test('only the grid scrolls sideways, never the page', async ({ page }) => {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(
      page.getByRole('region', { name: /accounts, scrolls sideways/ }).first(),
    ).toBeVisible();
  });
});
