import { describe, expect, it } from 'vitest';
import { sipKey } from '@fwos/core';
import { demoFundPreview } from './demo-fund-import';
import { appendSelection, isTaken, selectableKeys, selectionOf } from './fund-import-select';

const people = demoFundPreview();
const [anil, beena] = people;
const key = (p: typeof anil, name: string) => p!.diff.items.find((i) => i.name.includes(name))!.key;

describe('what can be ticked in a preview', () => {
  it('lists a tick for each changed fund and each SIP verdict, and none for an unchanged fund', () => {
    const keys = selectableKeys(people);
    expect(keys).toContain(key(anil, 'Flexi'));
    expect(keys).toContain(sipKey(key(anil, 'Large Cap')));
    expect(keys).toContain(sipKey(key(anil, 'Index')));
    expect(keys).toContain(key(anil, 'Old Fund'));
    expect(keys).toContain(key(beena, 'Mid Cap'));
    expect(keys).not.toContain(key(anil, 'Balanced'));
    expect(keys).not.toContain(key(beena, 'Gilt'));
  });

  it('starts with everything ticked', () => {
    const s = selectionOf(people, new Set());
    expect(s.take).toEqual(s.seen);
    expect(s.count).toBe(5);
  });

  it('unticking a SIP verdict leaves the fund ticked, and the other way round', () => {
    const stop = sipKey(key(anil, 'Large Cap'));
    const s = selectionOf(people, new Set([stop]));
    expect(s.take).not.toContain(stop);
    expect(s.seen).toContain(stop); // shown, not taken: remembered as overruled when applied
    const flexi = key(anil, 'Flexi');
    const t = selectionOf(people, new Set([flexi]));
    expect(t.take).not.toContain(flexi);
  });

  it('a new fund brings its SIP with it: unticking the fund unticks the SIP too', () => {
    const fund = key(beena, 'Mid Cap');
    const sip = sipKey(fund);
    expect(isTaken(people, new Set(), sip)).toBe(true);
    expect(isTaken(people, new Set([fund]), sip)).toBe(false);
    // a SIP of an ordinary fund does not depend on the fund being ticked
    const flexi = key(anil, 'Flexi');
    const large = key(anil, 'Large Cap');
    expect(isTaken(people, new Set([large]), sipKey(large))).toBe(true);
    expect(isTaken(people, new Set([flexi]), sipKey(large))).toBe(true);
  });

  it('writes the selection into a form the way the apply step reads it', () => {
    const fd = new FormData();
    appendSelection(fd, selectionOf(people, new Set([key(anil, 'Old Fund')])));
    expect(fd.getAll('seen')).toContain(key(anil, 'Old Fund'));
    expect(fd.getAll('take')).not.toContain(key(anil, 'Old Fund'));
    expect(fd.getAll('take')).toContain(key(anil, 'Flexi'));
  });
});
