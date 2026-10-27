/**
 * Where a bank's rates are read from: the page address saved for the bank in Settings, plus the bank's own published pages and PDFs
 * listed here. Nothing else is ever read: no comparison or aggregator site. Every address below must belong to the bank's own domains
 * (`isOfficialHost`, checked by a test). A page a program cannot open is reported plainly and is never worked around.
 *
 * A bank that rotates its rate PDF (a new address each time the rates change) is listed by the page that links to it and the words on
 * the link ("Interest Rates"); the reader finds the link in that page's own text and reads the document it points to. The link must
 * lead to the bank's own domain.
 */
import { sameBank, type DocKind } from '@fwos/core';
import type { LinkSpec } from './rate-links';

/** One document at a fixed address. */
export interface RateDoc {
  url: string;
  /** what the document is and which column or table applies, passed to the reader with its text */
  label: string;
  /** which rates it carries (default both): the reader takes only that kind from it */
  kind?: DocKind;
  /** read from the first place in the text that matches this (a long page with the rate table far down) */
  from?: RegExp;
  /** most characters of text kept (default 14,000) */
  max?: number;
}

/** A document found by following a link on one of the bank's own pages. */
export interface RateLinkDoc {
  /** the bank's page that carries the link */
  page: string;
  /** the link is the anchor whose words (visible text, aria-label, title, the row it sits in) match `text` and whose address matches `href` (both, when both are given) */
  link: LinkSpec;
  kind?: DocKind;
  /** the name of the link as a person sees it ("Interest Rates"), for the messages */
  linkName: string;
  label: string;
  /** read the document from the first place in its text that matches this */
  from?: RegExp;
  max?: number;
}

export type OfficialDoc = RateDoc | RateLinkDoc;

export const isLinkDoc = (d: OfficialDoc): d is RateLinkDoc => 'page' in d;

export interface RateDocs {
  /** the bank's own papers: read together with the saved page */
  official: OfficialDoc[];
  /** the bank's own domains; every address read for the bank must be on one of them */
  domains: string[];
}

const TABLE: { bank: string; docs: RateDocs }[] = [
  {
    bank: 'AU Small Finance Bank',
    docs: {
      domains: ['au.bank.in', 'aubank.in'],
      official: [
        {
          url: 'https://www.au.bank.in/content-fragmnets/pdf/service-fees/Rates-at-a-Glance.pdf',
          label:
            'AU Small Finance Bank, official "Rates at a Quick Glance" sheet (savings account interest, domestic and NRE/NRO)',
        },
        {
          url: 'https://www.au.bank.in/notice-board-language/domestic-nre-nro-retail-fd-rates/English.pdf',
          kind: 'fd',
          label:
            'AU Small Finance Bank, official retail fixed deposit rate sheet. Its table applies to domestic, NRE (12 months and above) and NRO deposits; use the non-senior-citizen columns',
        },
      ],
    },
  },
  {
    bank: 'Equitas Small Finance Bank',
    docs: {
      domains: ['equitas.bank.in', 'equitasbank.com'],
      // the rate PDF sits behind the "Interest Rates" button and its address changes: it is found on the page each time
      official: [
        {
          page: 'https://equitas.bank.in/nri-banking/',
          link: { text: /interest\s+rates/i },
          linkName: 'Interest Rates',
          label:
            'Equitas Small Finance Bank, official interest rate sheet (opened from the "Interest Rates" button on its NRI banking page). Use the table for deposits below ₹3 crore, general public; it applies to NRE (12 months and above) and NRO deposits',
        },
        {
          page: 'https://equitas.bank.in/nri-banking/save/nri-fixed-deposits/nre-rupee-fixed-deposit/',
          link: { text: /interest\s+rates/i },
          linkName: 'Interest Rates',
          label:
            'Equitas Small Finance Bank, official interest rate sheet (opened from the "Interest Rates" link on its NRE fixed deposit page). Use the table for deposits below ₹3 crore, general public; it applies to NRE (12 months and above) and NRO deposits',
        },
        {
          url: 'https://equitas.bank.in/nri-banking/save/nri-fixed-deposits/nre-rupee-fixed-deposit/',
          label:
            'Equitas Small Finance Bank, official NRE rupee fixed deposit page. Use the table for deposits below ₹3 crore, general public, and its "effective from" date',
        },
      ],
    },
  },
  {
    bank: 'Yes Bank',
    docs: {
      domains: ['yes.bank.in', 'yesbank.in'],
      official: [
        {
          url: 'https://www.yes.bank.in/sites/web/content/published/api/v1.1/assets/CONT13C66A7E18434B48BC40248F6202F4A4/native/allratesandcharges_pdf.pdf?download=false',
          label:
            'YES BANK, official "Savings & Fixed Deposit: interest rate at a quick glance" sheet. Savings table: balance slabs for domestic and non-resident accounts. Fixed deposit table: domestic and NRO deposits below ₹3 crore, use the Regular column (the Senior Citizen column does not apply to NRE or NRO); ignore the MIBOR-linked and larger-deposit tables',
          max: 12_000,
        },
      ],
    },
  },
  {
    bank: 'ESAF Small Finance Bank',
    docs: {
      domains: ['esaf.bank.in', 'esafbank.com'],
      official: [
        {
          url: 'https://www.esaf.bank.in/interest-rates/',
          label:
            'ESAF Small Finance Bank, official interest rates page (sections for resident, NRO, NRE and FCNR(B) term deposits and savings accounts, each with an "effective from" date). Use the NRE term deposit table (deposits below ₹300 lakh) for NRE fixed deposits and the NRO table for NRO; for savings use the savings bank account slab table',
        },
      ],
    },
  },
  {
    bank: 'HDFC Bank',
    docs: {
      domains: ['hdfcbank.com', 'hdfc.bank.in'],
      // the bank's own pages: the fixed deposit page carries its rate tables in the page itself (inside escaped markup), and the rates hub lists the
      // savings account slabs. They are read together with the page saved in Settings.
      official: [
        {
          url: 'https://www.hdfcbank.com/personal/save/deposits/fixed-deposit-interest-rate',
          kind: 'fd',
          label:
            'HDFC Bank, official fixed deposit rate page. The tables for deposits below ₹3 crore apply to domestic, NRO and NRE (NRE from 1 year) deposits; use the general-public column and ignore the ₹3 crore and above table',
        },
        {
          url: 'https://www.hdfcbank.com/personal/resources/rates',
          kind: 'savings',
          label:
            'HDFC Bank, official rates page (deposits, savings account interest rates and others). Use only the savings account interest rate slabs here',
        },
      ],
    },
  },
  {
    bank: 'IDFC First Bank',
    docs: {
      domains: ['idfcfirst.bank.in', 'idfcfirstbank.com'],
      // the rates hub lists one row per product with a "Read" link; the fixed deposit row leads to a PDF whose address changes with each
      // revision, so it is found on the hub every time. A "Bulk" row (₹3 crore and above) is never preferred.
      official: [
        {
          page: 'https://www.idfcfirst.bank.in/interest-rate',
          link: { text: /Deposit Interest Rate\s*\(\s*Domestic,\s*NRE,\s*NRO\s*\)/i },
          linkName: 'Fixed Deposit Interest Rate (Domestic, NRE, NRO)',
          kind: 'fd',
          label:
            'IDFC FIRST Bank, official fixed deposit interest rates (deposits below ₹3 crore; they apply to domestic, NRO and NRE, NRE from 1 year). Use the General column',
        },
        {
          page: 'https://www.idfcfirst.bank.in/interest-rate',
          link: { text: /NRI\s+Savings\s+Account\s+Interest\s+Rate/i },
          linkName: 'NRI Savings Account Interest Rate',
          kind: 'savings',
          label:
            'IDFC FIRST Bank, official NRI savings account interest rates (NRE and NRO, balance slabs)',
          from: /Balance\s*\(₹\)/i,
          max: 3_000,
        },
      ],
    },
  },
  {
    bank: 'IndusInd Bank',
    docs: {
      domains: ['indusind.bank.in', 'indusind.com'],
      official: [
        {
          url: 'https://www.indusind.bank.in/in/en/personal/fixed-deposit-interest-rate.html',
          kind: 'fd',
          label:
            'IndusInd Bank, official fixed deposit interest rate page. The table for deposits below ₹3 crore applies to domestic (resident), NRE and NRO deposits (NRE from 1 year); use the first Rate column and ignore the Senior Citizen column, which does not apply to NRE or NRO',
          from: /Term Deposit Interest Rates revision/i,
          max: 6_000,
        },
        {
          url: 'https://www.indusind.bank.in/in/en/personal/accounts/savings-account-interest-rate.html',
          kind: 'savings',
          label:
            'IndusInd Bank, official savings account interest rate page (daily balance slabs; ignore the MIBOR-linked rows)',
          from: /Daily balance upto/i,
          max: 3_000,
        },
      ],
    },
  },
  {
    bank: 'RBL Bank',
    docs: {
      domains: ['rblbank.com', 'rbl.bank.in'],
      official: [
        {
          url: 'https://rblbank.com/interest-rates/savings',
          label:
            'RBL Bank, official interest rates page. The savings table (balance slabs, includes NRE and NRO savings) and the fixed deposit table for deposits below ₹3 crore, premature withdrawal allowed (it applies to domestic, NRO and NRE deposits, NRE from 1 year; use the General Citizen column, the Senior Citizen columns do not apply to NRIs). Ignore recurring deposits and the larger-deposit tables',
          max: 16_000,
        },
      ],
    },
  },
];

export function rateDocsFor(bank: string): RateDocs {
  return TABLE.find((t) => sameBank(t.bank, bank))?.docs ?? { official: [], domains: [] };
}

/** Whether a web address belongs to one of the bank's own domains (the domain itself or a sub-domain of it). */
export function isOfficialHost(bank: string, host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  return rateDocsFor(bank).domains.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Every bank the registry knows, for tests. */
export const registeredBanks = (): string[] => TABLE.map((t) => t.bank);

export const isPdf = (contentType: string | null, url: string): boolean =>
  /pdf/i.test(contentType ?? '') || /\.pdf(\?|$)/i.test(url);
