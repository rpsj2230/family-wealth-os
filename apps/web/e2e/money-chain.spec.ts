import { expect, test } from '@playwright/test';

test.describe('Money trail step by step (public sample)', () => {
  test('a transaction shows where its money started, every step back, and where it went', async ({
    page,
  }) => {
    await page.goto('/demo/line');
    const chain = page.getByTestId('line-chain');
    await expect(chain.getByTestId('chain-starts')).toContainText('From Singapore (Wise or DBS)');
    await expect(chain.getByTestId('chain-starts')).toContainText('Wise transfer received');
    // back: the transfer between the two accounts, then the money from Singapore it was made of
    const back = chain.getByTestId('chain-back');
    await expect(back).toContainText('Transfer from');
    await expect(back).toContainText('Started here: From Singapore (Wise or DBS)');
    // the way most of the money went, as a row of holdings
    await expect(
      chain.getByRole('list', { name: 'The way most of the money went' }).first(),
    ).toBeVisible();
    // forward: the deposit it booked and the part still in the account
    await expect(chain.getByTestId('chain-ends')).toContainText('Still in');
    await expect(chain.getByTestId('chain-forward')).toContainText('Booked');
    // every step opens its own page
    await back.getByRole('link').first().click();
    await expect(page.getByTestId('line-chain')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });

  test('a deposit shows the money that booked it, step by step back to Singapore', async ({
    page,
  }) => {
    await page.goto('/demo/trail');
    // how complete the trail is, for all of today's money
    const cov = page.getByTestId('chain-coverage');
    await expect(cov).toContainText('Traced back to where it started');
    await expect(cov.getByTestId('chain-starts')).toContainText('From Singapore (Wise or DBS)');
    await expect(cov.getByTestId('chain-where')).toContainText('In deposits');
    const one = page.getByTestId('tr-one');
    const chain = one.getByTestId('holding-chain');
    await expect(chain).toContainText('that booked it came from');
    await expect(chain.getByTestId('chain-starts')).toContainText('From Singapore (Wise or DBS)');
    await expect(chain.getByTestId('chain-back')).toContainText('Booked');
    await expect(chain.getByTestId('chain-back')).toContainText('Transfer from');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });

  test('Settings has the trail’s order, smallest part and steps', async ({ page }) => {
    await page.goto('/demo/settings?tab=rules#trail');
    const card = page.locator('#trail');
    await expect(card).toContainText('money leaving an account is the latest money that came in');
    await expect(card).toContainText('fold parts smaller than');
    await expect(card).toContainText('steps shown back or forward');
  });
});
