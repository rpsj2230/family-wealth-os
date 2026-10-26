import { extractText, getDocumentProxy } from 'unpdf';

/** True when a PDF failure is only a missing or wrong password. */
export const isPasswordError = (e: unknown): boolean =>
  !!e &&
  typeof e === 'object' &&
  ((e as { name?: string }).name === 'PasswordException' ||
    /password/i.test((e as { message?: string }).message ?? ''));

/** Text of a PDF, opened with a password when it is protected (a fund statement's password is the holder's PAN). */
export async function casPdfText(content: Uint8Array, password?: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(content), password ? { password } : {});
  const { text } = await extractText(pdf, { mergePages: true });
  return text;
}
