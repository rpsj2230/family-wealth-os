/** Invented deposits for the public sample of the Reports page. Nothing here is real. */
import type { ReportFd } from '@fwos/core';

export const DEMO_REPORT_TODAY = '2026-10-26';

const fd = (
  id: string,
  bank: string,
  owner: string,
  kind: string,
  principal: number,
  rate: number,
  bookedOn: string,
  maturityOn: string,
  maturityAmount: number,
): ReportFd => ({
  id,
  bank,
  owner,
  kind,
  principal,
  rate,
  bookedOn,
  maturityOn,
  maturityAmount,
  compounding: 'quarterly',
});

export const DEMO_REPORT_FDS: ReportFd[] = [
  fd('d1', 'Sample Bank', 'Anil', 'NRE', 1_000_000, 0.0725, '2025-05-12', '2026-11-01', 1_110_000),
  fd('d2', 'Sample Bank', 'Anil', 'NRE', 500_000, 0.0725, '2025-05-12', '2026-11-01', 555_000),
  fd('d3', 'Other Bank', 'Beena', 'NRO', 1_600_000, 0.0775, '2024-11-16', '2026-11-16', 1_865_000),
  fd('d4', 'Other Bank', 'Beena', 'NRO', 466_300, 0.0775, '2024-12-02', '2026-12-02', 549_000),
  fd('d5', 'Third Bank', 'Anil', 'NRE', 500_000, 0.0725, '2025-10-28', '2027-01-15', 547_000),
  fd('d6', 'Third Bank', 'Anil', 'NRE', 900_000, 0.075, '2025-01-29', '2028-01-29', 1_080_000),
  fd('d7', 'Sample Bank', 'Beena', 'NRO', 613_560, 0.0775, '2025-09-26', '2028-03-02', 733_000),
  fd('d8', 'Other Bank', 'Anil', 'NRE', 1_000_000, 0.0775, '2026-09-08', '2028-03-08', 1_112_000),
  fd('d9', 'Third Bank', 'Beena', 'NRO', 1_300_000, 0.0725, '2023-11-15', '2028-11-15', 1_546_000),
  fd('d10', 'Sample Bank', 'Anil', 'NRE', 2_000_000, 0.0725, '2024-03-15', '2029-03-15', 2_402_000),
  fd('d11', 'Other Bank', 'Beena', 'NRO', 1_000_000, 0.0725, '2024-09-15', '2029-09-15', 1_268_000),
  fd('d12', 'Third Bank', 'Anil', 'NRE', 500_000, 0.07, '2025-10-26', '2030-10-26', 742_000),
];
