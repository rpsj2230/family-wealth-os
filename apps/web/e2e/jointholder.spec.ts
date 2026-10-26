import { expect, test } from '@playwright/test';

test.describe('joint holder and the order of names (sample)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/demo/accounts/edit');
    await expect(
      page.getByRole('heading', { name: 'Correct tags and details', level: 1 }),
    ).toBeVisible();
  });

  test('ticking Joint shows the second name; choosing it and swapping marks the row changed', async ({
    page,
  }) => {
    const save = page.getByRole('region', { name: 'Save' });
    await expect(save).toContainText('0 rows changed');
    // a joint account has no second-name control until Joint is ticked
    const firstJoint = page.getByLabel(/^Joint, /).first();
    await expect(firstJoint).not.toBeChecked();
    await expect(page.getByLabel(/^Joint with, /)).toHaveCount(0);
    await firstJoint.check();
    const withSel = page.getByLabel(/^Joint with, /).first();
    await expect(withSel).toBeVisible();
    // the swap needs a second name first
    await expect(page.getByRole('button', { name: /^Swap names/ }).first()).toBeDisabled();
    const options = await withSel.locator('option').allTextContents();
    expect(options[0]).toMatch(/not set/);
    await withSel.selectOption({ index: 1 });
    await expect(save).toContainText('1 row changed');
    // swapping turns "Anil & Beena" into "Beena & Anil": the person and the second name trade places
    const person = page.getByLabel(/^Person, /).first();
    const before = await person.inputValue();
    const partner = await withSel.inputValue();
    await page
      .getByRole('button', { name: /^Swap names/ })
      .first()
      .click();
    await expect(person).toHaveValue(partner);
    await expect(withSel).toHaveValue(before);
    await expect(page.locator('tr.aeg-changed')).toHaveCount(1);
    // unticking Joint clears the second name again and the row is back to unchanged
    await firstJoint.uncheck();
    await expect(page.getByLabel(/^Joint with, /)).toHaveCount(0);
  });

  test('nothing scrolls sideways with the second-name controls open', async ({ page }) => {
    await page
      .getByLabel(/^Joint, /)
      .first()
      .check();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
