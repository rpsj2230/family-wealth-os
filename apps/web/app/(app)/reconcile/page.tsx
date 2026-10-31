import { redirect } from 'next/navigation';
import {
  categoryLabel,
  interestCheck,
  LINE_CLASS_LABEL,
  positionInputFrom,
  reconcileQueue,
} from '@fwos/core';
import { capitalStart, loadFeedStatus, loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { loadHistoryReview } from '@/lib/history-data';
import { holdingLabels } from '@/lib/holding-label';
import { loadReportedInterest } from '@/lib/interest-data';
import { loadStatements, statementPicture } from '@fwos/data';
import { positionFor } from '@fwos/data';
import { loadAccess, loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { confirmProceeds, explainBalance, recordFunding } from './actions';
import { Feed } from './Feed';
import { History } from './History';
import { Interest, type InterestAnswer } from './Interest';
import { Statements, type CoveredMove } from './Statements';
import { Recent, type StatementLineView } from './Recent';
import './reconcile.css';

export const dynamic = 'force-dynamic';

/**
 * Explain movements: the few answers that make own money and profit exact. Each item comes with the likeliest answer chosen and the
 * reason; nothing is assigned until a person saves it, and saving the same answer twice changes nothing.
 */
export default async function Reconcile({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; tab?: string }>;
}) {
  const { msg, tab: tabParam } = await searchParams;
  const tab =
    tabParam === 'history' ||
    tabParam === 'interest' ||
    tabParam === 'statements' ||
    tabParam === 'feed'
      ? tabParam
      : 'recent';
  if ((await loadAccess()).role === 'emergency_viewer') redirect('/emergency');
  const { supabase } = await loadContext();
  const loaded = await loadPortfolio(supabase);
  const { config } = await loadSettings(supabase as unknown as SupabaseClient);
  const today = loaded.today.toISOString().slice(0, 10);
  const position = positionInputFrom({
    assets: loaded.assetRows,
    observations: [...loaded.obsRows, ...loaded.sheetObs],
    fds: loaded.fdRows,
    config,
    today,
    ...(loaded.engine.extras.moves ? { moves: loaded.engine.extras.moves } : {}),
    ...(loaded.engine.extras.rates ? { rates: loaded.engine.extras.rates } : {}),
    ...(loaded.engine.extras.placements ? { placements: loaded.engine.extras.placements } : {}),
  });
  const recentDays = Math.max(config.deposits.hideMaturedAfterDays, 120);
  const q = reconcileQueue({
    position,
    moves: loaded.engine.moves,
    tolerance: config.estimates.unexplainedTolerance,
    sinceDays: recentDays,
    pairDays: config.estimates.transferPairDays,
  });
  const owner = (id: string) => loaded.ownerName.get(id) ?? '';
  const accounts = loaded.assetRows.filter(
    (a) => a.type === 'bank_account' && a.status !== 'gifted',
  );
  const deposits = loaded.assetRows.filter(
    (a) => a.type === 'fixed_deposit' && a.status !== 'gifted',
  );
  const history =
    tab === 'history'
      ? await loadHistoryReview(supabase as unknown as SupabaseClient, loaded, config, recentDays)
      : null;
  // what tells holdings apart in a list: bank, name, last digits, a deposit's amount and maturity, and whose it is
  const banks = await supabase.from('institutions').select('id, name');
  const bankName = new Map(
    ((banks.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]),
  );
  const fdOf = new Map(loaded.fdRows.map((f) => [f.asset_id, f]));
  const labels = holdingLabels(
    loaded.assetRows.map((a) => {
      const f = fdOf.get(a.id);
      return {
        id: a.id,
        nickname: a.label || a.nickname,
        owner: owner(a.owner_id),
        bank: a.institution_id ? (bankName.get(a.institution_id) ?? null) : null,
        last4: a.identifier_last4 ?? null,
        fd: f ? { principal: Number(f.principal), maturityOn: f.maturity_on } : null,
      };
    }),
  );
  const holdings = loaded.assetRows
    .filter((a) => a.status !== 'gifted')
    .map((a) => ({ id: a.id, label: labels[a.id]! }))
    .sort((x, y) => x.label.localeCompare(y.label));
  const interest = tab === 'interest' ? await interestTab() : null;
  const statements = tab === 'statements' ? await statementsTab() : null;
  const { householdId } = await loadContext();
  const feed =
    tab === 'feed' && householdId
      ? await loadFeedStatus(supabase as unknown as SupabaseClient, householdId)
      : null;
  const recentLines = tab === 'recent' && q.balances.length ? await linesForBalances() : {};

  /**
   * Recent: for each balance that changed more than expected, the account's own statement lines between the two balances, with
   * what the rules make of each, so the difference can be explained from what the bank wrote.
   */
  async function linesForBalances(): Promise<Record<string, StatementLineView[]>> {
    const stored = await loadStatements(supabase as unknown as SupabaseClient);
    const picture = statementPicture(stored, loaded, config, positionFor(loaded, config, true));
    const cls = new Map(picture.classified.map((c) => [c.id, c]));
    const out: Record<string, StatementLineView[]> = {};
    for (const b of q.balances)
      out[b.key] = picture.lines
        .filter((l) => l.assetId === b.assetId && l.date > b.from.date && l.date <= b.to.date)
        .sort((x, y) => x.date.localeCompare(y.date))
        .map((l) => ({
          id: l.id,
          date: l.date,
          amount: l.amount,
          narration: l.narration,
          // the kind, and what it was spent on or came in as when known ("Spending · Flights")
          what: [
            LINE_CLASS_LABEL[cls.get(l.id)?.cls ?? 'ask_in'],
            cls.get(l.id)?.category ? categoryLabel(cls.get(l.id)!.category!) : null,
          ]
            .filter(Boolean)
            .join(' · '),
          why: cls.get(l.id)?.reason ?? '',
        }));
    return out;
  }

  /** Bank statements: every line sorted, and the answers given by hand that the statements now cover. */
  async function statementsTab() {
    const stored = await loadStatements(supabase as unknown as SupabaseClient);
    const picture = statementPicture(stored, loaded, config, positionFor(loaded, config, true));
    const covered: CoveredMove[] = loaded.engine.moves
      .filter(
        (m) =>
          m.status === 'confirmed' &&
          m.source !== 'statement' &&
          !/^(stmt|ais):/.test(m.idemKey ?? '') &&
          (m.fromAssetId === null) !== (m.toAssetId === null),
      )
      .map((m) => ({
        id: m.id,
        on: m.movedOn,
        amount: m.amount,
        kind: m.kind,
        assetId: (m.toAssetId ?? m.fromAssetId)!,
        into: m.fromAssetId === null,
      }))
      .filter((m) =>
        stored.statements.some(
          (s) => s.asset_id === m.assetId && m.on >= s.from_on && m.on <= s.to_on,
        ),
      );
    return { stored, picture, covered };
  }

  /** Interest: each stored AIS or Form 26AS against the estimate for the same person's taxable accounts, and the years already settled. */
  async function interestTab() {
    const nre = new Set(loaded.assetRows.filter((a) => a.account_kind === 'NRE').map((a) => a.id));
    const ownerOf = new Map(loaded.assetRows.map((a) => [a.id, a.owner_id]));
    // interest already put right from bank statements, by person and year (taxable accounts only: the AIS leaves NRE out)
    const fromStatements = new Map<string, number>();
    for (const m of loaded.engine.moves) {
      const k = /^stmt:([^:]+):int:(\d{4}-\d{2})$/.exec(m.idemKey ?? '');
      if (!k || m.status !== 'confirmed' || nre.has(k[1]!)) continue;
      const key = `${ownerOf.get(k[1]!) ?? ''}|${k[2]}`;
      fromStatements.set(
        key,
        (fromStatements.get(key) ?? 0) + (m.fromAssetId === null ? m.amount : -m.amount),
      );
    }
    const rows = interestCheck({
      position: positionFor(loaded, config, true),
      recorded: (ownerId, fy) => fromStatements.get(`${ownerId}|${fy}`) ?? 0,
      statements: await loadReportedInterest(supabase as unknown as SupabaseClient),
      taxable: (id) => !nre.has(id),
      tolerance: {
        rupees: config.estimates.unexplainedTolerance,
        share: config.estimates.reconcileTolerance,
      },
      coveredFrom: capitalStart(loaded, config),
    });
    const answers: InterestAnswer[] = loaded.engine.moves
      .filter((m) => m.status === 'confirmed' && /^ais:[^:]+:\d{4}-\d{2}$/.test(m.idemKey ?? ''))
      .map((m) => {
        const [, ownerId = '', fy = ''] = m.idemKey!.split(':');
        return {
          key: m.idemKey!,
          ownerId,
          fy,
          amount: m.fromAssetId === null ? m.amount : -m.amount,
          assetId: m.toAssetId ?? m.fromAssetId,
        };
      });
    const accountsOf: Record<string, { id: string; label: string }[]> = {};
    for (const a of accounts)
      (accountsOf[a.owner_id] ??= []).push({ id: a.id, label: labels[a.id]! });
    for (const list of Object.values(accountsOf))
      list.sort((x, y) => x.label.localeCompare(y.label));
    return { rows, answers, accountsOf };
  }

  return (
    <>
      <PageHead
        title="Explain movements"
        subtitle="Where matured money went, what a balance change was, and where a new deposit's money came from. Your answers make own money and profit exact; until then the amounts are kept apart and never counted as profit."
        pills={[
          q.count === 0
            ? { label: 'Nothing to explain', tone: 'ok' }
            : { label: `${q.count} to explain`, tone: 'warn' },
        ]}
      />
      {msg && (
        <p className="notice ok" role="status">
          {msg}
        </p>
      )}
      <Tabs
        base="/reconcile"
        current={tab}
        tabs={[
          { key: 'recent', label: 'Recent', badge: q.count || null },
          { key: 'history', label: 'Earlier months' },
          { key: 'interest', label: 'Interest (AIS)' },
          { key: 'statements', label: 'Bank statements' },
          { key: 'feed', label: 'Bank feed' },
        ]}
      />
      {feed ? (
        <Feed rows={feed.rows} mail={feed.mail} />
      ) : statements ? (
        <Statements
          statements={statements.stored.statements}
          lines={statements.picture.lines}
          classified={statements.picture.classified}
          interest={statements.picture.interest}
          labels={labels}
          covered={statements.covered}
          rules={statements.stored.rules}
          holdings={loaded.assetRows
            .filter((a) => a.status !== 'gifted' && a.status !== 'merged')
            .map((a) => ({ id: a.id, label: labels[a.id]!, type: a.type }))
            .sort((x, y) => x.label.localeCompare(y.label))}
          ownNames={[...loaded.ownerName.values()]}
        />
      ) : interest ? (
        <Interest
          rows={interest.rows}
          answers={interest.answers}
          ownerName={Object.fromEntries(loaded.ownerName)}
          accountsOf={interest.accountsOf}
        />
      ) : history ? (
        <History
          review={history.review}
          answers={history.answers}
          holdings={holdings}
          opening={history.opening}
          minimum={config.capital.reviewMinimum}
        />
      ) : (
        <Recent
          q={q}
          accounts={accounts}
          deposits={deposits}
          ownerName={Object.fromEntries(loaded.ownerName)}
          labels={labels}
          today={today}
          tolerance={config.estimates.unexplainedTolerance}
          act={{ confirmProceeds, explainBalance, recordFunding }}
          linesFor={recentLines}
        />
      )}
    </>
  );
}
