/**
 * An old binary Excel file (.xls, Excel 97–2003, "BIFF8"), as rows of cells for each sheet: what several banks still send (RBL's
 * "OpTransactionHistory"). Only what a statement needs is read: text, numbers (a number in a date format becomes a date) and the
 * results of formulas. Pure: no I/O, no dependencies.
 *
 * The file is a "compound file" (a small file system of sectors); the sheets are in its "Workbook" stream as a run of records.
 */
import type { Cell } from './bank-statement';

const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

/** The streams of a compound file, by name. */
function compoundStreams(b: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(0, true) !== 0xe011cfd0 || v.getUint32(4, true) !== 0xe11ab1a1)
    throw new Error('This is not an old Excel file.');
  const sectorSize = 1 << v.getUint16(30, true);
  const miniSize = 1 << v.getUint16(32, true);
  const fatCount = v.getUint32(44, true);
  const dirStart = v.getUint32(48, true);
  const miniCutoff = v.getUint32(56, true);
  const miniFatStart = v.getUint32(60, true);
  let difatNext = v.getUint32(68, true);
  const sectorAt = (n: number) => 512 + n * sectorSize;
  // the sectors that hold the allocation table: 109 in the header, the rest in a chain of further sectors
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatCount; i++) {
    const s = v.getUint32(76 + i * 4, true);
    if (s !== FREESECT) fatSectors.push(s);
  }
  for (
    let guard = 0;
    difatNext !== ENDOFCHAIN && difatNext !== FREESECT && guard < 10_000;
    guard++
  ) {
    const at = sectorAt(difatNext);
    for (let i = 0; i < sectorSize / 4 - 1 && fatSectors.length < fatCount; i++)
      fatSectors.push(v.getUint32(at + i * 4, true));
    difatNext = v.getUint32(at + sectorSize - 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSectors)
    for (let i = 0; i < sectorSize / 4; i++) fat.push(v.getUint32(sectorAt(s) + i * 4, true));
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    for (
      let s = start;
      s !== ENDOFCHAIN && s < table.length && out.length <= table.length;
      s = table[s]!
    )
      out.push(s);
    return out;
  };
  const read = (start: number) => {
    const ss = chain(start, fat);
    const out = new Uint8Array(ss.length * sectorSize);
    ss.forEach((s, i) =>
      out.set(b.subarray(sectorAt(s), sectorAt(s) + sectorSize), i * sectorSize),
    );
    return out;
  };
  const dir = read(dirStart);
  const dv = new DataView(dir.buffer);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const len = dv.getUint16(at + 64, true);
    let name = '';
    for (let i = 0; i < Math.max(0, len / 2 - 1); i++)
      name += String.fromCharCode(dv.getUint16(at + i * 2, true));
    entries.push({
      name,
      type: dir[at + 66]!,
      start: dv.getUint32(at + 116, true),
      size: dv.getUint32(at + 120, true),
    });
  }
  const root = entries.find((e) => e.type === 5);
  const miniStream = root ? read(root.start) : new Uint8Array();
  const miniFatBytes = miniFatStart === ENDOFCHAIN ? new Uint8Array() : read(miniFatStart);
  const mfv = new DataView(miniFatBytes.buffer);
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(mfv.getUint32(i, true));
  const streams = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.type !== 2) continue;
    if (e.size < miniCutoff) {
      const ss = chain(e.start, miniFat);
      const out = new Uint8Array(ss.length * miniSize);
      ss.forEach((s, i) =>
        out.set(miniStream.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize),
      );
      streams.set(e.name, out.subarray(0, e.size));
    } else streams.set(e.name, read(e.start).subarray(0, e.size));
  }
  return streams;
}

/** Excel's built-in number formats that show a date. */
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
const isDateCode = (code: string) =>
  /[dmy]/i.test(code.replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) && !/^[#0.,%\s]*$/.test(code);

/** A serial day number (1900 system) as a date. */
const fromSerial = (n: number) => new Date(Math.round((n - 25569) * 86400000));

/** An RK number: a compact number in a cell. */
function rk(v: number): number {
  const div100 = v & 1;
  const isInt = v & 2;
  let n: number;
  if (isInt) n = v >> 2;
  else {
    const buf = new DataView(new ArrayBuffer(8));
    buf.setUint32(4, v & 0xfffffffc, true);
    buf.setUint32(0, 0, true);
    n = buf.getFloat64(0, true);
  }
  return div100 ? n / 100 : n;
}

export function gridsFromXls(bytes: Uint8Array): Cell[][][] {
  const streams = compoundStreams(bytes);
  const wb = streams.get('Workbook') ?? streams.get('Book');
  if (!wb) throw new Error('The old Excel file has no workbook in it.');
  const v = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);

  // the records, with each CONTINUE kept apart (a long string carries on in one, with its own flag byte)
  const recs: { type: number; at: number; len: number; cont: { at: number; len: number }[] }[] = [];
  for (let at = 0; at + 4 <= wb.length;) {
    const type = v.getUint16(at, true);
    const len = v.getUint16(at + 2, true);
    if (type === 0x003c && recs.length) recs[recs.length - 1]!.cont.push({ at: at + 4, len });
    else recs.push({ type, at: at + 4, len, cont: [] });
    at += 4 + len;
  }

  // the shared strings: a record with its CONTINUE parts read as one, minding where each part starts
  const sst: string[] = [];
  const formats = new Map<number, string>();
  const xfDate: boolean[] = [];
  const sheets: { name: string; offset: number }[] = [];
  for (const r of recs) {
    if (r.type === 0x00fc) {
      const parts = [{ at: r.at, len: r.len }, ...r.cont];
      let p = 0;
      let pos = parts[0]!.at;
      let end = pos + parts[0]!.len;
      const need = () => {
        if (pos >= end && p + 1 < parts.length) {
          p++;
          pos = parts[p]!.at;
          end = pos + parts[p]!.len;
          return true;
        }
        return false;
      };
      const u8 = () => (need(), v.getUint8(pos++));
      const u16 = () => {
        need();
        const x = v.getUint16(pos, true);
        pos += 2;
        return x;
      };
      const u32 = () => {
        need();
        const x = v.getUint32(pos, true);
        pos += 4;
        return x;
      };
      pos += 4; // the total count
      const unique = v.getUint32(r.at + 4, true);
      pos += 4;
      for (let i = 0; i < unique; i++) {
        const chars = u16();
        let flags = u8();
        const rich = flags & 0x08 ? u16() : 0;
        const ext = flags & 0x04 ? u32() : 0;
        let s = '';
        for (let c = 0; c < chars;) {
          if (pos >= end) {
            // the string carries on in the next part, which starts with its own flag byte
            if (!need()) break;
            flags = v.getUint8(pos++);
          }
          if (flags & 0x01) {
            s += String.fromCharCode(v.getUint16(pos, true));
            pos += 2;
          } else s += String.fromCharCode(v.getUint8(pos++));
          c++;
        }
        for (let k = 0; k < rich * 4 + ext; k++) u8();
        sst.push(s);
      }
    } else if (r.type === 0x041e) {
      const id = v.getUint16(r.at, true);
      formats.set(id, readString(v, r.at + 2, true).text);
    } else if (r.type === 0x00e0) {
      const fmt = v.getUint16(r.at + 2, true);
      xfDate.push(DATE_FORMATS.has(fmt) || isDateCode(formats.get(fmt) ?? ''));
    } else if (r.type === 0x0085) {
      sheets.push({
        offset: v.getUint32(r.at, true),
        name: readString(v, r.at + 6, false).text,
      });
    }
  }

  const grids: Cell[][][] = [];
  for (const sh of sheets) {
    const rows: Cell[][] = [];
    const put = (row: number, col: number, cell: Cell) => {
      const r = (rows[row] ??= []);
      while (r.length < col) r.push(null);
      r[col] = cell;
    };
    const num = (xf: number, n: number): Cell => (xfDate[xf] ? fromSerial(n) : n);
    let i = recs.findIndex((r) => r.at - 4 === sh.offset);
    if (i < 0) continue;
    let pendingString: { row: number; col: number } | null = null;
    for (i++; i < recs.length && recs[i]!.type !== 0x000a; i++) {
      const r = recs[i]!;
      const row = v.getUint16(r.at, true);
      const col = v.getUint16(r.at + 2, true);
      switch (r.type) {
        case 0x00fd: // LABELSST
          put(row, col, sst[v.getUint32(r.at + 6, true)] ?? null);
          break;
        case 0x0204: // LABEL
          put(row, col, readString(v, r.at + 6, true).text);
          break;
        case 0x0203: // NUMBER
          put(row, col, num(v.getUint16(r.at + 4, true), v.getFloat64(r.at + 6, true)));
          break;
        case 0x027e: // RK
          put(row, col, num(v.getUint16(r.at + 4, true), rk(v.getInt32(r.at + 6, true))));
          break;
        case 0x00bd: {
          // MULRK: several RK cells in a row
          const last = v.getUint16(r.at + r.len - 2, true);
          for (let c = col, at = r.at + 4; c <= last; c++, at += 6)
            put(row, c, num(v.getUint16(at, true), rk(v.getInt32(at + 2, true))));
          break;
        }
        case 0x0006: {
          // FORMULA: its last result; a text result follows in a STRING record
          const xf = v.getUint16(r.at + 4, true);
          if (v.getUint16(r.at + 12, true) !== 0xffff)
            put(row, col, num(xf, v.getFloat64(r.at + 6, true)));
          else if (v.getUint8(r.at + 6) === 0) pendingString = { row, col };
          break;
        }
        case 0x0207: // STRING (a formula's text result)
          if (pendingString)
            put(pendingString.row, pendingString.col, readString(v, r.at, true).text);
          pendingString = null;
          break;
      }
    }
    grids.push(Array.from(rows, (r) => r ?? []));
  }
  return grids;
}

/** A BIFF8 string: its length (two bytes, or one in a sheet's name), a flag byte, then the characters. */
function readString(v: DataView, at: number, wideLength: boolean): { text: string; next: number } {
  const chars = wideLength ? v.getUint16(at, true) : v.getUint8(at);
  let pos = at + (wideLength ? 2 : 1);
  const flags = v.getUint8(pos++);
  if (flags & 0x08) pos += 2;
  if (flags & 0x04) pos += 4;
  let s = '';
  for (let c = 0; c < chars && pos < v.byteLength; c++) {
    if (flags & 0x01) {
      s += String.fromCharCode(v.getUint16(pos, true));
      pos += 2;
    } else s += String.fromCharCode(v.getUint8(pos++));
  }
  return { text: s, next: pos };
}
