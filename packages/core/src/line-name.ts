/**
 * The person or words a statement line is about, as a first guess for "remember this for every line naming…": the longest run of
 * plain words left after the bank's own words, codes and numbers are taken out ("NEFT DR-SBIN0001-ARJUN KUMAR SINGH-NETBANK, MUM-
 * N…7498-FLAT DEPOSIT" → "Arjun Kumar Singh"). Empty when nothing is left. The household's own names are left out too.
 */
const BANK_WORDS = new Set(
  (
    'neft rtgs imps upi ach nach ecs dr cr chq cheque dep deposit clg clearing cts inward outward transfer trf tpt net netbank ' +
    'netbanking mob mobile ib inb by to from via ref rrn txn mr mrs ms shri smt the a of and for paid payment pay bank ltd ' +
    'limited sbi hdfc icici idfc axis yes rbl kotak equitas jana esaf indusind au small finance first state india mum head office ' +
    'branch account acct ac sa sb nre nro p2a p2p tad si autopay cash atm pos debit credit card cc ft fund funds self own ' +
    'inr sgd usd rev'
  ).split(' '),
);

export function lineNameGuess(narration: string, ownNames: string[] = []): string {
  const own = new Set(ownNames.flatMap((n) => n.toLowerCase().split(/\s+/)));
  const runs: string[][] = [];
  let cur: string[] = [];
  // a token with a digit or a cut-off mark in it is a code or a number (an IFSC "SBIN0001", "N…7498"), never a name
  for (const raw of narration.split(/[^A-Za-z0-9…]+/)) {
    const w = raw.toLowerCase();
    const keep = /^[a-z]{3,}$/.test(w) && !BANK_WORDS.has(w) && !own.has(w);
    if (keep) cur.push(w);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  const best = runs.sort((a, b) => b.join(' ').length - a.join(' ').length)[0] ?? [];
  return best
    .slice(0, 3)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}
