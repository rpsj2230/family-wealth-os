import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  explainGoogleError,
  GoogleSheetsClient,
  parseServiceAccountKey,
  quoteTab,
  SheetSyncError,
  signJwt,
} from '../src/gsheet-client';
import { gridFromApi } from '../src/sheet-grid';
import { API_BASE, TOKEN_URL } from './fake-google';
import { KEY, NOW, world } from './harness';

const key = () => parseServiceAccountKey(KEY.file);
/** The error a call ends with; fails the test when the call succeeds. */
const failure = (p: Promise<unknown>): Promise<SheetSyncError> =>
  p.then(
    () => {
      throw new Error('expected the call to fail');
    },
    (e: unknown) => e as SheetSyncError,
  );
const decode = (s: string) =>
  JSON.parse(Buffer.from(s, 'base64url').toString()) as Record<string, unknown>;

describe('the service-account key', () => {
  it('is read from the JSON file Google gives out', () => {
    const k = key();
    expect(k.clientEmail).toBe(KEY.email);
    expect(k.privateKey).toContain('BEGIN PRIVATE KEY');
    expect(k.tokenUri).toBe('https://oauth2.googleapis.com/token');
  });

  it('says in plain words what is wrong with a pasted key, without repeating it', () => {
    const bad = (t: string) => {
      try {
        parseServiceAccountKey(t);
      } catch (e) {
        expect(e).toBeInstanceOf(SheetSyncError);
        expect((e as SheetSyncError).code).toBe('bad_key');
        return (e as SheetSyncError).message;
      }
      throw new Error('expected an error');
    };
    expect(bad('not json at all')).toMatch(/whole content of the .json file/);
    expect(bad(JSON.stringify({ type: 'authorized_user', client_email: 'a@b.co' }))).toMatch(
      /not for a service account/,
    );
    expect(bad(JSON.stringify({ type: 'service_account', client_email: 'a@b.co' }))).toMatch(
      /incomplete/,
    );
    expect(bad(JSON.stringify({ client_email: 'nope', private_key: 'x' }))).toMatch(/incomplete/);
    // what was pasted is never echoed back
    expect(bad('{"private_key": "SECRET-VALUE"')).not.toContain('SECRET-VALUE');
  });

  it('asks only a Google address for a token', () => {
    const k = parseServiceAccountKey(
      JSON.stringify({ ...JSON.parse(KEY.file), token_uri: 'https://evil.example.com/token' }),
    );
    expect(k.tokenUri).toBe('https://oauth2.googleapis.com/token');
  });
});

describe('signing in', () => {
  it('builds an RS256 JWT with the right claims that the public key verifies', () => {
    const jwt = signJwt(key(), 1_700_000_000);
    const [h, c, s] = jwt.split('.');
    expect(decode(h!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(c!)).toEqual({
      iss: KEY.email,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_700_000_000,
      exp: 1_700_003_600,
    });
    const ok = createVerify('RSA-SHA256')
      .update(`${h}.${c}`)
      .verify(createPublicKey(KEY.publicKey), Buffer.from(s!, 'base64url'));
    expect(ok).toBe(true);
    // url-safe: no padding, no + or /
    expect(jwt).not.toMatch(/[+/=]/);
  });

  it('reports an unusable private key as a key problem', () => {
    const broken = {
      ...key(),
      privateKey: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n',
    };
    expect(() => signJwt(broken, 1)).toThrow(/private key in the file could not be used/);
  });

  it('keeps the access token in memory for its lifetime and asks again after it', async () => {
    let t = NOW.getTime();
    const { google, client } = world({ clock: () => t });
    google.add('Sep 2026', [[]]);
    await client.listTabs(google.spreadsheetId);
    await client.listTabs(google.spreadsheetId);
    expect(google.tokenRequests).toBe(1);
    t += 59 * 60 * 1000; // inside the last minute of the hour: a new one is fetched
    await client.listTabs(google.spreadsheetId);
    expect(google.tokenRequests).toBe(2);
  });

  it('does not reuse a token after the key is replaced', async () => {
    const cache = new Map();
    const { google } = world();
    google.add('Sep 2026', [[]]);
    const opts = {
      fetch: google.fetch,
      tokenUrl: TOKEN_URL,
      apiBase: API_BASE,
      tokenCache: cache,
      sleep: async () => {},
    };
    await new GoogleSheetsClient(key(), opts).listTabs(google.spreadsheetId);
    const replaced = {
      ...key(),
      privateKey: generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      }).privateKey,
    };
    // the new key is not the one the fake trusts, so it must be refused rather than served the old token
    const e = await failure(new GoogleSheetsClient(replaced, opts).listTabs(google.spreadsheetId));
    expect(e.code).toBe('token_rejected');
    expect(cache.size).toBe(1);
  });

  it('explains a rejected key and never includes the key or the token in a message', async () => {
    const { google } = world();
    // a key whose signature the server does not accept
    const fresh = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const wrong = new GoogleSheetsClient(
      { ...key(), privateKey: fresh.privateKey },
      { fetch: google.fetch, tokenUrl: TOKEN_URL, apiBase: API_BASE, tokenCache: new Map() },
    );
    const err = await wrong
      .listTabs(google.spreadsheetId)
      .catch((e: unknown) => e as SheetSyncError);
    expect(err).toBeInstanceOf(SheetSyncError);
    expect((err as SheetSyncError).code).toBe('token_rejected');
    expect((err as SheetSyncError).message).toMatch(/did not accept the service-account key/);
    expect((err as SheetSyncError).message).not.toContain('PRIVATE KEY');
    expect((err as SheetSyncError).message).not.toMatch(/tok-\d/);
  });
});

describe('what Google says when something is wrong, in plain words', () => {
  const one = (status: number, body: unknown) =>
    explainGoogleError(status, JSON.stringify(body), {
      stage: 'api',
      email: 'bot@p.iam.gserviceaccount.com',
    });

  it('the Sheets API is not switched on', () => {
    const e = one(403, {
      error: {
        message: 'Google Sheets API has not been used in project 1 before or it is disabled.',
        details: [{ reason: 'SERVICE_DISABLED' }],
      },
    });
    expect(e.code).toBe('api_disabled');
    expect(e.message).toMatch(/Enable/);
  });

  it('the sheet is not shared with the service account', () => {
    const e = one(403, {
      error: { message: 'The caller does not have permission', status: 'PERMISSION_DENIED' },
    });
    expect(e.code).toBe('not_shared');
    expect(e.message).toContain('bot@p.iam.gserviceaccount.com');
    expect(e.message).toMatch(/Editor/);
  });

  it('the sheet is not found, or is an Excel file, or the quota is used up', () => {
    expect(one(404, { error: { message: 'Requested entity was not found.' } }).code).toBe(
      'not_found',
    );
    const x = one(400, { error: { message: 'This operation is not supported for this document' } });
    expect(x.code).toBe('not_a_sheet');
    expect(x.message).toMatch(/Save as Google Sheets/);
    expect(
      one(429, { error: { message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } }).code,
    ).toBe('quota');
    expect(one(500, 'not json').message).toMatch(/Google answered 500/);
  });

  it('is reached through the client: a sheet that is not shared, an API that is off, an unknown id', async () => {
    const w = world();
    w.google.add('Sep 2026', [[]]);
    w.google.shared = false;
    expect(
      await w.client.listTabs(w.google.spreadsheetId).catch((e: SheetSyncError) => e.code),
    ).toBe('not_shared');
    w.google.shared = true;
    w.google.apiEnabled = false;
    expect(
      await w.client.listTabs(w.google.spreadsheetId).catch((e: SheetSyncError) => e.code),
    ).toBe('api_disabled');
    w.google.apiEnabled = true;
    expect(await w.client.listTabs('some-other-id').catch((e: SheetSyncError) => e.code)).toBe(
      'not_found',
    );
  });
});

describe('talking to the Sheets API', () => {
  it('lists the tabs with their positions and hidden state', async () => {
    const w = world();
    w.google.add('Notes', [[]]);
    w.google.add('Sep 2026', [[]]);
    w.google.add('Sep 2026 - before sync', [[]], { hidden: true });
    const r = await w.client.listTabs(w.google.spreadsheetId);
    expect(r.title).toBe(w.google.title);
    expect(r.tabs.map((t) => [t.title, t.index, t.hidden])).toEqual([
      ['Notes', 0, false],
      ['Sep 2026', 1, false],
      ['Sep 2026 - before sync', 2, true],
    ]);
  });

  it('retries a busy answer once or twice and then succeeds', async () => {
    const w = world();
    w.google.add('Sep 2026', [[]]);
    w.google.failNext = { status: 503, count: 2 };
    const r = await w.client.listTabs(w.google.spreadsheetId);
    expect(r.tabs).toHaveLength(1);
  });

  it('gives a plain sentence when Google cannot be reached', async () => {
    const down = new GoogleSheetsClient(key(), {
      fetch: async () => {
        throw new Error('ECONNRESET');
      },
      sleep: async () => {},
      tokenCache: new Map(),
    });
    const e = await failure(down.listTabs('x'));
    expect(e.code).toBe('network');
    expect(e.message).toBe('Google could not be reached. Check the connection and try again.');
  });

  it('quotes a tab name that contains a quote', () => {
    expect(quoteTab("Oct '26")).toBe("'Oct ''26'");
  });

  it('turns the API’s grid data into values, formulas, date cells and the text as shown', () => {
    const g = gridFromApi([
      {
        startRow: 0,
        startColumn: 0,
        rowData: [
          {
            values: [
              { effectiveValue: { stringValue: 'FD' }, formattedValue: 'FD' },
              {
                effectiveValue: { numberValue: 46_327 },
                formattedValue: '1 Nov 2026',
                effectiveFormat: { numberFormat: { type: 'DATE', pattern: 'd mmm yyyy' } },
              },
              {
                userEnteredValue: { formulaValue: '=A1' },
                effectiveValue: { numberValue: 5 },
                formattedValue: '5',
              },
              {},
            ],
          },
        ],
      },
    ]);
    expect(g.cell('A1')).toMatchObject({ value: 'FD', formula: null, text: 'FD', isDate: false });
    expect(g.cell('B1').value).toEqual(new Date('2026-11-01T00:00:00Z'));
    expect(g.cell('B1')).toMatchObject({ isDate: true, pattern: 'd mmm yyyy' });
    expect(g.cell('C1')).toMatchObject({ value: 5, formula: '=A1' });
    expect(g.cell('D1').value).toBeNull();
    expect(g.cell('Z9').value).toBeNull();
  });
});
