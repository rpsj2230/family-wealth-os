import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MENU, routeOf } from './menu';
import { SETTINGS_TABS } from './settings-tabs';

const appDir = fileURLToPath(new URL('../app/(app)/', import.meta.url));

describe('the More menu', () => {
  const all = MENU.flatMap((g) => g.items);

  it('every entry opens a page that exists', () => {
    for (const i of all)
      expect(existsSync(`${appDir}${routeOf(i.href)}/page.tsx`), i.href).toBe(true);
  });

  it('no address is listed twice and every entry says what it is for', () => {
    expect(new Set(all.map((i) => i.href)).size).toBe(all.length);
    for (const i of all) {
      expect(i.label.length).toBeGreaterThan(2);
      expect(i.hint.length).toBeGreaterThan(15);
    }
  });

  it('leaves out what the phone’s bottom bar already has', () => {
    for (const bar of ['/', '/accounts', '/monthly', '/investments'])
      expect(all.map((i) => i.href)).not.toContain(bar);
  });

  it('settings entries point at real sections', () => {
    const keys = SETTINGS_TABS.map((t) => t.key as string);
    for (const i of all.filter((x) => x.href.startsWith('/settings?tab='))) {
      expect(keys).toContain(i.href.split('=')[1]);
    }
  });
});
