/**
 * The copy of an email the app keeps so a reading can be checked later and the email read again without going back to the
 * mailbox. Only the text is kept (never attachments), long digit runs such as account numbers are cut to their last four
 * digits, PAN-shaped codes are hidden, and the copy is capped in length.
 */
export const EXCERPT_MAX = 6000;

export function emailExcerpt(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[PAN hidden]')
      // an account number, not an amount: an amount has commas or a decimal part
      .replace(/(?<![\d,.])\d{10,}(?!\d|\.\d)/g, (n) => `••••${n.slice(-4)}`)
      .trim()
      .slice(0, EXCERPT_MAX)
  );
}
