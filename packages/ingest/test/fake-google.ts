/**
 * A fake Google for tests: the token endpoint (it really verifies the RS256 signature of the request) and the parts of the Sheets API v4
 * the sync uses, working on an in-memory spreadsheet. Formulas are recalculated, inserted rows move the formulas that point below them,
 * and every call is recorded. Nothing here talks to the network.
 */
import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import type { HttpFetch, HttpResponse } from '../src/gsheet-client';
import { colLetters, colNumber, dateToSerial } from '../src/sheet-grid';

export interface FakeCell {
  /** a number (a date is its serial number), text or nothing */
  v?: number | string | null;
  /** a formula such as "=G12-H12" */
  f?: string;
  /** the number format: DATE with a pattern, NUMBER, PERCENT … */
  fmt?: { type: string; pattern?: string };
}

export interface FakeSheet {
  id: number;
  title: string;
  index: number;
  hidden: boolean;
  /** rows[0] is sheet row 1 */
  rows: FakeCell[][];
}

export const TOKEN_URL = 'https://oauth2.fake.test/token';
export const API_BASE = 'https://sheets.fake.test/v4/spreadsheets';

/** A throwaway key pair and the service-account key file built from it (made fresh for each test run; never a real key). */
export function throwawayKey(email = 'sync-bot@fake-project.iam.gserviceaccount.com') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const file = JSON.stringify({
    type: 'service_account',
    project_id: 'fake-project',
    private_key: privateKey,
    client_email: email,
    token_uri: 'https://oauth2.googleapis.com/token',
  });
  return { email, privateKey, publicKey, file };
}

/** The date cell format used by the synthetic workbook. */
export const DATE_FMT = { type: 'DATE', pattern: 'd mmm yyyy' };
export const PCT_FMT = { type: 'PERCENT', pattern: '0.00%' };
export const NUM_FMT = { type: 'NUMBER', pattern: '#,##,##0' };

// ----------------------------------------------------------------------------------------------
// Formulas: cell references, + - * /, SUM(range)
// ----------------------------------------------------------------------------------------------
function shiftRefs(formula: string, fromRowExclusive: number, by: number): string {
  // every reference to a row after the insertion point moves down; a range is two references
  return formula.replace(
    /(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
    (m, d1: string, col: string, d2: string, row: string) =>
      Number(row) > fromRowExclusive ? `${d1}${col}${d2}${Number(row) + by}` : m,
  );
}
function moveRefs(formula: string, by: number): string {
  return formula.replace(
    /(\$?)([A-Z]{1,3})(\$?)(\d+)/g,
    (_m, d1: string, col: string, d2: string, row: string) => `${d1}${col}${d2}${Number(row) + by}`,
  );
}

export class FakeGoogle {
  title = 'Summary - Bank Reports (synthetic)';
  sheets: FakeSheet[] = [];
  /** what the service account is allowed to do */
  canEdit = true;
  apiEnabled = true;
  shared = true;
  /** answer the next n calls to the Sheets API with this status (429, 503 …) */
  failNext: { status: number; count: number } | null = null;
  readonly calls: { method: string; url: string; body: unknown }[] = [];
  tokenRequests = 0;
  /** an exception thrown inside the fake itself (a test bug, not a Google answer) */
  lastError: unknown = undefined;
  private nextId = 1000;
  private readonly key: ReturnType<typeof throwawayKey>;
  private clock: () => number;

  constructor(
    key: ReturnType<typeof throwawayKey>,
    readonly spreadsheetId = 'sheet-id-synthetic-0001',
    clock: () => number = Date.now,
  ) {
    this.key = key;
    this.clock = clock;
  }

  add(
    title: string,
    rows: FakeCell[][],
    opts: { index?: number; hidden?: boolean } = {},
  ): FakeSheet {
    const sheet: FakeSheet = {
      id: this.nextId++,
      title,
      index: opts.index ?? this.sheets.length,
      hidden: opts.hidden ?? false,
      // no gaps: a sparse sheet is stored with an empty cell in every hole
      rows: Array.from(rows, (r) => Array.from(r ?? [], (c) => c ?? {})),
    };
    for (const s of this.sheets) if (s.index >= sheet.index) s.index++;
    this.sheets.push(sheet);
    return sheet;
  }

  sheet(title: string): FakeSheet | undefined {
    return this.sheets.find((s) => s.title === title);
  }

  /** the visible text of a cell after formulas are recalculated */
  value(title: string, ref: string): number | string | null {
    const s = this.sheet(title)!;
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    return this.effective(s, Number(m[2]), colNumber(m[1]!));
  }
  cell(title: string, ref: string): FakeCell {
    const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
    return this.sheet(title)!.rows[Number(m[2]) - 1]?.[colNumber(m[1]!) - 1] ?? {};
  }
  tabOrder(): string[] {
    return [...this.sheets].sort((a, b) => a.index - b.index).map((s) => s.title);
  }

  // ---- calculation
  private effective(s: FakeSheet, row: number, col: number, depth = 0): number | string | null {
    const c = s.rows[row - 1]?.[col - 1];
    if (!c) return null;
    if (c.f && depth < 20) return this.evalFormula(s, c.f, depth + 1);
    return c.v ?? null;
  }
  private evalFormula(s: FakeSheet, f: string, depth: number): number {
    const num = (r: number, c: number) => {
      const v = this.effective(s, r, c, depth);
      return typeof v === 'number' ? v : 0;
    };
    let expr = f.replace(/^=/, '');
    expr = expr.replace(
      /SUM\(\s*\$?([A-Z]+)\$?(\d+)\s*:\s*\$?([A-Z]+)\$?(\d+)\s*\)/gi,
      (_m, c1: string, r1: string, c2: string, r2: string) => {
        let sum = 0;
        for (let r = Number(r1); r <= Number(r2); r++)
          for (let c = colNumber(c1); c <= colNumber(c2); c++) sum += num(r, c);
        return String(sum);
      },
    );
    expr = expr.replace(/\$?([A-Z]{1,3})\$?(\d+)/g, (_m, c: string, r: string) =>
      String(num(Number(r), colNumber(c))),
    );
    if (!/^[\d+\-*/().\s e]*$/i.test(expr)) throw new Error(`fake sheet cannot evaluate ${f}`);
    return Function(`"use strict"; return (${expr || 0});`)() as number;
  }
  private display(c: FakeCell, value: number | string | null): string {
    if (value === null) return '';
    if (typeof value === 'string') return value;
    if (c.fmt?.type === 'DATE') {
      const d = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
      return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }
    if (c.fmt?.type === 'PERCENT') return `${(value * 100).toFixed(2)}%`;
    return value.toLocaleString('en-IN');
  }

  // ---- HTTP
  readonly fetch: HttpFetch = async (realOrFakeUrl, init) => {
    // the fake also answers on Google's real addresses, so code that does not let the addresses be changed can be tested end to end
    const url = realOrFakeUrl
      .replace('https://oauth2.googleapis.com/token', TOKEN_URL)
      .replace('https://sheets.googleapis.com/v4/spreadsheets', API_BASE);
    const method = init?.method ?? 'GET';
    const body = init?.body
      ? init.body.startsWith('{')
        ? JSON.parse(init.body)
        : init.body
      : null;
    this.calls.push({ method, url, body });
    if (url === TOKEN_URL) return this.token(String(body ?? ''));
    if (!url.startsWith(API_BASE))
      return this.json(404, { error: { code: 404, message: 'unknown address' } });
    const auth = init?.headers?.authorization ?? '';
    if (!/^Bearer tok-\d+$/.test(auth))
      return this.json(401, {
        error: { code: 401, message: 'Request had invalid authentication credentials.' },
      });
    if (this.failNext && this.failNext.count > 0) {
      this.failNext.count--;
      return this.json(this.failNext.status, {
        error: { code: this.failNext.status, message: 'busy' },
      });
    }
    if (!this.apiEnabled)
      return this.json(403, {
        error: {
          code: 403,
          message: 'Google Sheets API has not been used in project 123 before or it is disabled.',
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'SERVICE_DISABLED' }],
        },
      });
    if (!this.shared)
      return this.json(403, {
        error: {
          code: 403,
          message: 'The caller does not have permission',
          status: 'PERMISSION_DENIED',
        },
      });
    const rest = url.slice(API_BASE.length + 1);
    if (!rest.startsWith(this.spreadsheetId))
      return this.json(404, {
        error: { code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND' },
      });
    const after = rest.slice(this.spreadsheetId.length);
    if (method === 'POST' && after === ':batchUpdate')
      return this.batchUpdate(body as { requests: Record<string, unknown>[] });
    if (method === 'POST' && after === '/values:batchUpdate')
      return this.valuesBatchUpdate(
        body as { data: { range: string; values: (string | number)[][] }[] },
      );
    if (method === 'GET') return this.get(new URL(url));
    return this.json(400, { error: { code: 400, message: 'unsupported call' } });
  };

  private json(status: number, o: unknown): HttpResponse {
    const text = JSON.stringify(o);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    };
  }

  private token(form: string): HttpResponse {
    this.tokenRequests++;
    const p = new URLSearchParams(form);
    if (p.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer')
      return this.json(400, { error: 'unsupported_grant_type' });
    const jwt = (p.get('assertion') ?? '').split('.');
    if (jwt.length !== 3)
      return this.json(400, { error: 'invalid_grant', error_description: 'Invalid JWT' });
    const claims = JSON.parse(Buffer.from(jwt[1]!, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    const ok = createVerify('RSA-SHA256')
      .update(`${jwt[0]}.${jwt[1]}`)
      .verify(createPublicKey(this.key.publicKey), Buffer.from(jwt[2]!, 'base64url'));
    const nowS = Math.floor(this.clock() / 1000);
    if (!ok || claims.iss !== this.key.email)
      return this.json(400, {
        error: 'invalid_grant',
        error_description: 'Invalid JWT Signature.',
      });
    if (
      claims.scope !== 'https://www.googleapis.com/auth/spreadsheets' ||
      claims.aud !== 'https://oauth2.googleapis.com/token' ||
      Number(claims.exp) <= nowS
    )
      return this.json(400, { error: 'invalid_grant', error_description: 'Invalid JWT claims.' });
    return this.json(200, {
      access_token: `tok-${this.tokenRequests}`,
      expires_in: 3600,
      token_type: 'Bearer',
    });
  }

  private get(u: URL): HttpResponse {
    const ranges = u.searchParams.get('ranges');
    const props = (s: FakeSheet) => ({
      sheetId: s.id,
      title: s.title,
      index: s.index,
      ...(s.hidden ? { hidden: true } : {}),
      gridProperties: { rowCount: Math.max(s.rows.length, 1000), columnCount: 30 },
    });
    if (u.searchParams.get('includeGridData') !== 'true')
      return this.json(200, {
        properties: { title: this.title },
        sheets: this.sheets.map((s) => ({ properties: props(s) })),
      });
    const m = /^'((?:[^']|'')+)'!A1:([A-Z]+)(\d+)$/.exec(ranges ?? '');
    const s = m ? this.sheet(m[1]!.replace(/''/g, "'")) : undefined;
    if (!m || !s)
      return this.json(400, {
        error: {
          code: 400,
          message: `Unable to parse range: ${ranges}`,
          status: 'INVALID_ARGUMENT',
        },
      });
    const lastCol = colNumber(m[2]!);
    const lastRow = Number(m[3]);
    const rowData = [];
    for (let r = 1; r <= lastRow; r++) {
      const values = [];
      for (let c = 1; c <= lastCol; c++) {
        const cell = s.rows[r - 1]?.[c - 1];
        const eff = this.effective(s, r, c);
        const o: Record<string, unknown> = {};
        if (cell?.f) o.userEnteredValue = { formulaValue: cell.f };
        else if (typeof cell?.v === 'number') o.userEnteredValue = { numberValue: cell.v };
        else if (typeof cell?.v === 'string') o.userEnteredValue = { stringValue: cell.v };
        if (typeof eff === 'number') o.effectiveValue = { numberValue: eff };
        else if (typeof eff === 'string') o.effectiveValue = { stringValue: eff };
        if (eff !== null) o.formattedValue = this.display(cell ?? {}, eff);
        o.effectiveFormat = { numberFormat: cell?.fmt ?? { type: 'NUMBER' } };
        values.push(o);
      }
      rowData.push({ values });
    }
    return this.json(200, {
      sheets: [
        {
          properties: { sheetId: s.id, title: s.title },
          data: [{ startRow: 0, startColumn: 0, rowData }],
        },
      ],
    });
  }

  private byId(id: unknown): FakeSheet | undefined {
    return this.sheets.find((s) => s.id === id);
  }

  private batchUpdate(body: { requests: Record<string, unknown>[] }): HttpResponse {
    if (!this.canEdit)
      return this.json(403, {
        error: {
          code: 403,
          message: 'The caller does not have permission',
          status: 'PERMISSION_DENIED',
        },
      });
    const replies: Record<string, unknown>[] = [];
    for (const req of body.requests) {
      const [name, a] = Object.entries(req)[0] as [string, Record<string, any>]; // eslint-disable-line @typescript-eslint/no-explicit-any
      if (name === 'duplicateSheet') {
        const src = this.byId(a.sourceSheetId);
        if (!src)
          return this.json(400, {
            error: { code: 400, message: 'No sheet with that id', status: 'INVALID_ARGUMENT' },
          });
        if (this.sheet(a.newSheetName))
          return this.json(400, {
            error: {
              code: 400,
              message: `A sheet with the name "${a.newSheetName}" already exists. Please enter another name.`,
              status: 'INVALID_ARGUMENT',
            },
          });
        // a copy is a deep copy; JSON turns the gaps of a sparse sheet into nulls, which become empty cells
        const rows = (JSON.parse(JSON.stringify(src.rows)) as (FakeCell | null)[][]).map((r) =>
          (r ?? []).map((c) => c ?? {}),
        );
        const copy = this.add(a.newSheetName, rows, {
          index: a.insertSheetIndex ?? this.sheets.length,
        });
        if (typeof a.newSheetId === 'number') copy.id = a.newSheetId;
        replies.push({
          duplicateSheet: {
            properties: {
              sheetId: copy.id,
              title: copy.title,
              index: copy.index,
              gridProperties: { rowCount: 1000, columnCount: 30 },
            },
          },
        });
      } else if (name === 'deleteSheet') {
        const s = this.byId(a.sheetId);
        if (!s) return this.json(400, { error: { code: 400, message: 'No sheet with that id' } });
        this.sheets = this.sheets.filter((x) => x !== s);
        for (const x of this.sheets) if (x.index > s.index) x.index--;
        replies.push({});
      } else if (name === 'updateSheetProperties') {
        const s = this.byId(a.properties.sheetId);
        if (!s) return this.json(400, { error: { code: 400, message: 'No sheet with that id' } });
        if (a.fields === 'hidden') s.hidden = a.properties.hidden === true;
        replies.push({});
      } else if (name === 'insertDimension') {
        const s = this.byId(a.range.sheetId)!;
        const at = a.range.startIndex as number;
        const n = (a.range.endIndex as number) - at;
        const above = s.rows[at - 1] ?? [];
        s.rows.splice(
          at,
          0,
          ...Array.from({ length: n }, () => above.map((c) => (c.fmt ? { fmt: c.fmt } : {}))),
        );
        for (const row of s.rows) for (const c of row) if (c?.f) c.f = shiftRefs(c.f, at, n);
        replies.push({});
      } else if (name === 'copyPaste') {
        const s = this.byId(a.source.sheetId)!;
        const src = s.rows[a.source.startRowIndex]?.[a.source.startColumnIndex];
        const dr = a.destination.startRowIndex as number;
        const dc = a.destination.startColumnIndex as number;
        const row = (s.rows[dr] ??= []);
        if (a.pasteType === 'PASTE_FORMULA' && src?.f)
          row[dc] = { ...(row[dc] ?? {}), f: moveRefs(src.f, dr - a.source.startRowIndex) };
        replies.push({});
      } else if (name === 'repeatCell') {
        const s = this.byId(a.range.sheetId)!;
        const row = (s.rows[a.range.startRowIndex] ??= []);
        const c = (row[a.range.startColumnIndex] ??= {});
        c.fmt = a.cell.userEnteredFormat.numberFormat;
        replies.push({});
      } else if (name === 'updateSpreadsheetProperties') {
        this.title = a.properties.title;
        replies.push({});
      } else
        return this.json(400, { error: { code: 400, message: `unsupported request ${name}` } });
    }
    return this.json(200, { replies });
  }

  private valuesBatchUpdate(body: {
    data: { range: string; values: (string | number)[][] }[];
  }): HttpResponse {
    if (!this.canEdit)
      return this.json(403, {
        error: {
          code: 403,
          message: 'The caller does not have permission',
          status: 'PERMISSION_DENIED',
        },
      });
    for (const d of body.data) {
      const m = /^'((?:[^']|'')+)'!([A-Z]+)(\d+)$/.exec(d.range);
      const s = m ? this.sheet(m[1]!.replace(/''/g, "'")) : undefined;
      if (!m || !s)
        return this.json(400, {
          error: { code: 400, message: `Unable to parse range: ${d.range}` },
        });
      const row = (s.rows[Number(m[3]) - 1] ??= []);
      const col = colNumber(m[2]!) - 1;
      const existing = row[col];
      // a value written over a formula would replace it; the sync must never do that
      if (existing?.f) throw new Error(`a formula cell was overwritten: ${d.range}`);
      row[col] = { ...(existing?.fmt ? { fmt: existing.fmt } : {}), v: d.values[0]![0]! };
    }
    return this.json(200, { totalUpdatedCells: body.data.length });
  }
}

export { colLetters, dateToSerial };
