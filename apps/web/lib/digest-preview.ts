import type { DigestEmail } from '@fwos/core';

/** The widths the e-mail is shown at: a phone, and a laptop's mail window. */
export const PREVIEW_FRAMES = [
  { key: 'phone', label: 'On a phone', width: 390 },
  { key: 'desktop', label: 'On a laptop', width: 680 },
] as const;

export interface PreviewFrame {
  key: string;
  label: string;
  width: number;
  /** the whole e-mail as a document, handed to an iframe's srcDoc */
  srcDoc: string;
  /** an empty sandbox: no script, no forms, no navigation, no same-origin access */
  sandbox: '';
  title: string;
}

/**
 * The e-mail drawn in sandboxed frames. The HTML is built by `buildDigestEmail` from live figures; it is shown exactly as it would
 * be sent, in a frame that can run nothing, so a figure or a name can never reach the page around it.
 */
export function previewFrames(email: Pick<DigestEmail, 'html' | 'subject'>): PreviewFrame[] {
  return PREVIEW_FRAMES.map((f) => ({
    ...f,
    srcDoc: email.html,
    sandbox: '' as const,
    title: `${email.subject} (${f.label.toLowerCase()})`,
  }));
}
