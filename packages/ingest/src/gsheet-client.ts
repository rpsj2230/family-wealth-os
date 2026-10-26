/**
 * A small Google Sheets client for a service account: sign a JWT with the account's private key, exchange it for an access token
 * and call the Sheets REST API (v4) with plain `fetch`. No Google library is used; `fetch` is passed in, so everything is tested
 * against a fake Google server.
 *
 * The key and the access token stay in memory: the token is cached for its lifetime and never written anywhere, and neither is
 * ever part of an error message or a return value.
 */
import { createHash, createSign } from 'node:crypto';
import { gridFromApi, type ApiGridData, type SheetGrid } from './sheet-grid';
import type { SheetTab } from './sheet-months';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

// ----------------------------------------------------------------------------------------------
// Plain-words errors
// ----------------------------------------------------------------------------------------------
export type SheetSyncErrorCode =
  | 'bad_key'
  | 'no_connection'
  | 'token_rejected'
  | 'api_disabled'
  | 'not_shared'
  | 'not_found'
  | 'not_a_sheet'
  | 'quota'
  | 'network'
  | 'no_template'
  | 'no_register'
  | 'busy'
  | 'other';

/** An error whose message says what happened and what to do about it, in words that can be shown as they are. */
export class SheetSyncError extends Error {
  constructor(
    readonly code: SheetSyncErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'SheetSyncError';
  }
}

interface GoogleErrorBody {
  error?:
    string | { code?: number; message?: string; status?: string; details?: { reason?: string }[] };
  error_description?: string;
}

function parseBody(text: string): GoogleErrorBody {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' ? (v as GoogleErrorBody) : {};
  } catch {
    return {};
  }
}

/**
 * Turns an answer from Google into the sentence the person needs: what is wrong and the way out.
 * `email` is the service account's address (not a secret) so the message can say whom to share the sheet with.
 */
export function explainGoogleError(
  status: number,
  bodyText: string,
  ctx: { stage: 'token' | 'api'; email?: string },
): SheetSyncError {
  const body = parseBody(bodyText);
  const err = typeof body.error === 'object' ? body.error : undefined;
  const message = `${err?.message ?? ''} ${typeof body.error === 'string' ? body.error : ''} ${body.error_description ?? ''}`;
  const reasons = (err?.details ?? []).map((d) => d.reason ?? '').join(' ');
  const who = ctx.email ? ` (${ctx.email})` : '';

  if (ctx.stage === 'token')
    return new SheetSyncError(
      'token_rejected',
      `Google did not accept the service-account key${/invalid_grant|signature|expired|disabled|deleted|not found/i.test(message) ? ` (${message.trim().replace(/\s+/g, ' ').slice(0, 120)})` : ''}. The key may have been deleted or the service account disabled in Google Cloud. Create a new key (IAM & Admin > Service Accounts > Keys > Add key > JSON), paste it in Settings > Connections and test again.`,
      status,
    );
  if (
    /SERVICE_DISABLED|has not been used in project|API has not been enabled|accessNotConfigured/i.test(
      `${reasons} ${message}`,
    )
  )
    return new SheetSyncError(
      'api_disabled',
      'The Google Sheets API is not switched on for the Google Cloud project that owns the service account. Open Google Cloud > APIs & Services > Library, search for “Google Sheets API”, press Enable, wait a minute and test again.',
      status,
    );
  if (
    status === 403 ||
    /PERMISSION_DENIED|does not have permission|caller does not have/i.test(message)
  )
    return new SheetSyncError(
      'not_shared',
      `The spreadsheet is not shared with the service account${who}, or it was shared as Viewer only. Open the sheet in Google Sheets, press Share, add ${ctx.email ?? 'the service account’s e-mail'} as Editor and test again.`,
      status,
    );
  if (status === 404)
    return new SheetSyncError(
      'not_found',
      'Google cannot find that spreadsheet. Check the link or ID in Settings > Connections: it is the long text between /d/ and /edit in the sheet’s address. If the link is right, the sheet may not be shared with the service account yet.',
      status,
    );
  if (/not supported for this document/i.test(message))
    return new SheetSyncError(
      'not_a_sheet',
      'This file is an Excel file opened in Google Sheets, not a real Google Sheet, so it cannot be changed through the API. In Google Sheets choose File > Save as Google Sheets, then use the link of the new copy.',
      status,
    );
  if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(`${reasons} ${message}`))
    return new SheetSyncError(
      'quota',
      'Google says too many requests were made just now. Wait a minute and try again.',
      status,
    );
  if (status === 401)
    return new SheetSyncError(
      'token_rejected',
      'Google refused the access token. Test the connection again; if it keeps failing, create a new key for the service account.',
      status,
    );
  return new SheetSyncError(
    'other',
    `Google answered ${status}${message.trim() ? `: ${message.trim().replace(/\s+/g, ' ').slice(0, 200)}` : ''}. Nothing further was changed by this step; try again in a minute.`,
    status,
  );
}

// ----------------------------------------------------------------------------------------------
// The key
// ----------------------------------------------------------------------------------------------
export interface ServiceAccountKey {
  clientEmail: string;
  privateKey: string;
  /** where to ask for a token; only a Google address is accepted, otherwise the standard one is used */
  tokenUri: string;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Reads the JSON file Google gives out for a service account. The error never repeats what was pasted. */
export function parseServiceAccountKey(text: string): ServiceAccountKey {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new SheetSyncError(
      'bad_key',
      'That is not the key file. Paste the whole content of the .json file you downloaded from Google Cloud: it starts with { and ends with }.',
    );
  }
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const email = typeof o.client_email === 'string' ? o.client_email.trim() : '';
  const pem = typeof o.private_key === 'string' ? o.private_key : '';
  if (o.type !== undefined && o.type !== 'service_account')
    throw new SheetSyncError(
      'bad_key',
      'That key file is not for a service account. In Google Cloud choose IAM & Admin > Service Accounts, open the account, and add a key of type JSON.',
    );
  if (!EMAIL.test(email) || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem))
    throw new SheetSyncError(
      'bad_key',
      'The key file is incomplete: it needs a client_email and a private_key. Download it again from Google Cloud and paste the whole content.',
    );
  const uri = typeof o.token_uri === 'string' ? o.token_uri : TOKEN_URL;
  const googleHost = /^https:\/\/([a-z0-9-]+\.)*(googleapis|google)\.com\//.test(uri);
  return { clientEmail: email, privateKey: pem, tokenUri: googleHost ? uri : TOKEN_URL };
}

const b64url = (b: Buffer | string): string =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** The signed request for an access token (a JWT, RS256) that is valid for an hour. */
export function signJwt(
  key: ServiceAccountKey,
  nowSeconds: number,
  scope: string = SHEETS_SCOPE,
): string {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: key.clientEmail,
      scope,
      aud: key.tokenUri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const input = `${head}.${claims}`;
  let signature: Buffer;
  try {
    signature = createSign('RSA-SHA256').update(input).sign(key.privateKey);
  } catch {
    throw new SheetSyncError(
      'bad_key',
      'The private key in the file could not be used to sign a request. Download a fresh key from Google Cloud and paste it again.',
    );
  }
  return `${input}.${b64url(signature)}`;
}

// ----------------------------------------------------------------------------------------------
// The client
// ----------------------------------------------------------------------------------------------
export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}
export type HttpFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<HttpResponse>;

export type TokenCache = Map<string, { token: string; expiresAt: number }>;
/** Tokens live here for as long as the server process does; nothing is written to disk or to the database. */
const processTokens: TokenCache = new Map();

export interface TabInfo extends SheetTab {
  rows: number;
  columns: number;
}

/** What the sync needs from Google. The real client and the test fakes both provide it. */
export interface SheetsApi {
  /** the service account's e-mail address: the one the sheet must be shared with */
  readonly email: string;
  listTabs(spreadsheetId: string): Promise<{ title: string; tabs: TabInfo[] }>;
  readGrid(
    spreadsheetId: string,
    tab: TabInfo,
    rows: number,
    lastColumn: string,
  ): Promise<SheetGrid>;
  batchUpdate(
    spreadsheetId: string,
    requests: object[],
  ): Promise<{ replies: Record<string, unknown>[] }>;
  writeValues(
    spreadsheetId: string,
    data: { range: string; values: (string | number)[][] }[],
  ): Promise<void>;
  /** proves that the account can edit, without changing anything (it sets the file name to what it already is) */
  confirmEditAccess(spreadsheetId: string, title: string): Promise<void>;
}

const GRID_FIELDS =
  'sheets(properties(sheetId,title),data(startRow,startColumn,rowData(values(userEnteredValue,effectiveValue,formattedValue,effectiveFormat(numberFormat)))))';
const TAB_FIELDS =
  'properties.title,sheets.properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount))';

/** A tab name inside a range: wrapped in quotes, a quote inside it doubled. */
export const quoteTab = (title: string): string => `'${title.replace(/'/g, "''")}'`;

export interface ClientOptions {
  fetch: HttpFetch;
  /** milliseconds since 1970; injected so tests control the clock */
  now?: () => number;
  /** waits between retries; injected so tests do not wait */
  sleep?: (ms: number) => Promise<void>;
  tokenCache?: TokenCache;
  /** the token and API addresses; only tests change them */
  tokenUrl?: string;
  apiBase?: string;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1000, 3000];

export class GoogleSheetsClient implements SheetsApi {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly cache: TokenCache;
  private readonly tokenUrl: string;
  private readonly apiBase: string;
  private readonly cacheKey: string;
  private readonly key: ServiceAccountKey;
  private readonly http: HttpFetch;

  constructor(key: ServiceAccountKey, opts: ClientOptions) {
    this.key = key;
    this.http = opts.fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.cache = opts.tokenCache ?? processTokens;
    this.tokenUrl = opts.tokenUrl ?? key.tokenUri;
    this.apiBase = opts.apiBase ?? API_BASE;
    // the cache is keyed by who asks and a fingerprint of the key, so a replaced key never reuses an old token
    this.cacheKey = `${key.clientEmail}|${createHash('sha256').update(key.privateKey).digest('hex').slice(0, 16)}`;
  }

  get email(): string {
    return this.key.clientEmail;
  }

  /** An access token, from memory while it is still good (a minute to spare), otherwise a fresh one. */
  async token(): Promise<string> {
    const hit = this.cache.get(this.cacheKey);
    if (hit && hit.expiresAt - 60_000 > this.now()) return hit.token;
    const assertion = signJwt(this.key, Math.floor(this.now() / 1000));
    const res = await this.send(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
    });
    if (!res.ok)
      throw explainGoogleError(res.status, await res.text().catch(() => ''), {
        stage: 'token',
        email: this.key.clientEmail,
      });
    const j = (await res.json().catch(() => ({}))) as {
      access_token?: unknown;
      expires_in?: unknown;
    };
    if (typeof j.access_token !== 'string' || !j.access_token)
      throw new SheetSyncError(
        'token_rejected',
        'Google did not return an access token. Try again in a minute.',
      );
    const life = typeof j.expires_in === 'number' && j.expires_in > 0 ? j.expires_in : 3600;
    this.cache.set(this.cacheKey, { token: j.access_token, expiresAt: this.now() + life * 1000 });
    return j.access_token;
  }

  /** One request with a pause and a second try for the answers that mean "busy". A network failure is a plain sentence. */
  private async send(url: string, init: Parameters<HttpFetch>[1]): Promise<HttpResponse> {
    for (let attempt = 0; ; attempt++) {
      let res: HttpResponse;
      try {
        res = await this.http(url, init);
      } catch {
        if (attempt < RETRY_DELAYS_MS.length) {
          await this.sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
        throw new SheetSyncError(
          'network',
          'Google could not be reached. Check the connection and try again.',
        );
      }
      if (RETRY_STATUS.has(res.status) && attempt < RETRY_DELAYS_MS.length) {
        await this.sleep(RETRY_DELAYS_MS[attempt]!);
        continue;
      }
      return res;
    }
  }

  private async api(path: string, init?: { method?: string; body?: unknown }): Promise<unknown> {
    const token = await this.token();
    const res = await this.send(`${this.apiBase}/${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) {
      // an expired token is dropped so the next call asks for a new one
      if (res.status === 401) this.cache.delete(this.cacheKey);
      throw explainGoogleError(res.status, await res.text().catch(() => ''), {
        stage: 'api',
        email: this.key.clientEmail,
      });
    }
    return res.json();
  }

  async listTabs(spreadsheetId: string): Promise<{ title: string; tabs: TabInfo[] }> {
    const j = (await this.api(
      `${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(TAB_FIELDS)}`,
    )) as {
      properties?: { title?: string };
      sheets?: {
        properties?: {
          sheetId?: number;
          title?: string;
          index?: number;
          hidden?: boolean;
          gridProperties?: { rowCount?: number; columnCount?: number };
        };
      }[];
    };
    return {
      title: j.properties?.title ?? '',
      tabs: (j.sheets ?? []).flatMap((s, i) => {
        const p = s.properties;
        if (!p || typeof p.sheetId !== 'number' || typeof p.title !== 'string') return [];
        return [
          {
            sheetId: p.sheetId,
            title: p.title,
            index: p.index ?? i,
            hidden: p.hidden === true,
            rows: p.gridProperties?.rowCount ?? 1000,
            columns: p.gridProperties?.columnCount ?? 26,
          },
        ];
      }),
    };
  }

  async readGrid(
    spreadsheetId: string,
    tab: TabInfo,
    rows: number,
    lastColumn: string,
  ): Promise<SheetGrid> {
    const range = `${quoteTab(tab.title)}!A1:${lastColumn}${Math.max(1, Math.min(rows, tab.rows))}`;
    const j = (await this.api(
      `${encodeURIComponent(spreadsheetId)}?ranges=${encodeURIComponent(range)}&includeGridData=true&fields=${encodeURIComponent(GRID_FIELDS)}`,
    )) as { sheets?: { properties?: { sheetId?: number }; data?: ApiGridData[] }[] };
    const sheet =
      (j.sheets ?? []).find((s) => s.properties?.sheetId === tab.sheetId) ?? j.sheets?.[0];
    return gridFromApi(sheet?.data);
  }

  async batchUpdate(
    spreadsheetId: string,
    requests: object[],
  ): Promise<{ replies: Record<string, unknown>[] }> {
    const j = (await this.api(`${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: { requests, includeSpreadsheetInResponse: false },
    })) as { replies?: Record<string, unknown>[] };
    return { replies: j.replies ?? [] };
  }

  async writeValues(
    spreadsheetId: string,
    data: { range: string; values: (string | number)[][] }[],
  ): Promise<void> {
    if (data.length === 0) return;
    await this.api(`${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: 'POST',
      // RAW: a number stays a number and a date stays the serial number it is, in the cell's own number format
      body: { valueInputOption: 'RAW', data: data.map((d) => ({ ...d, majorDimension: 'ROWS' })) },
    });
  }

  async confirmEditAccess(spreadsheetId: string, title: string): Promise<void> {
    await this.batchUpdate(spreadsheetId, [
      { updateSpreadsheetProperties: { properties: { title }, fields: 'title' } },
    ]);
  }
}
