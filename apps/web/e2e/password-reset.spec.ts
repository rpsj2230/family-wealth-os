import { expect, test } from '@playwright/test';

test.describe('Forgotten password', () => {
  test('the sign-in page links to it, and it asks for the email with nothing revealed', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page).toHaveURL(/\/login\/forgot$/);
    await expect(page.getByRole('heading', { name: 'Forgot your password?' })).toBeVisible();
    await expect(page.getByLabel('Email you sign in with')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Email me a link' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
    // the answer after sending is the same for every address
    await page.goto('/login/forgot?sent=1');
    await expect(page.getByTestId('reset-sent')).toContainText('If that address has a login');
    await page.goto('/login/forgot?error=expired');
    await expect(page.getByText('That link has expired or was already used')).toBeVisible();
  });

  test('a reset link without a valid token, and the new-password page without a session, go nowhere', async ({
    request,
  }) => {
    const confirm = await request.get('/login/reset/confirm?token_hash=nonsense&type=recovery', {
      maxRedirects: 0,
    });
    expect([302, 303, 307, 308]).toContain(confirm.status());
    expect(confirm.headers()['location']).toMatch(/\/login(\/forgot\?error=expired|\?error=setup)/);
    const fresh = await request.get('/login/reset/new', { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(fresh.status());
  });

  test('fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login/forgot');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
