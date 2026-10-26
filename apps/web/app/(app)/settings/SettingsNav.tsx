'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { SETTINGS_TABS, tabForAnchor, type SettingsTab } from '@/lib/settings-tabs';

/**
 * The list of Settings sections: a strip you can scroll sideways on a phone, a list down the left side on a wide screen.
 * Each section is a link with its own address (?tab=), so the back button and bookmarks work.
 * `todo` is how many open items the Setup checklist has for that section.
 */
export function SettingsNav({
  base = '/settings',
  current,
  todo = {},
}: {
  base?: string;
  current: SettingsTab;
  todo?: Partial<Record<SettingsTab, number>>;
}) {
  return (
    <nav className="setnav" aria-label="Settings sections">
      {SETTINGS_TABS.map((t) => {
        const n = todo[t.key] ?? 0;
        return (
          <Link
            key={t.key}
            href={`${base}?tab=${t.key}`}
            className={`setnav-item ${current === t.key ? 'on' : ''}`}
            aria-current={current === t.key ? 'page' : undefined}
            scroll={false}
          >
            <span>{t.label}</span>
            {n > 0 && (
              <span className="setnav-badge" title={`${n} to do`}>
                {n}
                <span className="sr-only"> to do</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Older links such as /settings#tax or /settings#email point at a part of what used to be one long page. A server cannot see
 * the part after the #, so this moves the visit to the section that holds it now, and scrolls to it.
 */
export function AnchorRedirect({ base = '/settings' }: { base?: string }) {
  const router = useRouter();
  const tab = useSearchParams().get('tab');
  useEffect(() => {
    const go = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
      if (!id) return;
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView();
        return;
      }
      const target = tabForAnchor(id);
      if (target) router.replace(`${base}?tab=${target}#${id}`);
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [base, router, tab]);
  return null;
}
