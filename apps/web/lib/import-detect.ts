/**
 * Works out what a chosen file is, so the Import page can show the right preview without asking the person to pick a tab
 * first. Pure: it looks at the file name and the first few kilobytes only, in the browser, before anything is uploaded.
 */

export type ImportKind = 'workbook' | 'cas' | 'csv' | 'tax' | 'bank';

export interface Detected {
  /** what the file is taken to be; null when it could not be told */
  kind: ImportKind | null;
  /** false when the app is guessing (for example a PDF whose name says nothing) and the person should confirm */
  confident: boolean;
  /** one plain sentence for the person: what was recognised and why, or what to do */
  message: string;
}

export const KIND_LABEL: Record<ImportKind, string> = {
  workbook: 'your Excel workbook',
  cas: 'a fund statement (PDF)',
  csv: 'a fund transactions export (CSV)',
  tax: 'a tax statement (Form 26AS or AIS)',
  bank: 'a bank account statement',
};

/** Short names for the "what is this file?" list. */
export const KIND_CHOICES: { kind: ImportKind; label: string }[] = [
  { kind: 'workbook', label: 'Excel workbook (banks, savings, deposits)' },
  { kind: 'cas', label: 'Fund statement (PDF from CAMS, KFintech, MF Central)' },
  { kind: 'csv', label: 'Fund app export (CSV)' },
  { kind: 'tax', label: 'Tax statement (Form 26AS or AIS)' },
  { kind: 'bank', label: 'Bank account statement (Excel, CSV or PDF)' },
];

const has = (name: string, re: RegExp) => re.test(name.toLowerCase());
const TAX_NAME =
  /26[\s_-]?as|form[\s_-]?26|(^|[^a-z0-9])(ais|annual[\s_-]?information|traces)([^a-z0-9]|$)/;
/** what a bank names its statement downloads: "Acct Statement_XX1234", "OpTransactionHistory", "AccountStatement", "passbook" */
const BANK_NAME =
  /(acc(oun)?t|a\/c)[\s_-]*statement|statement[\s_-]*of[\s_-]*acc(oun)?t|e[\s_-]?statement|optransaction|transaction[\s_-]*history|passbook|(^|[^a-z])(stmt|acct)([^a-z]|$)/;
/** what a registrar's fund statement is named, which wins over the words a bank statement shares with it */
const REGISTRAR_NAME =
  /(^|[^a-z])(cas|consolidated|cams|kfin|kfintech|karvy|mf[\s_-]?central|cdsl|nsdl|folio)([^a-z]|$)/;
/** the column headings of a bank statement, in a CSV or a web page */
const BANK_HEAD =
  /(narration|particulars|description|remarks)[\s\S]{0,400}(withdrawal|debit|dr\b)[\s\S]{0,200}(balance)|(withdrawal|debit)[\s\S]{0,200}(deposit|credit)[\s\S]{0,200}balance/i;
const CAS_NAME =
  /(^|[^a-z])(cas|consolidated|cams|kfin|kfintech|karvy|mf[\s_-]?central|cdsl|nsdl|folio|statement of account)([^a-z]|$)/;

/**
 * @param file the name and size
 * @param head the first bytes of the file as text (any encoding: only ASCII markers are used)
 */
export function detectImport(file: { name: string; size: number }, head: string): Detected {
  const name = file.name;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  if (file.size === 0) return { kind: null, confident: false, message: 'That file is empty.' };

  if ((ext === 'xlsx' || ext === 'xlsm') && has(name, BANK_NAME) && !has(name, REGISTRAR_NAME))
    return {
      kind: 'bank',
      confident: true,
      message: 'The file name looks like a bank statement download, so its lines are read.',
    };
  if (ext === 'xlsx' || ext === 'xlsm')
    return {
      kind: 'workbook',
      confident: true,
      message: 'This is an Excel workbook, so it is read as your banks, savings and deposits.',
    };
  if (ext === 'xls' && BANK_HEAD.test(head))
    return {
      kind: 'bank',
      confident: true,
      message:
        'This has a bank statement’s columns (narration, withdrawal, deposit, balance), so its lines are read.',
    };
  if (ext === 'xls')
    return {
      kind: null,
      confident: false,
      message:
        'This is an old Excel file. Open it in Excel, choose Save As, pick .xlsx and choose that file.',
    };

  if (ext === 'csv') {
    const first =
      head
        .split(/\r?\n/)
        .find((l) => l.trim() !== '')
        ?.toLowerCase() ?? '';
    if (BANK_HEAD.test(head))
      return {
        kind: 'bank',
        confident: true,
        message:
          'This has a bank statement’s columns (narration, withdrawal, deposit, balance), so its lines are read.',
      };
    if (/folio/.test(first) && /(units|nav|amount)/.test(first))
      return {
        kind: 'csv',
        confident: true,
        message:
          'The first line has Folio, Units and Amount columns, so this is a fund transactions export.',
      };
    return {
      kind: 'csv',
      confident: false,
      message:
        'This is a CSV file, but its first line does not look like a fund transactions export (it should have Folio, Units and Amount columns). Confirm below if it is one.',
    };
  }

  if (ext === 'pdf') {
    if (has(name, TAX_NAME))
      return {
        kind: 'tax',
        confident: true,
        message: 'The file name says Form 26AS or AIS, so this is read as a tax statement.',
      };
    if (has(name, BANK_NAME) && !has(name, REGISTRAR_NAME))
      return {
        kind: 'bank',
        confident: false,
        message:
          'The file name looks like a bank statement. Confirm below, or choose a fund statement if it is one.',
      };
    if (has(name, CAS_NAME))
      return {
        kind: 'cas',
        confident: true,
        message:
          'The file name looks like a fund statement from a registrar, so this is read as one.',
      };
    return {
      kind: null,
      confident: false,
      message:
        'This is a PDF, and its name does not say which kind. Choose below: a fund statement, a tax statement or a bank statement.',
    };
  }

  if (ext === 'json')
    return {
      kind: 'tax',
      confident: true,
      message:
        'A JSON file downloaded from the income-tax portal is the Annual Information Statement.',
    };

  if (ext === 'txt' || ext === 'htm' || ext === 'html') {
    if (BANK_HEAD.test(head))
      return {
        kind: 'bank',
        confident: true,
        message: 'This has a bank statement’s columns, so its lines are read.',
      };
    if (
      /26as|annual tax statement|traces|tax deducted at source/i.test(head) ||
      has(name, TAX_NAME)
    )
      return {
        kind: 'tax',
        confident: true,
        message: 'This looks like Form 26AS saved as text or a web page.',
      };
    return {
      kind: null,
      confident: false,
      message:
        'This text or web page does not say what it is. If it is Form 26AS, choose a tax statement below.',
    };
  }

  return {
    kind: null,
    confident: false,
    message:
      'This kind of file is not one the app can read. Use an Excel workbook (.xlsx), a fund statement (.pdf), a fund app export (.csv) or a tax statement (.pdf, .json, .txt, .html).',
  };
}

/**
 * What to do with several files chosen together. Fund exports can be imported together (one per person); anything else is
 * taken one file at a time so the right form, person and password are shown for each.
 */
export function detectMany(files: { name: string; size: number; head: string }[]): {
  kind: ImportKind | null;
  confident: boolean;
  message: string;
  pick: number;
} {
  if (files.length === 0) return { kind: null, confident: false, message: '', pick: -1 };
  const each = files.map((f) => detectImport(f, f.head));
  if (files.length === 1) return { ...each[0]!, pick: 0 };
  const allCsv = each.every((d) => d.kind === 'csv');
  if (allCsv)
    return {
      kind: 'csv',
      confident: each.every((d) => d.confident),
      message: `${files.length} CSV files: they are imported together, one person per file.`,
      pick: 0,
    };
  return {
    kind: null,
    confident: false,
    message:
      'Several different files were chosen. Choose one file at a time (several fund exports in CSV can go together).',
    pick: -1,
  };
}

/** The first name in a file name ("Rupash__Advika_-_transactions.csv") matched against the people's names. */
export function guessOwner(file: string, owners: { id: string; name: string }[]): string {
  const first =
    file
      .toLowerCase()
      .split(/[^a-z]+/)
      .find(Boolean) ?? '';
  return owners.find((o) => first && o.name.toLowerCase().startsWith(first))?.id ?? '';
}

const COUNT_WORDS: Record<string, string> = {
  owners: 'people',
  institutions: 'banks',
  assets: 'accounts and holdings',
  observations: 'balances',
};

/** The import summary uses internal names ("observations"); this gives the plain word for a count. */
export const plainCountName = (key: string): string => COUNT_WORDS[key] ?? key;
