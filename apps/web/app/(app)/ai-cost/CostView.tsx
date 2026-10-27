import Link from 'next/link';
import {
  AI_PURPOSE_LABEL,
  formatInrSmall,
  formatUsd,
  type AiPrice,
  type CostLine,
  type CostSummary,
  type PricedRow,
} from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import './aicost.css';

const tok = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 1e6 ? 0 : 1)}k` : String(n));
const purposeLabel = (k: string) => (AI_PURPOSE_LABEL as Record<string, string>)[k] ?? k;
const PROVIDER: Record<string, string> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  gemini: 'Gemini',
};

function Money({ usd, inr, unpriced = 0 }: { usd: number; inr: number; unpriced?: number }) {
  return (
    <>
      <span className="usd">{formatUsd(usd)}</span>
      <span className="muted small inr">{formatInrSmall(inr)}</span>
      {unpriced > 0 && (
        <span
          className="muted small"
          title="Calls on a model with no price in Settings: counted in tokens, not in money."
        >
          {' '}
          +{unpriced} unpriced
        </span>
      )}
    </>
  );
}

function tokensText(l: CostLine) {
  return `${tok(l.input + l.cacheRead + l.cacheWrite)} in · ${tok(l.output)} out`;
}

/** The AI cost page: what the AI has cost so far, by day, by what it was for, by model, and call by call. */
export function CostView({
  summary,
  usdInr,
  prices,
  demo = false,
}: {
  summary: CostSummary;
  usdInr: number;
  prices: AiPrice[];
  demo?: boolean;
}) {
  const s = summary;
  const inr = (usd: number) => usd * usdInr;
  const maxDay = Math.max(0.000001, ...s.byDay.map((d) => d.usd));
  const priceHint = demo ? '/demo/settings?tab=rules' : '/settings?tab=rules#ai-prices';
  const connHint = demo ? '/demo/settings?tab=connections' : '/settings?tab=connections';
  const all = s.periods.find((p) => p.key === 'all')!.line;
  return (
    <>
      <PageHead
        title="AI cost"
        subtitle="What the AI has cost so far, day by day and by what it was asked to do. Each call is logged with the tokens it used; the money is worked out from the prices in Settings."
        pills={[
          { label: `${all.calls} calls so far`, tone: 'info' },
          ...(all.failed > 0 ? [{ label: `${all.failed} failed`, tone: 'warn' as const }] : []),
          ...(s.unpricedModels.length > 0
            ? [{ label: 'some models have no price', tone: 'warn' as const }]
            : []),
        ]}
        actions={
          <>
            <Link className="btn" href={priceHint}>
              Prices
            </Link>
            <Link className="btn" href={connHint}>
              AI keys
            </Link>
          </>
        }
      />

      <section className="aic-periods" aria-label="Cost by period">
        {s.periods.map((p) => (
          <div key={p.key} className="card aic-period">
            <div className="aic-label">{p.label}</div>
            <div className="aic-big">
              <Money usd={p.line.usd} inr={inr(p.line.usd)} unpriced={p.line.unpriced} />
            </div>
            <div className="muted small">
              {p.line.calls} {p.line.calls === 1 ? 'call' : 'calls'}
              {p.line.failed > 0 ? `, ${p.line.failed} failed` : ''} · {tokensText(p.line)}
            </div>
          </div>
        ))}
      </section>

      <section className="card aic-cache" aria-label="Prompt caching">
        <h2>Prompt caching</h2>
        {s.cache.hitRate === null ? (
          <p className="muted">No calls yet.</p>
        ) : (
          <p>
            <strong>{Math.round(s.cache.hitRate * 100)}%</strong> of the prompt tokens were read
            from the cache ({tok(s.cache.readTokens)} of{' '}
            {tok(s.totals.input + s.cache.readTokens + s.cache.writeTokens)}), which saved about{' '}
            <strong>{formatUsd(s.cache.savedUsd)}</strong> ({formatInrSmall(inr(s.cache.savedUsd))}
            ).
          </p>
        )}
        <p className="muted small">
          Only Anthropic calls are marked for caching, and a service caches only a prompt above its
          minimum size. The instructions of the bank-rate and e-mail readers are the same every
          time, so they can be reused within a few minutes of each other; the page text and the
          e-mail differ every time and cannot be. A rate page that has not changed since it was last
          read is not sent to the AI at all, which saves more than caching does.
        </p>
      </section>

      <section className="card" aria-label="Cost by day">
        <h2>By day</h2>
        {s.byDay.length === 0 ? (
          <p className="muted">Nothing has been asked of the AI yet.</p>
        ) : (
          <table className="responsive aic-table">
            <thead>
              <tr>
                <th>Day (UTC)</th>
                <th className="num">Calls</th>
                <th className="num">Tokens in</th>
                <th className="num">From cache</th>
                <th className="num">Tokens out</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {s.byDay.slice(0, 90).map((d) => (
                <tr key={d.date}>
                  <td data-label="Day">{d.date}</td>
                  <td data-label="Calls" className="num">
                    {d.calls}
                    {d.failed > 0 && <span className="muted small"> ({d.failed} failed)</span>}
                  </td>
                  <td data-label="Tokens in" className="num">
                    {tok(d.input + d.cacheRead + d.cacheWrite)}
                  </td>
                  <td data-label="From cache" className="num">
                    {tok(d.cacheRead)}
                  </td>
                  <td data-label="Tokens out" className="num">
                    {tok(d.output)}
                  </td>
                  <td data-label="Cost" className="num aic-cost">
                    <span
                      className="aic-bar"
                      style={{ width: `${Math.round((d.usd / maxDay) * 100)}%` }}
                      aria-hidden
                    />
                    <Money usd={d.usd} inr={inr(d.usd)} unpriced={d.unpriced} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="aic-two">
        <section className="card" aria-label="Cost by purpose">
          <h2>By what it was for</h2>
          {s.byPurpose.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <table className="responsive aic-table">
              <thead>
                <tr>
                  <th>Purpose</th>
                  <th className="num">Calls</th>
                  <th className="num">Tokens</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {s.byPurpose.map((p) => (
                  <tr key={p.key}>
                    <td data-label="Purpose">{purposeLabel(p.key)}</td>
                    <td data-label="Calls" className="num">
                      {p.calls}
                    </td>
                    <td data-label="Tokens" className="num">
                      {tokensText(p)}
                    </td>
                    <td data-label="Cost" className="num">
                      <Money usd={p.usd} inr={inr(p.usd)} unpriced={p.unpriced} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="card" aria-label="Cost by model">
          <h2>By model</h2>
          {s.byModel.length === 0 ? (
            <p className="muted">Nothing yet.</p>
          ) : (
            <table className="responsive aic-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="num">Calls</th>
                  <th className="num">Tokens</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {s.byModel.map((m) => (
                  <tr key={`${m.provider}|${m.model}`}>
                    <td data-label="Model">
                      {m.model}
                      <span className="muted small"> · {PROVIDER[m.provider] ?? m.provider}</span>
                    </td>
                    <td data-label="Calls" className="num">
                      {m.calls}
                    </td>
                    <td data-label="Tokens" className="num">
                      {tokensText(m)}
                    </td>
                    <td data-label="Cost" className="num">
                      <Money usd={m.usd} inr={inr(m.usd)} unpriced={m.unpriced} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card" aria-label="Recent calls">
        <h2>Recent calls</h2>
        <p className="muted small">
          The latest {s.recent.length}, newest first. Failed calls cost nothing unless the service
          answered.
        </p>
        {s.recent.length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <table className="responsive aic-table aic-recent">
            <thead>
              <tr>
                <th>When (UTC)</th>
                <th>For</th>
                <th>Model</th>
                <th className="num">In</th>
                <th className="num">Cache</th>
                <th className="num">Out</th>
                <th className="num">Cost</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {s.recent.map((r) => (
                <RecentRow key={r.id} r={r} usdInr={usdInr} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card aic-notes" aria-label="How this is worked out">
        <h2>How this is worked out</h2>
        <ul className="small">
          <li>
            Cost = tokens × the price of the model, in dollars per million tokens, from Settings (
            {prices.length} {prices.length === 1 ? 'price' : 'prices'} set), shown in rupees at ₹
            {usdInr} per dollar. Change a price or the rate and the whole history is worked out
            again.
          </li>
          {s.unpricedModels.length > 0 && (
            <li>
              No price is set for <strong>{s.unpricedModels.join(', ')}</strong>, so those calls
              show tokens but no money. Add a line under{' '}
              <Link href={priceHint}>Settings → AI prices</Link>. Free tiers (Groq, Gemini) are not
              charged; set their price to 0.
            </li>
          )}
          <li>
            Days are UTC days. The tiny checks that confirm a model answers before a job starts are
            not logged, and neither is anything that happens outside this app.
          </li>
          <li>
            The service&rsquo;s own invoice is the final word; this page is an estimate from the
            tokens each answer reported.
          </li>
        </ul>
      </section>
    </>
  );
}

function RecentRow({ r, usdInr }: { r: PricedRow; usdInr: number }) {
  return (
    <tr className={r.ok ? '' : 'aic-failed'}>
      <td data-label="When" className="nowrap">
        {r.at.slice(0, 10)} {r.at.slice(11, 16)}
      </td>
      <td data-label="For">{purposeLabel(r.purpose)}</td>
      <td data-label="Model">
        {r.model ?? '—'}
        <span className="muted small"> · {PROVIDER[r.provider] ?? r.provider}</span>
      </td>
      <td data-label="In" className="num">
        {r.known ? tok(r.input) : '–'}
      </td>
      <td data-label="Cache" className="num">
        {r.known ? tok(r.cacheRead) : '–'}
      </td>
      <td data-label="Out" className="num">
        {r.known ? tok(r.output) : '–'}
      </td>
      <td data-label="Cost" className="num">
        {r.usd === null ? (
          <span className="muted">{r.known ? 'no price' : '–'}</span>
        ) : (
          <>
            <span className="usd">{formatUsd(r.usd)}</span>
            <span className="muted small inr">{formatInrSmall(r.usd * usdInr)}</span>
          </>
        )}
      </td>
      <td data-label="Result">
        {r.ok ? (
          <span className="ok">worked</span>
        ) : (
          <span className="fail">{r.note ?? `status ${r.status}`}</span>
        )}
      </td>
    </tr>
  );
}
