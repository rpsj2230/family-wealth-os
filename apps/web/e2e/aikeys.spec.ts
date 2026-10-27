import { expect, test, type Locator, type Page } from '@playwright/test';

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const URL = '/demo/settings?tab=connections';
const item = (page: Page, name: string): Locator =>
  page.getByRole('list', { name: 'AI keys' }).getByRole('listitem').filter({ hasText: name });
const order = async (page: Page) =>
  page
    .getByRole('list', { name: 'AI keys' })
    .getByRole('listitem')
    .evaluateAll((els) => els.map((e) => e.querySelector('strong')?.textContent ?? ''));

test.describe('AI keys in Settings (public sample)', () => {
  test('lists the keys in the order they are tried, with their role and status', async ({
    page,
  }) => {
    await page.goto(URL);
    await expect(page.getByRole('heading', { name: 'AI keys', level: 4 })).toBeVisible();
    await expect(page.getByText('2 AI keys on')).toBeVisible();
    await expect(page.getByText(/How the order works/)).toBeVisible();
    expect(await order(page)).toEqual([
      'Anthropic (Claude Haiku)',
      'OpenRouter (free models)',
      'Groq',
    ]);
    await expect(item(page, 'Anthropic').getByText('First choice')).toBeVisible();
    await expect(item(page, 'OpenRouter').getByText('Fallback 2')).toBeVisible();
    await expect(item(page, 'Groq').getByText('Switched off')).toBeVisible();
    await expect(item(page, 'Anthropic').getByText(/Last failed .*no credit left/)).toBeVisible();
    await expect(item(page, 'OpenRouter').getByText(/Last used OK .*llama-3.3-70b/)).toBeVisible();
    await expect(item(page, 'Groq').getByText('Not used yet')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('a key can be switched off and on again; the first choice follows', async ({ page }) => {
    await page.goto(URL);
    const first = item(page, 'Anthropic').getByRole('switch', {
      name: 'Use the Anthropic (Claude Haiku) key',
    });
    await expect(first).toHaveAttribute('aria-checked', 'true');
    await first.click();
    await expect(first).toHaveAttribute('aria-checked', 'false');
    await expect(item(page, 'Anthropic').getByText('Switched off')).toBeVisible();
    await expect(item(page, 'OpenRouter').getByText('First choice')).toBeVisible();
    await expect(page.getByText('1 AI key on')).toBeVisible();
    await expect(page.getByText(/Switched off\. The key is kept but not used/)).toBeVisible();
    await first.click();
    await expect(first).toHaveAttribute('aria-checked', 'true');
    await expect(item(page, 'Anthropic').getByText('First choice')).toBeVisible();
  });

  test('a key moves up and down with buttons that work from the keyboard', async ({ page }) => {
    await page.goto(URL);
    // the ends cannot move further
    await expect(
      item(page, 'Anthropic').getByRole('button', { name: /^Move .* up/ }),
    ).toBeDisabled();
    await expect(item(page, 'Groq').getByRole('button', { name: /^Move .* down/ })).toBeDisabled();
    const down = item(page, 'Anthropic').getByRole('button', { name: /^Move .* down/ });
    await down.focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => order(page))
      .toEqual(['OpenRouter (free models)', 'Anthropic (Claude Haiku)', 'Groq']);
    // the focus stays on the key that moved, so a second press moves it again
    await expect(
      item(page, 'Anthropic').getByRole('button', { name: /^Move .* down/ }),
    ).toBeFocused();
    await page.keyboard.press('Space');
    await expect
      .poll(() => order(page))
      .toEqual(['OpenRouter (free models)', 'Groq', 'Anthropic (Claude Haiku)']);
    await expect(
      item(page, 'Anthropic').getByRole('button', { name: /^Move .* up/ }),
    ).toBeFocused();
    await item(page, 'Anthropic')
      .getByRole('button', { name: /^Move .* up/ })
      .click();
    await expect
      .poll(() => order(page))
      .toEqual(['OpenRouter (free models)', 'Anthropic (Claude Haiku)', 'Groq']);
    // the first key switched on is the first choice, wherever the switched-off keys sit
    await expect(item(page, 'OpenRouter').getByText('First choice')).toBeVisible();
    await expect(item(page, 'Anthropic').getByText('Fallback 2')).toBeVisible();
  });

  test('Test this key tests that key alone and says so', async ({ page }) => {
    await page.goto(URL);
    await item(page, 'OpenRouter')
      .getByRole('button', { name: 'Test the OpenRouter (free models) key on its own' })
      .click();
    await expect(
      page.getByText('Tested the OpenRouter (free models) key on its own: it works'),
    ).toBeVisible();
    await item(page, 'Anthropic')
      .getByRole('button', { name: /Test the Anthropic .* key on its own/ })
      .click();
    const bad = item(page, 'Anthropic');
    await expect(bad.getByText(/key on its own: not working yet/)).toBeVisible();
    await expect(bad.getByText(/no credit left/).first()).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('Test the whole chain says which key answers and what each did', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: 'Test the whole chain' }).click();
    await expect(
      page.getByText('The chain works: OpenRouter (free models) would answer.'),
    ).toBeVisible();
    await expect(
      page.getByText(/1\. Anthropic \(Claude Haiku\): The Anthropic account has no credit left/),
    ).toBeVisible();
    await expect(page.getByText(/2\. OpenRouter \(free models\): answered/)).toBeVisible();
    // changing the order changes who answers
    await item(page, 'OpenRouter')
      .getByRole('button', { name: /^Move .* up/ })
      .click();
    await page.getByRole('button', { name: 'Test the whole chain' }).click();
    await expect(page.getByText(/2\. Anthropic \(Claude Haiku\): not asked/).first()).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('removing a key asks first', async ({ page }) => {
    await page.goto(URL);
    const messages: string[] = [];
    page.on('dialog', (d) => {
      messages.push(d.message());
      void (messages.length === 1 ? d.dismiss() : d.accept());
    });
    const remove = item(page, 'Groq').getByRole('button', { name: 'Remove the Groq key' });
    await remove.click();
    await expect(item(page, 'Groq')).toBeVisible();
    await remove.click();
    await expect(item(page, 'Groq')).toHaveCount(0);
    expect(messages[0]).toContain('Remove the Groq key?');
    expect(messages[0]).toContain('cannot be shown again');
    // the service can be added again
    await expect(page.getByLabel('AI service').locator('option')).toHaveText([
      'Groq',
      'Google Gemini',
    ]);
  });

  test('adding a key offers only the services without one, and the key is never shown', async ({
    page,
  }) => {
    await page.goto(URL);
    const service = page.getByLabel('AI service');
    await expect(service.locator('option')).toHaveText(['Google Gemini']);
    const key = page.getByLabel(/^API key/);
    await expect(key).toHaveAttribute('type', 'password');
    await expect(key).toHaveValue('');
    await key.fill('AIza-sample-key-123456');
    await page.getByRole('button', { name: 'Add key' }).click();
    await expect(page.getByText('Saved (sample: nothing is stored).')).toBeVisible();
    await expect(key).toHaveCount(0); // every service has a key now, so the form is gone
    await expect(page.getByText('Every service already has a key.')).toBeVisible();
    expect(await order(page)).toEqual([
      'Anthropic (Claude Haiku)',
      'OpenRouter (free models)',
      'Groq',
      'Google Gemini',
    ]);
    await expect(item(page, 'Google Gemini').getByText('Switched off')).toHaveCount(0);
    await expect(page.getByText('AIza-sample-key-123456')).toHaveCount(0);
    await expect(page.locator('input[value*="AIza"]')).toHaveCount(0);
    await expect(item(page, 'Google Gemini').getByText('Fallback 3')).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });

  test('a replacement key is write-only too', async ({ page }) => {
    await page.goto(URL);
    const row = item(page, 'Groq');
    await row.getByText('Replace the key').click();
    const input = row.getByLabel('New Groq key');
    await expect(input).toHaveAttribute('type', 'password');
    await expect(input).toHaveValue('');
    await input.fill('gsk_new_sample_key_1');
    await row.getByRole('button', { name: 'Replace key' }).click();
    await expect(page.getByText('Groq: Saved (sample: nothing is stored).')).toBeVisible();
    await expect(input).toHaveValue('');
  });

  test('a short key is refused with a plain message', async ({ page }) => {
    await page.goto(URL);
    await page.getByLabel(/^API key/).fill('abc');
    await page.getByRole('button', { name: 'Add key' }).click();
    await expect(page.getByText(/does not look like an API key/)).toBeVisible();
  });

  test('the Gmail label is saved on its own', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByLabel('Gmail label with forwarded bank e-mails')).toHaveValue(
      'FWOS/Inbox',
    );
    await expect(page.getByRole('button', { name: 'Save label' })).toBeVisible();
  });

  test('fits the screen even in a wide font', async ({ page }) => {
    await page.goto(URL);
    await page.addStyleTag({ content: '* { font-family: "DejaVu Sans", sans-serif !important; }' });
    await page.getByRole('button', { name: 'Test the whole chain' }).click();
    await item(page, 'Anthropic')
      .getByRole('button', { name: /Test the Anthropic .* key on its own/ })
      .click();
    await expect(page.getByText(/The chain works/)).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
  });
});
