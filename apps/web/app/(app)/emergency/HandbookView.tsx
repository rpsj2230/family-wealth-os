import Link from 'next/link';
import { Phone } from 'lucide-react';
import type { Handbook } from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import { handbookPages, incompleteNote, type CallRow } from '@/lib/handbook-view';
import { PrintButton } from './PrintButton';
import './emergency.css';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Singapore',
  });

function People({ rows, label }: { rows: CallRow[]; label: string }) {
  return (
    <ul className="hb-people" aria-label={label}>
      {rows.map((c, i) => (
        <li key={`${c.name}-${i}`}>
          <span className="hb-order" aria-hidden>
            {i + 1}
          </span>
          <div className="hb-who">
            <strong>{c.name}</strong>
            {c.relation && <span className="hb-rel">{c.relation}</span>}
            {c.note && <span className="hb-note">{c.note}</span>}
          </div>
          {c.tel ? (
            <a className="hb-phone" href={c.tel}>
              <Phone aria-hidden size={18} />
              {c.phone}
            </a>
          ) : (
            <span className="hb-phone plain">{c.phone || 'no number written down'}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * The family handbook for someone who is upset and in a hurry: what to do first, who to call, where things are, in large type
 * on a first page that prints on its own; everything else follows as reference. Read-only, and the same for the owner and
 * the read-only family login. `refresh` and `settingsHref` are given only to household members.
 */
export function HandbookView({
  doc,
  generatedAt,
  refresh,
  settingsHref,
  accessNote,
}: {
  doc: Handbook;
  generatedAt: string;
  refresh?: (() => Promise<void>) | undefined;
  settingsHref?: string | undefined;
  accessNote?: string | undefined;
}) {
  const p = handbookPages(doc);
  const gap = incompleteNote(p);
  return (
    <div className="hb">
      <PageHead
        title={doc.title}
        subtitle={`Written from the family’s records. Last updated ${when(generatedAt)}.`}
        actions={
          <div className="noprint row">
            {refresh && (
              <form action={refresh}>
                <button className="btn">Update now</button>
              </form>
            )}
            <PrintButton />
          </div>
        }
      />
      <p className="notice warn small hb-disclaimer">{doc.disclaimer}</p>

      {settingsHref && (
        <div className="noprint hb-owner" role="note">
          {gap && (
            <p className="notice warn small">
              {gap} Add them in <Link href={settingsHref}>Settings &gt; Emergency and access</Link>;
              the handbook rewrites itself.
            </p>
          )}
          {accessNote && <p className="muted small">{accessNote}</p>}
        </div>
      )}

      <nav className="chipbar small noprint" aria-label="Sections">
        <a className="fchip" href="#start">
          1. What to do first
        </a>
        <a className="fchip" href="#call">
          2. Who to call
        </a>
        <a className="fchip" href="#where">
          3. Where things are
        </a>
        {p.rest.map((s, i) => (
          <a key={s.id} className="fchip" href={`#${s.id}`}>
            {i + 4}. {s.title}
          </a>
        ))}
      </nav>

      <div className="hb-page1">
        <section className="card hb-start" id="start" aria-labelledby="hb-start-h">
          <h2 id="hb-start-h">1. What to do first</h2>
          {p.start.message.map((m, k) => (
            <p key={k} className="hb-message">
              {m}
            </p>
          ))}
          <ol className="hb-steps">
            {p.start.steps.map((t, k) => (
              <li key={k}>
                <span className="hb-num" aria-hidden>
                  {k + 1}
                </span>
                <span>{t}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="card hb-call" id="call" aria-labelledby="hb-call-h">
          <h2 id="hb-call-h">2. Who to call, in this order</h2>
          {p.noContacts ? (
            <p className="empty">
              No one has been written down yet. Ask a trusted adult in the family, or look at the
              paper copy of this handbook.
            </p>
          ) : (
            <People rows={p.call} label="People to call first" />
          )}
          {p.advisers.length > 0 && (
            <>
              <h3>Advisers: lawyer, accountant, agents</h3>
              <People rows={p.advisers} label="Advisers" />
            </>
          )}
        </section>

        <section className="card hb-where" id="where" aria-labelledby="hb-where-h">
          <h2 id="hb-where-h">3. Where things are</h2>
          <dl className="hb-dl">
            {p.where.map((w) => (
              <div key={w.what} className={w.missing ? 'is-missing' : ''}>
                <dt>{w.what}</dt>
                <dd>{w.missing ? 'Not written down yet' : w.where}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <h2 className="hb-ref">Everything else, for reference</h2>
      {p.rest.map((s, i) => (
        <section className="card handbook" id={s.id} key={s.id}>
          <h3 className="hb-sec">
            {i + 4}. {s.title}
          </h3>
          {s.intro && <p className="muted">{s.intro}</p>}
          {s.paragraphs?.map((t, k) => (
            <p key={k}>{t}</p>
          ))}
          {s.steps && (
            <ol className="steps">
              {s.steps.map((t, k) => (
                <li key={k}>
                  <span className="box" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          )}
          {s.tables?.map((t, k) => (
            <div key={k}>
              {t.title && <h4>{t.title}</h4>}
              <div className="xlwrap">
                <table className="xl hb-table">
                  <thead>
                    <tr>
                      {t.table.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.table.rows.map((r, a) => (
                      <tr key={a} className="xlrow">
                        {r.map((c, b) => (
                          <td key={b}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {t.table.note && <p className="muted small">{t.table.note}</p>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
