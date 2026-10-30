import Link from 'next/link';
import { holdingSources, type ChainLink, type OriginKind } from '@fwos/core';
import { Forest, type ChainContext } from '@/components/MoneyChainView';
import { niceDate } from '@/lib/dates';
import { SOURCE_LABEL, type FlowPageContext } from './FlowTab';

/** At most this many starting points listed, newest first being the ones left out. */
const MOST = 60;

/**
 * The money as an expandable tree. From a source: every amount that started there (each Wise transfer, each balance before the
 * statements), in date order, followed forward through every account, deposit and fund to where it is now. From a holding: back to
 * where its money started, and forward from what it paid out. Matched steps are marked and dashed; a missing statement or link is a
 * leaf that says so, and the money it carries on as is still followed.
 */
export function FlowTreeTab({
  c,
  chain,
  p,
}: {
  c: FlowPageContext;
  chain: ChainContext;
  p: { src?: string; h?: string; fy?: string };
}) {
  const nodes = [...chain.chain.nodes.values()];
  const presentSources = (Object.keys(SOURCE_LABEL) as OriginKind[]).filter((k) =>
    nodes.some((n) => n.starts.some((s) => s.kind === k)),
  );
  const h = p.h && (chain.chain.into.has(p.h) || chain.chain.now.has(p.h)) ? p.h : null;
  const src: OriginKind | null =
    !h && p.src && p.src in SOURCE_LABEL
      ? (p.src as OriginKind)
      : !h
        ? presentSources.includes('singapore')
          ? 'singapore'
          : (presentSources[0] ?? null)
        : null;
  const fy = p.fy && /^\d{4}-\d{2}$/.test(p.fy) ? p.fy : '';
  const from = fy ? `${fy.slice(0, 4)}-04-01` : '';
  const to = fy ? `${Number(fy.slice(0, 4)) + 1}-03-31` : '';
  const roots: ChainLink[] = src
    ? nodes.flatMap((n) =>
        (!from || (n.date >= from && n.date <= to)) && n.starts.some((s) => s.kind === src)
          ? [
              {
                node: n.id,
                amount: n.starts.filter((s) => s.kind === src).reduce((s, x) => s + x.amount, 0),
                basis: 'same_account' as const,
              },
            ]
          : [],
      )
    : [];
  const total = roots.reduce((s, l) => s + l.amount, 0);
  const firstDate = roots.length
    ? roots.map((l) => chain.chain.nodes.get(l.node)!.date).sort()[0]
    : '';
  const holdingOptions = c.data.holdings
    .map((x) => ({ id: x.id, label: c.labels[x.id] ?? x.id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const years = [
    ...new Set(
      nodes.map((n) => {
        const y = Number(n.date.slice(0, 4));
        return n.date.slice(5) >= '04-01' ? y : y - 1;
      }),
    ),
  ]
    .filter((y) => y > 1990)
    .sort((a, b) => b - a);

  return (
    <section className="card" aria-labelledby="ft-h" data-testid="flow-tree">
      <h2 id="ft-h">Money flow as a tree</h2>
      <p className="muted small">
        Start from where money came from and follow it forward, or start from a holding and go back.
        Every box opens; every step opens its own page. Dashed steps were matched by amount and
        date; a missing statement or link is named where it is, and the trail carries on from there.
      </p>
      <form method="get" action={c.base} className="fl-filters">
        <input type="hidden" name="tab" value="tree" />
        <label>
          Start from a source
          <select name="src" defaultValue={src ?? ''}>
            <option value="">—</option>
            {presentSources.map((k) => (
              <option key={k} value={k}>
                {SOURCE_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Financial year it came in
          <select name="fy" defaultValue={fy}>
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={`${y}-${String((y + 1) % 100).padStart(2, '0')}`}>
                {y}-{String((y + 1) % 100).padStart(2, '0')}
              </option>
            ))}
          </select>
        </label>
        <button className="btn compact primary">Show</button>
      </form>
      <form method="get" action={c.base} className="fl-filters">
        <input type="hidden" name="tab" value="tree" />
        <label>
          Or start from a holding
          <select name="h" defaultValue={h ?? ''}>
            <option value="">Choose a holding</option>
            {holdingOptions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <button className="btn compact primary">Show</button>
      </form>

      {src && (
        <>
          <h3 className="tr-h3" data-testid="flow-tree-title">
            {SOURCE_LABEL[src]}: {roots.length} amount{roots.length === 1 ? '' : 's'}, ₹
            {Math.round(total).toLocaleString('en-IN')}
            {firstDate ? `, from ${niceDate(firstDate)}` : ''}
          </h3>
          {roots.length > MOST && (
            <p className="muted small">The {MOST} largest are listed, in date order.</p>
          )}
          <Forest
            links={roots}
            c={chain}
            dir="forward"
            most={MOST}
            byDate
            testId="flow-tree-forward"
          />
        </>
      )}
      {h && (
        <>
          <h3 className="tr-h3">{c.labels[h] ?? 'This holding'}: where its money came from</h3>
          <Forest
            links={holdingSources(chain.chain, h)}
            c={chain}
            dir="back"
            byDate
            testId="flow-tree-back"
          />
          {(chain.chain.outOf.get(h) ?? []).length > 0 && (
            <>
              <h3 className="tr-h3">And where it went when paid out</h3>
              <Forest
                links={chain.chain.outOf.get(h) ?? []}
                c={chain}
                dir="forward"
                byDate
                testId="flow-tree-forward"
              />
            </>
          )}
          <p className="small">
            <Link href={`${c.base}?tab=flow&view=journey&h=${h}`}>See it as a diagram</Link>
          </p>
        </>
      )}
    </section>
  );
}
