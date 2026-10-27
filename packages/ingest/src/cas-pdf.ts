import { getDocumentProxy } from 'unpdf';

/** True when a PDF failure is only a missing or wrong password. */
export const isPasswordError = (e: unknown): boolean =>
  !!e &&
  typeof e === 'object' &&
  ((e as { name?: string }).name === 'PasswordException' ||
    /password/i.test((e as { message?: string }).message ?? ''));

/** One piece of text with where it sits on the page (PDF coordinates: the origin is the bottom left). */
export interface TextPiece {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Puts the pieces of one page back in reading order: top to bottom, then left to right, one line of text per visual line, with a
 * space wherever two pieces do not touch. A PDF stores its text in the order it was drawn, not the order it is read: some
 * statements draw a scheme's title after its table, and draw each table cell on its own, so the text comes out shuffled and with
 * the columns run together. The position of every piece does not lie.
 */
export function pageLines(pieces: TextPiece[]): string[] {
  const items = pieces.filter((p) => p.str.trim().length > 0);
  items.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextPiece[][] = [];
  let lineY = Number.NaN;
  for (const p of items) {
    const tol = Math.max(1.5, 0.4 * (p.height || 8));
    const last = lines[lines.length - 1];
    if (last && Math.abs(p.y - lineY) <= tol) last.push(p);
    else {
      lines.push([p]);
      lineY = p.y;
    }
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    let out = '';
    let prevEnd = Number.NaN;
    for (const p of line) {
      const gap = p.x - prevEnd;
      const h = p.height || 8;
      if (out && (Number.isNaN(gap) || gap > 0.1 * h) && !/\s$/.test(out) && !/^\s/.test(p.str))
        out += ' ';
      out += p.str;
      prevEnd = p.x + p.width;
    }
    return out.replace(/\s+/g, ' ').trim();
  });
}

/**
 * Text of a PDF in reading order, one line per visual line, opened with a password when it is protected (a fund statement's
 * password is the holder's PAN unless the holder chose another).
 */
export async function casPdfText(content: Uint8Array, password?: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(content), password ? { password } : {});
  const pages: string[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const pieces: TextPiece[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue;
      pieces.push({
        str: it.str,
        x: it.transform[4] as number,
        y: it.transform[5] as number,
        width: it.width,
        height: it.height,
      });
    }
    pages.push(pageLines(pieces).join('\n'));
  }
  return pages.join('\n');
}
