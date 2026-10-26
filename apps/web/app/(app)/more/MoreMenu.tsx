import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { PageHead } from '@/components/PageHead';
import { SetupChecklist, type SetupChecklistItem } from '@/components/SetupChecklist';
import { MENU } from '@/lib/menu';
import './more.css';

/** Everything that is not in the phone's bottom bar, grouped by what you are doing. Plain props, so a sample page can show it. */
export function MoreMenu({
  signOut,
  setup,
}: {
  signOut: () => Promise<void>;
  setup?: SetupChecklistItem[] | undefined;
}) {
  const open = setup?.filter((i) => !i.done).length ?? 0;
  return (
    <>
      <PageHead
        title="More"
        subtitle="Everything that is not in the bottom bar, grouped by what you are doing."
      />
      {setup && open > 0 && <SetupChecklist items={setup} compact max={3} />}
      {MENU.map((g) => (
        <section
          key={g.title}
          className="menugroup"
          aria-labelledby={`menu-${g.title.replace(/\W+/g, '-')}`}
        >
          <h2 id={`menu-${g.title.replace(/\W+/g, '-')}`}>{g.title}</h2>
          <ul className="menulist">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className="menuitem">
                  <i.icon aria-hidden />
                  <span>
                    <strong>{i.label}</strong>
                    <span className="menuhint">{i.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <form action={signOut} className="menusign">
        <button className="btn ghost" type="submit">
          <LogOut aria-hidden size={16} /> Sign out
        </button>
      </form>
    </>
  );
}
