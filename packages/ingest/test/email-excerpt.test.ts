import { describe, expect, it } from 'vitest';
import { emailExcerpt, EXCERPT_MAX } from '../src/email-excerpt';

describe('emailExcerpt', () => {
  it('cuts a long account number to its last four digits but leaves amounts alone', () => {
    const t = emailExcerpt('A/c 50100123456789 balance INR 1,23,456.78 and 1234567890.50 total');
    expect(t).toContain('••••6789');
    expect(t).not.toContain('50100123456789');
    expect(t).toContain('1,23,456.78');
    expect(t).toContain('1234567890.50');
  });
  it('hides a PAN, tidies white space and caps the length', () => {
    expect(emailExcerpt('PAN ABCDE1234F   ok\r\n\r\n\r\n\r\nend')).toBe(
      'PAN [PAN hidden] ok\n\nend',
    );
    expect(emailExcerpt('x'.repeat(EXCERPT_MAX + 50))).toHaveLength(EXCERPT_MAX);
  });
});
