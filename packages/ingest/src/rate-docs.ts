/**
 * Where a bank's rates can be read when its ordinary web page cannot be (it blocks automated visits or builds its table with a
 * script). Only openly published documents and pages are listed: the bank's own rate-sheet PDFs, and, as a last resort, public
 * comparison pages, which are always labelled as third-party so the dates can be checked. Nothing here disguises the program
 * as a browser or gets around a block.
 */
import { sameBank } from '@fwos/core';

export interface RateDoc {
  url: string;
  /** what the document is, passed to the reader with its text */
  label: string;
}

export interface RateDocs {
  /** the bank's own papers: read together with the saved page, when it can be read */
  official: RateDoc[];
  /** public third-party pages: tried only when nothing from the bank could be read */
  reference: RateDoc[];
}

const TABLE: { bank: string; docs: RateDocs }[] = [
  {
    bank: 'AU Small Finance Bank',
    docs: {
      official: [
        {
          url: 'https://www.au.bank.in/content-fragmnets/pdf/service-fees/Rates-at-a-Glance.pdf',
          label:
            'AU Small Finance Bank, official "Rates at a Quick Glance" sheet (savings account interest, domestic and NRE/NRO)',
        },
        {
          url: 'https://www.au.bank.in/notice-board-language/domestic-nre-nro-retail-fd-rates/English.pdf',
          label:
            'AU Small Finance Bank, official retail fixed deposit rate sheet. Its table applies to domestic, NRE (12 months and above) and NRO deposits; use the non-senior-citizen columns',
        },
      ],
      reference: [],
    },
  },
  {
    bank: 'Equitas Small Finance Bank',
    docs: {
      official: [],
      reference: [
        {
          url: 'https://www.bankbazaar.com/fixed-deposit/equitas-small-finance-bank-fixed-deposit-rate.html',
          label: 'BankBazaar page on Equitas fixed deposit rates (third party)',
        },
        {
          url: 'https://www.policybazaar.com/financial-planning/fixed-deposit/equitas-small-finance-bank-fd-rates/',
          label: 'Policybazaar page on Equitas fixed deposit rates (third party)',
        },
      ],
    },
  },
  {
    bank: 'Yes Bank',
    docs: {
      official: [],
      reference: [
        {
          url: 'https://www.bankbazaar.com/fixed-deposit/yes-bank-nri-fd-rates.html',
          label: 'BankBazaar page on Yes Bank NRI fixed deposit rates (third party)',
        },
        {
          url: 'https://www.policybazaar.com/financial-planning/fixed-deposit/yes-bank-nri-fd-rates/',
          label: 'Policybazaar page on Yes Bank NRI fixed deposit rates (third party)',
        },
      ],
    },
  },
  {
    bank: 'ESAF Small Finance Bank',
    docs: {
      official: [],
      reference: [
        {
          url: 'https://www.bankbazaar.com/fixed-deposit/esaf-small-finance-bank-fixed-deposit-rate.html',
          label: 'BankBazaar page on ESAF fixed deposit rates (third party)',
        },
        {
          url: 'https://www.policybazaar.com/financial-planning/fixed-deposit/esaf-small-finance-bank-fd-rates/',
          label: 'Policybazaar page on ESAF fixed deposit rates (third party)',
        },
      ],
    },
  },
  {
    bank: 'HDFC Bank',
    docs: {
      official: [],
      reference: [
        {
          url: 'https://www.bankbazaar.com/fixed-deposit/hdfc-nri-fd-rates.html',
          label: 'BankBazaar page on HDFC Bank NRI fixed deposit rates (third party)',
        },
      ],
    },
  },
  {
    bank: 'IDFC First Bank',
    docs: {
      official: [],
      reference: [
        {
          url: 'https://www.bankbazaar.com/fixed-deposit/idfc-nri-fd-rates.html',
          label:
            'BankBazaar page on IDFC FIRST Bank NRI fixed deposit rates (third party; may be older)',
        },
        {
          url: 'https://www.policybazaar.com/financial-planning/fixed-deposit/idfc-bank-fd-rates/',
          label:
            'Policybazaar page on IDFC FIRST Bank fixed deposit rates, domestic, NRO and NRE (third party)',
        },
      ],
    },
  },
  {
    bank: 'IndusInd Bank',
    docs: {
      official: [],
      reference: [
        {
          url: 'https://www.bankbazaar.com/fixed-deposit/indusind-bank-nri-fd-rates.html',
          label: 'BankBazaar page on IndusInd Bank NRI fixed deposit rates (third party)',
        },
        {
          url: 'https://www.policybazaar.com/financial-planning/fixed-deposit/indusind-bank-fd-rates/',
          label: 'Policybazaar page on IndusInd Bank fixed deposit rates (third party)',
        },
      ],
    },
  },
  {
    bank: 'RBL Bank',
    docs: {
      official: [],
      reference: [
        {
          url: 'https://www.bankbazaar.com/fixed-deposit/rbl-bank-nri-fd-rates.html',
          label: 'BankBazaar page on RBL Bank NRI fixed deposit rates (third party)',
        },
        {
          url: 'https://www.policybazaar.com/financial-planning/fixed-deposit/rbl-bank-fd-rates/',
          label: 'Policybazaar page on RBL Bank fixed deposit rates (third party)',
        },
      ],
    },
  },
];

export function rateDocsFor(bank: string): RateDocs {
  return TABLE.find((t) => sameBank(t.bank, bank))?.docs ?? { official: [], reference: [] };
}

export const isPdf = (contentType: string | null, url: string): boolean =>
  /pdf/i.test(contentType ?? '') || /\.pdf(\?|$)/i.test(url);
