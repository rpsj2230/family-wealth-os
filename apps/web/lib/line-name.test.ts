import { describe, expect, it } from 'vitest';
import { lineNameGuess } from './line-name';

// Invented names.
describe('the person a statement line is about, as a first guess', () => {
  it('takes the name out of the bank’s words and codes', () => {
    expect(
      lineNameGuess('NEFT DR-SBIN0001-SAMPLE KUMAR SINGH-NETBANK, MUM-N…7498-FLAT DEPOSIT'),
    ).toBe('Sample Kumar Singh');
    expect(lineNameGuess('…2460-TPT-TRANSFER SGD TO INR-PRATIBHA SAMPLE PATIL')).toBe(
      'Pratibha Sample Patil',
    );
  });
  it('leaves out the household’s own names, and gives nothing when no name is left', () => {
    expect(lineNameGuess('IMPS-123-RUPASH PRATAP-SAMPLE FRIEND', ['Rupash Pratap'])).toBe(
      'Sample Friend',
    );
    expect(lineNameGuess('CHQ DEP - REV')).toBe('');
  });
});
