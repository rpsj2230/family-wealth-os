import Link from 'next/link';

/**
 * Tabs that are links (like Tabs) and also carry other address parameters along, so switching tab keeps the amount you typed.
 * `keep` holds the parameters to carry; empty ones are dropped.
 */
export function ParamTabs({
  base,
  current,
  tabs,
  keep = {},
  param = 'tab',
  label = 'Sections',
}: {
  base: string;
  current: string;
  tabs: { key: string; label: string; badge?: string | number | null }[];
  keep?: Record<string, string | undefined>;
  param?: string;
  label?: string;
}) {
  const href = (key: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep))
      if (v !== undefined && v !== '' && k !== param) q.set(k, v);
    q.set(param, key);
    return `${base}?${q.toString()}`;
  };
  return (
    <nav className="tabs2" aria-label={label}>
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={href(t.key)}
          className={`tab2 ${current === t.key ? 'on' : ''}`}
          aria-current={current === t.key ? 'page' : undefined}
          scroll={false}
        >
          {t.label}
          {t.badge !== null && t.badge !== undefined && t.badge !== 0 && (
            <span className="tab2-badge">{t.badge}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
