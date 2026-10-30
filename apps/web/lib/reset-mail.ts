import nodemailer from 'nodemailer';

/** A new password is at least this long. */
export const MIN_PASSWORD = 10;

/** The household's own Gmail, the same the daily summary is sent from, when the site has its two settings (else Supabase sends). */
export function resetMailer(): { user: string; pass: string } | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_APP_PASSWORD;
  return user && pass ? { user, pass } : null;
}

/** The e-mail with the link that sets a new password. */
export async function sendResetMail(to: string, link: string): Promise<void> {
  const m = resetMailer();
  if (!m) throw new Error('no mailer');
  const transport = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: m.user, pass: m.pass },
  });
  await transport.sendMail({
    from: `Family Wealth OS <${m.user}>`,
    to,
    subject: 'Set a new password for Family Wealth OS',
    text:
      `Someone asked to set a new password for Family Wealth OS for this address.\n\n` +
      `Open this link to choose a new password. It works once and expires soon:\n${link}\n\n` +
      `If it was not you, ignore this e-mail: your password stays as it is.`,
    html:
      `<p>Someone asked to set a new password for Family Wealth OS for this address.</p>` +
      `<p><a href="${link}">Choose a new password</a>. The link works once and expires soon.</p>` +
      `<p>If it was not you, ignore this e-mail: your password stays as it is.</p>`,
  });
}
