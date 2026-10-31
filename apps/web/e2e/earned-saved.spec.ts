import { expect, test } from '@playwright/test';

test.describe('Earned and saved (public sample)', () => {
  test('every financial year on one table with a total, and the chosen year by month', async ({
    page,
  }) => {
    await page.goto('/demo/earned-saved');
    await expect(page.getByRole('heading', { name: 'Earned and saved', level: 1 })).toBeVisible();
    const years = page.getByTestId('es-years');
    await expect(years.getByRole('columnheader', { name: 'Year' })).toBeVisible();
    await expect(years.getByRole('columnheader', { name: 'Earned' })).toBeVisible();
    await expect(years.getByRole('columnheader', { name: 'Saved' })).toBeVisible();
    await expect(page.getByTestId('es-years-total')).toContainText('Total');
    await expect(page.getByTestId('es-earned-total')).toBeVisible();
    await expect(page.getByTestId('es-saved-total')).toBeVisible();
    await expect(page.getByTestId('es-check')).toContainText('earned');
  });

  test('Home’s Earned this FY opens it', async ({ page }) => {
    await page.goto('/demo/dashboard');
    await page.getByTestId('hl-earned-fy').getByRole('link').click();
    await expect(page).toHaveURL(/\/demo\/earned-saved/);
  });

  test('fits the screen: only the tables scroll sideways', async ({ page }) => {
    await page.goto('/demo/earned-saved');
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(wide).toBe(false);
  });
});
