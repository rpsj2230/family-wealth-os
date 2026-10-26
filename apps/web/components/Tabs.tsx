import Link from 'next/link';

/** Tabs that are links, so each view has its own address and the back button works. */
export function Tabs({
  base,
  current,
  tabs,
  param = 'tab',
  keep,
}: {
  base: string;
  current: string;
  tabs: { key: string; label: string; badge?: string | number | null }[];
  param?: string;
  /** other query values to carry along, such as the person being shown */
  keep?: Record<string, string>;
}) {
  const href = (key: string) => {
    const q = new URLSearchParams(keep);
    q.set(param, key);
    return `${base}?${q.toString()}`;
  };
  return (
    <nav className="tabs2" aria-label="Sections">
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
