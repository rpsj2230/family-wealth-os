export const LIQUIDITY_KINDS = [
  'cash',
  'fd_maturing',
  'fd_recent',
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
  fd_recent: 'Recently added deposits (little lost if broken)',
  fd_break: 'Break an older deposit early',
  mf: 'Mutual funds',
  stock: 'Shares',
  receivable: 'Money lent out',
  property: 'Property',
};
