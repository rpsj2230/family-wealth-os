/**
 * Bank alerts reach the app through your own mailbox: the bank writes to you, your mail filter forwards the message to the app's mailbox
 * and labels it. The message the app sees is then from YOUR address, with the bank's address only inside the forwarded text. This module
 * finds that original sender, so the bank can still be recognised. It only reads text; whether to trust the forwarder is decided by the
 * caller (only the addresses you list as yours are trusted).
 */

/** The address in a From line: "Name <a@b.c>" or a bare address; lower case; empty when there is none. */
export function senderAddress(from: string): string {
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(from) ?? /([^\s<>"',;]+@[^\s<>"',;]+)/.exec(from);
  return (m?.[1] ?? '').toLowerCase();
}

export interface Unwrapped {
  /** the message was forwarded and its original sender was found */
  found: boolean;
  /** the original From line, as written */
  originalFrom: string | null;
  /** when the original was sent, from the Date line of the forward header (ISO); null when not readable */
  originalAt?: string | null;
}

const MON: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * The Date line of a forward header as an instant: "Wed, 28 Oct, 2026, 15:28", "Wed, 28 Oct 2026 at 15:28", "Wed, Oct 28, 2026 at 3:28 PM".
 * The header carries no time zone: it is written in the forwarder's Gmail time zone, `offsetHours` from UTC (Settings). Null when it cannot
 * be read.
 */
export function forwardDate(line: string, offsetHours = 0): string | null {
  const t = line.replace(/\s+/g, ' ');
  const dmy = /(\d{1,2}) ([A-Za-z]{3,9}),? (\d{4})/.exec(t);
  const mdy = /([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})/.exec(t);
  const hit = dmy ?? mdy;
  if (!hit) return null;
  const day = Number(dmy ? dmy[1] : mdy![2]);
  const mon = MON[(dmy ? dmy[2]! : mdy![1]!).slice(0, 3).toLowerCase()];
  const year = Number(hit[3]);
  if (!mon || day < 1 || day > 31) return null;
  const tm = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/.exec(
    t.slice(hit.index + hit[0].length),
  );
  let h = tm ? Number(tm[1]) : 0;
  const mi = tm ? Number(tm[2]) : 0;
  const se = tm?.[3] ? Number(tm[3]) : 0;
  const ap = tm?.[4]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || mi > 59 || se > 59) return null;
  const ms = Date.UTC(year, mon - 1, day, h, mi, se);
  const back = new Date(ms);
  if (back.getUTCDate() !== day || back.getUTCMonth() !== mon - 1) return null;
  return new Date(ms - offsetHours * 3_600_000).toISOString();
}

const MARKER =
  /-{2,}\s*(?:forwarded message|original message)\s*-{2,}|begin forwarded message:|forwarded message:/i;

/**
 * The original sender of a forwarded message, read from the forward header block ("---------- Forwarded message ---------", "From: Name
 * <a@b.c>", "Date: ..."). Works on text with or without line breaks. Null when the message is not a forward or has no readable header.
 */
export function unwrapForward(subject: string, text: string, offsetHours = 0): Unwrapped {
  const forwarded = /^\s*(?:fwd?|fw)\s*:/i.test(subject) || MARKER.test(text);
  if (!forwarded) return { found: false, originalFrom: null };
  const at = MARKER.exec(text);
  const block = at ? text.slice(at.index + at[0].length) : text;
  // the header block is short: look for the first From: line near the marker (up to a few hundred characters)
  const m = /(?:^|\s)From:\s*(.+?)(?=\s+(?:Date|Sent|Subject|To|Cc|Reply-To):|\r?\n|$)/i.exec(
    block.slice(0, 600),
  );
  const from = m?.[1]?.trim() ?? '';
  if (!senderAddress(from)) return { found: false, originalFrom: null };
  const d = /(?:^|\s)(?:Date|Sent):\s*(.+?)(?=\s+(?:From|Subject|To|Cc|Reply-To):|\r?\n|$)/i.exec(
    block.slice(0, 600),
  );
  return {
    found: true,
    originalFrom: from,
    originalAt: d ? forwardDate(d[1]!, offsetHours) : null,
  };
}
