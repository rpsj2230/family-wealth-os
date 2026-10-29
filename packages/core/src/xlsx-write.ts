/**
 * Writes report tables to an Excel workbook (.xlsx): one sheet per table, its title and note above a header row, then the rows and
 * the total in bold. Amounts are real numbers in Indian grouping with two decimals, rates and shares are percentages, dates are real
 * dates, so the sheet can be summed, sorted and filtered.
 *
 * Pure and dependency-free (the file is a zip of a few XML parts, stored without compression), so it runs in the browser as well as
 * on the server.
 */
import type { Cell, Col, ReportTable } from './reports';

const enc = new TextEncoder();

// ---- zip (stored, no compression) ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, 0, true); // time
    lv.setUint16(12, 0x21, true); // date: 1980-01-01
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    parts.push(local, f.data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length + f.data.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---- workbook ------------------------------------------------------------------------------------

const xml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // characters XML 1.0 does not allow
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** Excel's day number for a YYYY-MM-DD date (days since 30 Dec 1899). */
export const excelDate = (iso: string) =>
  (Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) -
    Date.UTC(1899, 11, 30)) /
  86_400_000;

// style indexes in styles.xml below
const S = {
  text: 0,
  head: 1,
  money: 2,
  pct: 3,
  date: 4,
  int: 5,
  title: 6,
  moneyBold: 7,
  intBold: 8,
  textBold: 9,
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd mmm yyyy"/><numFmt numFmtId="165" formatCode="#,##,##0.00"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF0FF"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function cellXml(ref: string, c: Col | null, v: Cell, bold = false): string {
  if (v === null || v === undefined || v === '') return '';
  const str = (s: string, style: number) =>
    `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(s)}</t></is></c>`;
  const num = (n: number, style: number) =>
    Number.isFinite(n) ? `<c r="${ref}" s="${style}"><v>${n}</v></c>` : '';
  if (!c || c.kind === 'text' || typeof v === 'string') {
    if (c?.kind === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
      return num(excelDate(v), S.date);
    if (
      c &&
      c.kind !== 'text' &&
      typeof v === 'string' &&
      v.trim() !== '' &&
      Number.isFinite(Number(v))
    )
      return cellXml(ref, c, Number(v), bold);
    return str(String(v), bold ? S.textBold : S.text);
  }
  switch (c.kind) {
    case 'money':
      return num(v, bold ? S.moneyBold : S.money);
    case 'int':
      return num(v, bold ? S.intBold : S.int);
    case 'pct':
    case 'rate':
      return num(v, S.pct);
    default:
      return num(v, S.text);
  }
}

function sheetXml(t: ReportTable, extra: string[]): string {
  const rows: string[] = [];
  let r = 1;
  const line = (cells: string) => rows.push(`<row r="${r++}">${cells}</row>`);
  line(cellXml(`A${r}`, null, t.title, false).replace(`s="${S.text}"`, `s="${S.title}"`));
  for (const e of [t.note, ...extra].filter((x): x is string => !!x))
    line(cellXml(`A${r}`, null, e));
  r++; // a blank row before the header
  const headRow = r;
  line(
    t.columns
      .map((c, i) =>
        cellXml(`${colName(i)}${r}`, null, c.label).replace(`s="${S.text}"`, `s="${S.head}"`),
      )
      .join(''),
  );
  for (const row of t.rows)
    line(t.columns.map((c, i) => cellXml(`${colName(i)}${r}`, c, row[c.key] ?? null)).join(''));
  if (t.total)
    line(
      t.columns
        .map((c, i) => cellXml(`${colName(i)}${r}`, c, t.total![c.key] ?? null, true))
        .join(''),
    );
  const widths = t.columns
    .map((c, i) => {
      const longest = Math.max(
        c.label.length,
        ...t.rows.slice(0, 200).map((row) => String(row[c.key] ?? '').length),
      );
      const w = Math.min(60, Math.max(10, c.kind === 'money' ? 16 : longest + 2));
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
    })
    .join('');
  const last = `${colName(Math.max(0, t.columns.length - 1))}${headRow + t.rows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="A${headRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${rows.join('')}</sheetData>${t.rows.length > 0 ? `<autoFilter ref="A${headRow}:${last}"/>` : ''}</worksheet>`;
}

const sheetName = (s: string, used: Set<string>) => {
  const base =
    s
      .replace(/[[\]:*?/\\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31) || 'Sheet';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`;
  used.add(name.toLowerCase());
  return name;
};

/** A workbook of the tables, one sheet each; `lines` go under each title (the period, the filters, when it was made). */
export function tablesToXlsx(given: ReportTable[], lines: string[] = []): Uint8Array {
  // a workbook needs at least one sheet
  const tables: ReportTable[] = given.length
    ? given
    : [
        {
          id: 'empty',
          title: 'Report',
          columns: [{ key: 'note', label: 'Note', kind: 'text' }],
          rows: [{ note: 'Nothing matched the filters.' }],
        },
      ];
  const used = new Set<string>();
  const names = tables.map((t) => sheetName(t.title, used));
  const files: { name: string; data: Uint8Array }[] = [
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${tables
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('')}</Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names
          .map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('')}</sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${tables
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join(
            '',
          )}<Relationship Id="rId${tables.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: 'xl/styles.xml', data: enc.encode(STYLES) },
    ...tables.map((t, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: enc.encode(sheetXml(t, lines)),
    })),
  ];
  return zipStored(files);
}
