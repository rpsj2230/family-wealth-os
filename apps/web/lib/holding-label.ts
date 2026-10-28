import { formatInrCompact } from '@fwos/core';

/** What tells two holdings apart in a list: the bank, the name, the last digits and, for a deposit, its amount and maturity. */
export interface LabelInput {
  id: string;
  nickname: string;
  owner: string;
  bank?: string | null;
  last4?: string | null;
  kind?: string | null;
  fd?: { principal: number; maturityOn: string } | null;
}

const short = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });

/** "YES Bank · Cash-NRE-0037 · Rupash", "Equitas · FD-NRE ₹5.00 L to 9 Mar 28 · Ragini" */
export function holdingLabel(h: LabelInput): string {
  const name = [
    h.nickname,
    h.last4 && !h.nickname.endsWith(h.last4) ? `…${h.last4}` : null,
    h.fd ? `${formatInrCompact(h.fd.principal)} to ${short(h.fd.maturityOn)}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return [h.bank, name, h.owner].filter(Boolean).join(' · ');
}

/** Labels for every holding, by id. */
export function holdingLabels(hs: LabelInput[]): Record<string, string> {
  return Object.fromEntries(hs.map((h) => [h.id, holdingLabel(h)]));
}
