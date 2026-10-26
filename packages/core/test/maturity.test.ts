import { describe, expect, it } from 'vitest';
import { maturityAlerts, overdueMaturities } from '../src/maturity';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d('2026-10-26');
const fds = [
  { id: 'yes1', name: 'Yes Rupash', maturityOn: d('2026-11-01'), status: 'active' },
  { id: 'indus', name: 'IndusInd Rupash', maturityOn: d('2026-11-16'), status: 'active' },
  { id: 'jana', name: 'Jana NRO', maturityOn: d('2026-12-02'), status: 'active' },
  { id: 'esaf', name: 'ESAF NRO', maturityOn: d('2027-01-15'), status: 'active' },
  { id: 'far', name: 'Equitas', maturityOn: d('2027-10-16'), status: 'active' },
  { id: 'rbl', name: 'RBL', maturityOn: d('2026-09-23'), status: 'active' },
  { id: 'closed', name: 'Closed', maturityOn: d('2026-11-03'), status: 'closed' },
];

describe('maturityAlerts', () => {
  it('buckets upcoming FDs into 7/15/30/60/90-day windows, soonest first', () => {
    const a = maturityAlerts(fds, today);
    expect(a.map((x) => [x.id, x.daysLeft, x.window])).toEqual([
      ['yes1', 6, 7],
      ['indus', 21, 30],
      ['jana', 37, 60],
      ['esaf', 81, 90],
    ]);
  });
  it('ignores closed FDs and those beyond 90 days', () => {
    const ids = maturityAlerts(fds, today).map((x) => x.id);
    expect(ids).not.toContain('closed');
    expect(ids).not.toContain('far');
  });
  it('finds FDs that matured but are still marked active (needs confirmation)', () => {
    expect(overdueMaturities(fds, today).map((x) => x.id)).toEqual(['rbl']);
  });
});
