/**
 * What a bank line was spent on, or what came in, read from the merchant and the words the bank wrote ("UPI-ZOMATO LTD-…",
 * "POS 4321 INDIGO AIRLINES", "NEFT CR-ACME PVT LTD SALARY"). The classifier (statement-classify.ts) uses it so that a line from a
 * known merchant is not asked about whatever its size (up to the Settings limit): a flight is travel, a card bill is spending, TDS is
 * tax. A person's own tag on a line, or a rule's, always wins over this.
 *
 * Merchants and words are matched as whole words in the narration, with a confidence: "high" for a merchant's own name, "medium" for
 * a general word ("hotel", "pharmacy"). Pure.
 */

export type CategoryId =
  // money out
  | 'food'
  | 'groceries'
  | 'shopping'
  | 'travel'
  | 'flights'
  | 'fuel'
  | 'utilities'
  | 'phone'
  | 'subscriptions'
  | 'medical'
  | 'insurance'
  | 'education'
  | 'card_bill'
  | 'loan_emi'
  | 'cash'
  | 'rent_paid'
  | 'fees'
  | 'taxes'
  | 'donation'
  | 'other_spend'
  | 'given'
  // either way: money that stays in the family
  | 'transfer'
  | 'deposit'
  | 'loan'
  | 'investment'
  // money in
  | 'interest'
  | 'refund'
  | 'salary'
  | 'dividend'
  | 'tax_refund'
  | 'insurance_claim'
  | 'remittance'
  | 'rent'
  | 'money_back'
  | 'from_person'
  | 'other_in';

export interface Category {
  label: string;
  /** which way the money goes; "both" for money that moves within the family (never guessed from words) */
  side: 'out' | 'in' | 'both';
  /** a merchant's own name or code (high confidence) */
  merchants: string[];
  /** general words (medium confidence) */
  words: string[];
  /** the words alone say what it was (salary, TDS, a card bill), so they are as sure as a merchant's name */
  sure?: boolean;
}

export const CATEGORIES: Record<CategoryId, Category> = {
  food: {
    label: 'Food and dining',
    side: 'out',
    merchants: [
      'swiggy',
      'zomato',
      'eatsure',
      'dominos',
      'domino s',
      'mcdonalds',
      'mc donalds',
      'kfc',
      'pizza hut',
      'burger king',
      'starbucks',
      'cafe coffee day',
      'ccd',
      'haldiram',
      'barbeque nation',
      'subway',
      'chaayos',
      'theobroma',
      'faasos',
      'box8',
      'magicpin',
    ],
    words: ['restaurant', 'cafe', 'dhaba', 'bakery', 'sweets', 'food', 'kitchen', 'eatery'],
  },
  groceries: {
    label: 'Groceries',
    side: 'out',
    merchants: [
      'bigbasket',
      'big basket',
      'blinkit',
      'grofers',
      'zepto',
      'instamart',
      'dmart',
      'avenue supermarts',
      'jiomart',
      'reliance fresh',
      'reliance smart',
      'more retail',
      'spencers',
      'natures basket',
      'star bazaar',
      'dunzo',
      'milkbasket',
      'country delight',
    ],
    words: ['grocery', 'groceries', 'kirana', 'supermarket', 'general store', 'provision', 'dairy'],
  },
  shopping: {
    label: 'Shopping',
    side: 'out',
    merchants: [
      'amazon',
      'amzn',
      'flipkart',
      'myntra',
      'ajio',
      'nykaa',
      'meesho',
      'tata cliq',
      'tatacliq',
      'croma',
      'reliance digital',
      'vijay sales',
      'decathlon',
      'ikea',
      'lifestyle',
      'shoppers stop',
      'pantaloons',
      'westside',
      'trends',
      'lenskart',
      'firstcry',
      'pepperfry',
      'urban ladder',
      'tanishq',
      'kalyan jewellers',
      'apple india',
      'snapdeal',
    ],
    words: ['mall', 'store', 'mart', 'retail', 'fashion', 'jewellers', 'electronics', 'pos'],
  },
  travel: {
    label: 'Travel and hotels',
    side: 'out',
    merchants: [
      'makemytrip',
      'make my trip',
      'goibibo',
      'yatra',
      'cleartrip',
      'easemytrip',
      'ease my trip',
      'ixigo',
      'irctc',
      'redbus',
      'abhibus',
      'uber',
      'ola cabs',
      'olacabs',
      'ani technologies',
      'rapido',
      'blusmart',
      'oyo',
      'airbnb',
      'booking com',
      'agoda',
      'expedia',
      'trivago',
      'thomas cook',
      'sotc',
      'taj hotels',
      'marriott',
      'hyatt',
      'itc hotels',
      'fastag',
      'zoomcar',
      'klook',
    ],
    words: ['hotel', 'resort', 'travels', 'travel', 'tours', 'holiday', 'cab', 'taxi', 'toll'],
  },
  flights: {
    label: 'Flights',
    side: 'out',
    merchants: [
      'indigo',
      'interglobe',
      'air india',
      'airindia',
      'vistara',
      'spicejet',
      'akasa',
      'air asia',
      'airasia',
      'singapore airlines',
      'scoot',
      'emirates',
      'qatar airways',
      'etihad',
      'lufthansa',
      'british airways',
      'cathay',
      'thai airways',
      'malaysia airlines',
    ],
    words: ['airline', 'airlines', 'airways', 'flight', 'airport'],
  },
  fuel: {
    label: 'Fuel',
    side: 'out',
    merchants: [
      'indian oil',
      'iocl',
      'bharat petroleum',
      'bpcl',
      'hpcl',
      'hindustan petroleum',
      'shell',
      'nayara',
      'jio bp',
    ],
    words: ['petrol', 'fuel', 'filling station', 'service station', 'cng'],
  },
  utilities: {
    label: 'Electricity, gas and water',
    side: 'out',
    merchants: [
      'bescom',
      'msedcl',
      'mahadiscom',
      'tata power',
      'adani electricity',
      'torrent power',
      'bses',
      'tneb',
      'tangedco',
      'uppcl',
      'pvvnl',
      'dvvnl',
      'indane',
      'hp gas',
      'bharat gas',
      'mahanagar gas',
      'igl',
      'gujarat gas',
    ],
    words: [
      'electricity',
      'power bill',
      'water bill',
      'gas bill',
      'bbps',
      'billdesk',
      'maintenance',
    ],
  },
  phone: {
    label: 'Phone, internet and TV',
    side: 'out',
    merchants: [
      'airtel',
      'jio',
      'reliance jio',
      'vodafone',
      'vodafone idea',
      'bsnl',
      'mtnl',
      'act fibernet',
      'hathway',
      'tata play',
      'tata sky',
      'dish tv',
      'singtel',
      'starhub',
    ],
    words: ['recharge', 'broadband', 'postpaid', 'prepaid', 'dth'],
  },
  subscriptions: {
    label: 'Subscriptions',
    side: 'out',
    merchants: [
      'netflix',
      'spotify',
      'hotstar',
      'disney',
      'prime video',
      'amazon prime',
      'youtube',
      'google play',
      'apple com',
      'apple services',
      'itunes',
      'microsoft',
      'adobe',
      'zee5',
      'sonyliv',
      'jiocinema',
    ],
    words: ['subscription', 'membership'],
  },
  medical: {
    label: 'Medical',
    side: 'out',
    merchants: [
      'apollo',
      'medplus',
      'netmeds',
      'tata 1mg',
      '1mg',
      'pharmeasy',
      'practo',
      'fortis',
      'max healthcare',
      'manipal',
      'narayana',
      'aiims',
      'dr lal',
      'thyrocare',
      'metropolis',
    ],
    words: [
      'pharmacy',
      'chemist',
      'medical',
      'hospital',
      'clinic',
      'diagnostic',
      'pathology',
      'dental',
      'doctor',
    ],
  },
  insurance: {
    label: 'Insurance premium',
    side: 'out',
    merchants: [
      'lic of india',
      'life insurance corporation',
      'hdfc life',
      'icici prudential',
      'icici pru',
      'icici lombard',
      'sbi life',
      'max life',
      'bajaj allianz',
      'tata aia',
      'star health',
      'care health',
      'niva bupa',
      'policybazaar',
      'digit insurance',
      'acko',
    ],
    words: ['insurance', 'premium', 'lic'],
  },
  education: {
    label: 'Education',
    side: 'out',
    merchants: ['byjus', 'unacademy', 'vedantu', 'coursera', 'udemy', 'upgrad', 'physicswallah'],
    words: ['school', 'college', 'university', 'tuition', 'academy', 'institute', 'coaching'],
  },
  card_bill: {
    label: 'Credit card bill',
    side: 'out',
    sure: true,
    merchants: ['cred club', 'cred'],
    words: [
      'credit card',
      'card payment',
      'cc payment',
      'card bill',
      'autopay',
      'si card',
      'ccpay',
    ],
  },
  loan_emi: {
    label: 'Loan EMI',
    side: 'out',
    sure: true,
    merchants: ['bajaj finance', 'bajaj finserv', 'home credit', 'tata capital'],
    words: ['emi', 'loan repayment', 'loan recovery', 'ach d loan'],
  },
  cash: {
    label: 'Cash withdrawn',
    side: 'out',
    sure: true,
    merchants: [],
    words: ['atm', 'cash withdrawal', 'atw', 'nwd', 'awd', 'cwdr', 'cash wdl', 'self withdrawal'],
  },
  rent_paid: {
    label: 'Rent paid',
    side: 'out',
    merchants: ['nobroker', 'nestaway'],
    words: ['house rent', 'rent paid', 'rent payment'],
  },
  fees: {
    label: 'Bank charges',
    side: 'out',
    merchants: [],
    words: [
      'charges',
      'chrg',
      'service charge',
      'sms charges',
      'annual fee',
      'gst on',
      'penalty',
      'min bal',
    ],
  },
  taxes: {
    label: 'Tax',
    side: 'out',
    sure: true,
    merchants: ['cbdt', 'incometax', 'tin nsdl', 'egov nsdl'],
    words: [
      'tds',
      'income tax',
      'advance tax',
      'self assessment',
      'challan',
      'gst payment',
      'property tax',
      'municipal',
    ],
  },
  donation: {
    label: 'Donation',
    side: 'out',
    merchants: ['give india', 'giveindia', 'ketto', 'milaap', 'cry', 'akshaya patra'],
    words: ['donation', 'charity', 'temple', 'trust', 'mandir', 'gurudwara'],
  },
  other_spend: { label: 'Other spending', side: 'out', merchants: [], words: [] },
  given: { label: 'Money to a person', side: 'out', merchants: [], words: [] },
  transfer: { label: 'Between your own accounts', side: 'both', merchants: [], words: [] },
  deposit: { label: 'Deposit booked or paid back', side: 'both', merchants: [], words: [] },
  loan: { label: 'Money lent or paid back', side: 'both', merchants: [], words: [] },
  investment: { label: 'Funds bought or sold', side: 'both', merchants: [], words: [] },
  interest: {
    label: 'Interest',
    side: 'in',
    merchants: [],
    words: ['interest', 'int pd', 'int paid', 'int credit', 'int cr', 'sb int'],
  },
  refund: {
    label: 'Refund or cashback',
    side: 'in',
    merchants: [],
    words: [
      'refund',
      'cashback',
      'cash back',
      'reversal',
      'reversed',
      'rev',
      'chargeback',
      'rewards',
    ],
  },
  salary: {
    label: 'Salary',
    side: 'in',
    sure: true,
    merchants: [],
    words: ['salary', 'sal', 'payroll', 'wages', 'stipend'],
  },
  dividend: {
    label: 'Dividend',
    side: 'in',
    sure: true,
    merchants: [],
    words: ['dividend', 'div', 'idcw', 'final div', 'interim div'],
  },
  tax_refund: {
    label: 'Tax refund',
    side: 'in',
    sure: true,
    merchants: ['cpc', 'itdtax'],
    words: ['tax refund', 'it refund', 'itr refund', 'income tax refund'],
  },
  insurance_claim: {
    label: 'Insurance claim or maturity',
    side: 'in',
    merchants: [],
    words: ['claim', 'maturity claim', 'survival benefit', 'death claim'],
  },
  remittance: {
    label: 'Money from abroad or exchanged',
    side: 'in',
    merchants: ['wise', 'transferwise', 'remitly', 'instarem', 'western union', 'xoom'],
    words: ['inward remittance', 'remittance', 'foreign inward', 'fira', 'swift'],
    sure: true,
  },
  rent: { label: 'Rent received', side: 'in', merchants: [], words: [] },
  money_back: { label: 'Money back from a person', side: 'in', merchants: [], words: [] },
  from_person: { label: 'Money from a person', side: 'in', merchants: [], words: [] },
  other_in: { label: 'Other money in', side: 'in', merchants: [], words: [] },
};

export interface CategoryGuess {
  id: CategoryId;
  label: string;
  confidence: 'high' | 'medium';
  /** the merchant or word that decided it, as found */
  matched: string;
}

/** The narration in plain lower-case words: "UPI-ZOMATO LTD-zomato@hdfcbank" → "upi zomato ltd zomato hdfcbank". */
const plain = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;

/** Every merchant and word once, made plain, by side: built once, so ten years of lines are read quickly. */
const PHRASES: Record<
  'in' | 'out',
  { id: CategoryId; phrase: string; raw: string; confidence: 'high' | 'medium' }[]
> = {
  in: [],
  out: [],
};
for (const [id, c] of Object.entries(CATEGORIES) as [CategoryId, Category][]) {
  if (c.side === 'both') continue;
  for (const m of c.merchants)
    PHRASES[c.side].push({ id, phrase: ` ${plain(m).trim()} `, raw: m, confidence: 'high' });
  for (const w of c.words)
    PHRASES[c.side].push({
      id,
      phrase: ` ${plain(w).trim()} `,
      raw: w,
      confidence: c.sure ? 'high' : 'medium',
    });
}

/**
 * What a line was, from its narration: the side of the money decides which categories can apply. A merchant's own name wins over a
 * general word, and a longer match over a shorter one. Null when nothing fits.
 */
export function categorize(narration: string, amount: number): CategoryGuess | null {
  const text = plain(narration);
  let best: (typeof PHRASES)['in'][number] | null = null;
  for (const p of PHRASES[amount < 0 ? 'out' : 'in']) {
    if (!text.includes(p.phrase)) continue;
    if (
      !best ||
      (p.confidence === 'high' && best.confidence === 'medium') ||
      (p.confidence === best.confidence && p.raw.length > best.raw.length)
    )
      best = p;
  }
  return best
    ? {
        id: best.id,
        label: CATEGORIES[best.id].label,
        confidence: best.confidence,
        matched: best.raw,
      }
    : null;
}

/** The label of a category id, or of a tag a person typed that is not one of them. */
export const categoryLabel = (id: string): string =>
  (CATEGORIES as Record<string, Category>)[id]?.label ?? id;
