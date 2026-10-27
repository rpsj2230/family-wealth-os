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
}

const MARKER =
  /-{2,}\s*(?:forwarded message|original message)\s*-{2,}|begin forwarded message:|forwarded message:/i;

/**
 * The original sender of a forwarded message, read from the forward header block ("---------- Forwarded message ---------", "From: Name
 * <a@b.c>", "Date: ..."). Works on text with or without line breaks. Null when the message is not a forward or has no readable header.
 */
export function unwrapForward(subject: string, text: string): Unwrapped {
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
  return { found: true, originalFrom: from };
}
