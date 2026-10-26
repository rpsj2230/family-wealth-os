export const LIQUIDITY_KINDS = [
  'cash',
  'fd_maturing',
  'fd_break',
  'mf',
  'stock',
  'receivable',
  'property',
] as const;
export type LiquidityKind = (typeof LIQUIDITY_KINDS)[number];

export const KIND_LABEL: Record<LiquidityKind, string> = {
  cash: 'Cash in bank accounts',
  fd_maturing: 'Deposits that mature in time',
  fd_break: 'Break a deposit early',
  mf: 'Mutual funds',
  stock: 'Shares',
  receivable: 'Money lent out',
  property: 'Property',
};
