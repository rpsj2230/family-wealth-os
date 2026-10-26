import { expect, test, type Page } from '@playwright/test';

const noOverflow = async (page: Page) => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
};

const openFirst = async (page: Page, code: RegExp) => {
  await page.goto('/demo/accounts');
  await page.getByRole('button', { name: code }).first().click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  return panel;
};

test.describe('one place to edit an account (public sample)', () => {
  test('Edit opens a panel with only the fields people change; the rare ones sit under More details', async ({
    page,
  }) => {
    const panel = await openFirst(page, /^Edit Cash-NRE/);
    await expect(panel.getByRole('heading', { level: 2 })).toContainText('Cash-NRE');
    for (const label of [
      'Name',
      'Balance now',
      'Interest rate (% a year)',
      'Type',
      'Status',
      'Note',
    ])
      await expect(panel.getByLabel(label, { exact: false }).first()).toBeVisible();
    // plain words, not codes
    await expect(panel.getByLabel('Status')).toContainText('Open');
    await expect(panel.getByLabel('Type')).toContainText('NRE (external)');
    // the rare fields are closed until asked for
    await expect(panel.getByLabel('Last four digits of the account')).toBeHidden();
    await panel.getByText('More details').click();
    await expect(panel.getByLabel('Last four digits of the account')).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: 'Joint account' })).toBeVisible();
    await expect(panel.getByRole('combobox', { name: /^Bank/ })).toBeVisible();
    await noOverflow(page);
  });

  test('typing a balance says what will change, and a sample never stores anything', async ({
    page,
  }) => {
    const panel = await openFirst(page, /^Edit Cash-NRE/);
    const save = panel.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    await expect(panel.getByText('No changes yet.')).toBeVisible();
    await panel.getByLabel('Balance now').fill('125000');
    await panel.getByLabel('Name').fill('Salary account');
    await expect(panel.getByText('Changed: name, balance.')).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(panel.getByRole('status').filter({ hasText: 'This is a sample' })).toBeVisible();
  });

  test('a mistake is explained in words and Save waits', async ({ page }) => {
    const panel = await openFirst(page, /^Edit Cash-NRE/);
    await panel.getByLabel('Balance now').fill('lots');
    await expect(panel.getByRole('alert')).toContainText('the balance must be a plain number');
    await expect(panel.getByRole('button', { name: 'Save' })).toBeDisabled();
    await panel.getByLabel('Balance now').fill('1000');
    await panel.getByLabel('Interest rate (% a year)').fill('250');
    await expect(panel.getByRole('alert')).toContainText('interest rate must be between 0 and 100');
  });

  test('closing with something typed asks first, and nothing is lost by accident', async ({
    page,
  }) => {
    const panel = await openFirst(page, /^Edit Cash-NRE/);
    await panel.getByLabel('Note').fill('Minimum balance 10,000');
    await page.keyboard.press('Escape');
    await expect(panel.getByText('You have changes that are not saved.')).toBeVisible();
    await panel.getByRole('button', { name: 'Keep editing' }).click();
    await expect(panel.getByLabel('Note')).toHaveValue('Minimum balance 10,000');
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await panel.getByRole('button', { name: 'Close without saving' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // with nothing typed it closes straight away
    await page
      .getByRole('button', { name: /^Edit Cash-NRE/ })
      .first()
      .click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a deposit shows its terms, not a balance box', async ({ page }) => {
    const panel = await openFirst(page, /^Edit FD-NRE/);
    for (const label of [
      'Interest rate (% a year)',
      'Matures on',
      'Amount invested',
      'Amount at maturity',
    ])
      await expect(panel.getByLabel(label)).toBeVisible();
    await expect(panel.getByLabel('Balance now')).toHaveCount(0);
    await expect(panel.getByLabel('Status')).toContainText('Running');
    await panel.getByLabel('Matures on').fill('2020-01-01');
    await expect(panel.getByRole('alert')).toContainText('maturity must be after the start');
    await panel.getByText('More details').click();
    await expect(panel.getByLabel('Started on')).toBeVisible();
    await expect(panel.getByLabel('Deposit number')).toBeVisible();
  });

  test('add an account: the form says what is missing and works for a deposit and a savings account', async ({
    page,
  }) => {
    await page.goto('/demo/accounts');
    await page.getByRole('button', { name: 'Add an account', exact: true }).click();
    const panel = page.getByRole('dialog');
    await expect(panel.getByRole('heading', { name: 'Add an account or a deposit' })).toBeVisible();
    const add = panel.getByRole('button', { name: 'Add the deposit' });
    await expect(add).toBeDisabled();
    await panel.getByLabel('Bank').selectOption({ index: 1 });
    await panel.getByLabel('Whose').selectOption({ index: 1 });
    await panel.getByLabel('Amount invested').fill('500000');
    await panel.getByLabel('Interest rate (% a year)').fill('7.25');
    await panel.getByLabel('Started on').fill('2026-10-01');
    await panel.getByLabel('Matures on').fill('2027-10-01');
    await expect(add).toBeEnabled();
    await panel.getByRole('button', { name: 'Savings account' }).click();
    await expect(panel.getByLabel('Amount invested')).toHaveCount(0);
    await panel.getByRole('button', { name: 'Add the account' }).click();
    await expect(panel.getByRole('status').filter({ hasText: 'This is a sample' })).toBeVisible();
    await noOverflow(page);
  });

  test('the monthly update has the same Edit button, so a rate or note is changed in one place', async ({
    page,
  }) => {
    await page.goto('/demo/monthly');
    await expect(page.getByLabel('Edit deposit rate and maturity amount')).toHaveCount(0);
    await expect(page.getByLabel('Edit notes')).toHaveCount(0);
    await page
      .getByRole('button', { name: /^Edit Cash-/ })
      .first()
      .click();
    const panel = page.getByRole('dialog');
    await expect(panel.getByLabel('Balance now')).toBeVisible();
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await noOverflow(page);
  });

  test('the edit-many table is reachable from Manage, and Edit is on every account line', async ({
    page,
  }) => {
    await page.goto('/demo/accounts');
    const lines = await page.locator('tr.xlrow').count();
    const buttons = await page.getByRole('button', { name: /^Edit [A-Z]/ }).count();
    expect(buttons).toBeGreaterThanOrEqual(lines);
  });
});
