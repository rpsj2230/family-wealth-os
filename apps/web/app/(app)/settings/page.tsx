import { loadContext } from '@/lib/data';
import { formatInr, profileFromJson, RULES, type TaxRuleRow } from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WhatsAppButton } from '../share/WhatsAppButton';
import {
  deleteCashflow,
  deleteRateSource,
  resetTaxRule,
  saveDigestSettings,
  saveIntegrations,
} from './actions';
import {
  CashflowForm,
  ConfigForm,
  EmergencyForm,
  LiquidityForm,
  PersonForm,
  RateSourceForm,
  TaxRuleForm,
  type PersonRow,
} from './SettingsForms';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { supabase, householdId, role } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [s, log, integ, people, flows, ruleRows, settings, fx, rsources, eprof] = await Promise.all(
    [
      supabase
        .from('digest_settings')
        .select('enabled, extra_recipients, include_retirement')
        .maybeSingle(),
      supabase
        .from('digest_log')
        .select('digest_date, status, recipients, error, created_at')
        .order('digest_date', { ascending: false })
        .limit(10),
      supabase
        .from('integration_settings')
        .select('ai_provider, ai_key_set, inbox_label')
        .maybeSingle(),
      supabase
        .from('owners')
        .select(
          'id, display_name, dob, pan_last4, tax_residency, guardian_id, plan_role, is_minor, notes',
        )
        .order('created_at'),
      supabase
        .from('cashflow_items')
        .select('id, owner_id, kind, label, amount, currency, frequency')
        .order('kind')
        .order('created_at'),
      supabase.from('tax_rules').select('*').order('fy'),
      loadSettings(supabase as unknown as SupabaseClient),
      supabase
        .from('fx_rates')
        .select('currency, rate_date, inr_per_unit')
        .order('rate_date', { ascending: false })
        .limit(20),
      supabase.from('rate_sources').select('id, bank, url, last_run_on, last_result').order('bank'),
      supabase.from('emergency_profile').select('content').maybeSingle(),
    ],
  );
  const fxNow: Record<string, number> = { INR: 1 };
  for (const r of fx.data ?? [])
    if (!((r.currency as string) in fxNow)) fxNow[r.currency as string] = Number(r.inr_per_unit);
  const peopleRows: PersonRow[] = (people.data ?? []).map((o) => ({
    id: o.id as string,
    name: o.display_name as string,
    dob: (o.dob as string | null) ?? '',
    panLast4: (o.pan_last4 as string | null) ?? null,
    residency: (o.tax_residency as string | null) ?? '',
    guardian: (o.guardian_id as string | null) ?? '',
    planRole: (o.plan_role as string | null) ?? '',
    isMinor: !!o.is_minor,
    notes: (o.notes as string | null) ?? '',
  }));
  const nameOfOwner = new Map(peopleRows.map((o) => [o.id, o.name]));
  const monthly = (x: { amount: number; frequency: string }) =>
    x.frequency === 'yearly' ? Number(x.amount) / 12 : Number(x.amount);
  const sums = new Map<string, { inc: number; exp: number }>();
  for (const f of flows.data ?? []) {
    const cur = f.currency as string;
    const e = sums.get(cur) ?? { inc: 0, exp: 0 };
    if (f.kind === 'income') e.inc += monthly(f as never);
    else e.exp += monthly(f as never);
    sums.set(cur, e);
  }
  const savingInr = [...sums.entries()].reduce(
    (t, [cur, e]) => t + (e.inc - e.exp) * (fxNow[cur] ?? 0),
    0,
  );
  const missingFx = [...sums.keys()].filter((c) => !(c in fxNow));
  const custom = new Map(((ruleRows.data ?? []) as unknown as TaxRuleRow[]).map((r) => [r.fy, r]));
  const c = settings.config;
  const years = [
    ...new Map([
      ...RULES.map((r) => [r.fy, r.fy] as const),
      ...[...custom.keys()].map((k) => [k, k] as const),
    ]).keys(),
  ].sort();
  const ruleOf = (fy: string) => settings.rules.find((r) => r.fy === fy)!;
  const ic = integ.data as {
    ai_provider: 'groq' | 'gemini' | null;
    ai_key_set: boolean;
    inbox_label: string;
  } | null;
  const cfg = s.data as {
    enabled: boolean;
    extra_recipients: string[];
    include_retirement: boolean;
  } | null;
  return (
    <>
      <h1>Settings</h1>
      <nav className="chipbar small" aria-label="Settings sections">
        <a className="fchip" href="#people">
          People
        </a>
        <a className="fchip" href="#money">
          Income and spending
        </a>
        <a className="fchip" href="#limits">
          Limits and reminders
        </a>
        <a className="fchip" href="#tax">
          Tax rules
        </a>
        <a className="fchip" href="#email">
          Email and AI
        </a>
      </nav>

      <section className="card" id="people">
        <h2>People</h2>
        <p className="muted small">
          Dates of birth drive the retirement ages. The PAN is stored write-only: it can be replaced
          or removed but never shown again; the app keeps the last four characters for display and
          uses the full PAN only to open your fund statements. A minor can be linked to the guardian
          who handles their money.
        </p>
        {peopleRows.map((p) => (
          <PersonForm
            key={p.id}
            p={p}
            others={peopleRows
              .filter((o) => o.id !== p.id)
              .map((o) => ({ id: o.id, name: o.name }))}
          />
        ))}
      </section>

      <section className="card" id="money">
        <h2>Income and spending</h2>
        <p className="muted small">
          Add each source in its own currency. The saving each month is worked out from these and
          shown below; nothing is assumed.
        </p>
        {(flows.data ?? []).length === 0 ? (
          <p className="muted">Nothing entered yet.</p>
        ) : (
          <table className="tbl lines">
            <tbody>
              {(flows.data ?? []).map((f) => (
                <tr key={f.id as string}>
                  <td>
                    {f.kind === 'income' ? 'Income' : 'Spending'} · {f.label as string}
                  </td>
                  <td className="muted small">
                    {f.owner_id ? nameOfOwner.get(f.owner_id as string) : 'Household'}
                  </td>
                  <td className="num">
                    {f.currency as string} {Number(f.amount).toLocaleString('en-IN')}{' '}
                    {f.frequency === 'yearly' ? 'a year' : 'a month'}
                  </td>
                  <td>
                    <form action={deleteCashflow}>
                      <input type="hidden" name="id" value={f.id as string} />
                      <button
                        className="btn compact ghost"
                        aria-label={`Remove ${f.label as string}`}
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {[...sums.entries()].map(([cur, e]) => (
          <p key={cur} className="small">
            Each month in {cur}: income {e.inc.toLocaleString('en-IN')}, spending{' '}
            {e.exp.toLocaleString('en-IN')},{' '}
            <strong>left {(e.inc - e.exp).toLocaleString('en-IN')}</strong>
          </p>
        ))}
        {sums.size > 0 && missingFx.length === 0 && (
          <p className="small">
            About <strong>{formatInr(Math.round(savingInr))}</strong> a month at today&apos;s
            exchange rates.
          </p>
        )}
        {missingFx.length > 0 && (
          <p className="small muted">
            The exchange rate for {missingFx.join(', ')} loads with the daily market-data job.
          </p>
        )}
        <CashflowForm people={peopleRows.map((o) => ({ id: o.id, name: o.name }))} />
      </section>

      <section className="card" id="limits">
        <h2>Limits and reminders</h2>
        <p className="muted small">
          These numbers can change by law or by choice. Change them here and every screen, alert and
          reminder follows.
        </p>
        <ConfigForm
          v={{
            limit: c.deposits.insuranceLimit,
            alertDays: c.deposits.maturityAlertDays.join(', '),
            soonDays: c.reminders.maturitySoonDays,
            policyDays: c.reminders.policyDays,
            taskDays: c.reminders.taskDays,
            harvestMonth: c.reminders.harvestMonth,
            harvestDay: c.reminders.harvestDay,
            freshness: c.estimates.freshnessDays,
            savingsRate: Math.round(c.estimates.savingsRate * 1e4) / 100,
            tdsRate: Math.round(c.estimates.interestTdsRate * 1e4) / 100,
            includeSip: c.estimates.includeSip,
            rateStale: c.rates.staleDays,
            rateGap: Math.round(c.rates.minRateGap * 1e4) / 100,
            rateGain: c.rates.minAnnualGain,
            nroTax: Math.round(c.rates.nroTaxRate * 1e4) / 100,
            rateTenure: c.rates.defaultTenureMonths,
            rateLook: c.rates.fdLookaheadDays,
            rateBuffer: c.rates.savingsBuffer,
            minSell: c.harvest.minSellAmount,
            margin: c.harvest.holdingMarginMonths,
            skipSip: c.harvest.skipActiveSip,
            nri: c.harvest.nri,
            incomeLimit: c.refunds.incomeLimit,
            otherIncome: c.refunds.otherIncome,
          }}
        />
      </section>

      <section className="card" id="liquidity">
        <h2>When I need money</h2>
        <p className="muted small">
          The &ldquo;I need money&rdquo; page uses these choices to work out where an amount can
          come from and by when. Untick a source to never use it.
        </p>
        <LiquidityForm c={c.liquidity} />
      </section>

      <section className="card" id="emergency">
        <h2>Emergency information</h2>
        <p className="muted small">
          The family handbook (Emergency in the menu) is written from your records plus what you
          enter here. The read-only family login can open it without seeing anything else. Nothing
          here is a password: say <em>where</em> things are, not what they are.
        </p>
        <EmergencyForm p={profileFromJson((eprof.data as { content: unknown } | null)?.content)} />
      </section>

      <section className="card" id="rates">
        <h2>Bank rate pages</h2>
        <p className="muted small">
          List the page where each bank publishes its deposit rates. Every Monday the app reads them
          with your AI key (see Bank emails and AI below) and keeps the rates, with the date it
          checked. Rates you type on the Rates page are never overwritten. To refresh now: GitHub
          &gt; Actions &gt; Refresh interest rates &gt; Run workflow.
        </p>
        {(rsources.data ?? []).length > 0 && (
          <table className="tbl lines">
            <tbody>
              {(rsources.data ?? []).map((r) => (
                <tr key={r.id as string}>
                  <td>
                    <strong>{r.bank as string}</strong>
                    <div className="small muted" style={{ wordBreak: 'break-all' }}>
                      {r.url as string}
                    </div>
                  </td>
                  <td className="small muted">
                    {r.last_run_on
                      ? `${r.last_run_on as string}: ${(r.last_result as string | null) ?? ''}`
                      : 'not read yet'}
                  </td>
                  <td>
                    <form action={deleteRateSource}>
                      <input type="hidden" name="id" value={r.id as string} />
                      <button
                        className="btn compact ghost"
                        aria-label={`Remove ${r.bank as string}`}
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <RateSourceForm />
      </section>

      <section className="card" id="tax">
        <h2>Tax rules by financial year</h2>
        <p className="muted small">
          The tax-free allowance, the rates and the holding period are inputs, not facts built into
          the app. When the rules change, edit the year here (or add the new year). A year with no
          entry assumes the latest earlier year and says so on the Tax page.
        </p>
        {years.map((fy) => {
          const r = ruleOf(fy);
          const isCustom = custom.has(fy);
          return (
            <div key={fy}>
              <TaxRuleForm
                custom={isCustom}
                v={{
                  fy,
                  months: r.equity.holdingMonthsLong,
                  stcg: Math.round(r.equity.stcgRate * 1e4) / 100,
                  ltcg: Math.round(r.equity.ltcgRate * 1e4) / 100,
                  exemption: r.equity.ltcgExemption,
                  cess: Math.round(r.cess * 1e4) / 100,
                  verified: r.verification === 'primary',
                  note: r.notes[0] ?? '',
                }}
              />
              {isCustom && (
                <form action={resetTaxRule} style={{ marginTop: -6, marginBottom: 12 }}>
                  <input type="hidden" name="fy" value={fy} />
                  <button className="linkbtn">Go back to the built-in numbers for {fy}</button>
                </form>
              )}
            </div>
          );
        })}
        <TaxRuleForm
          isNew
          custom
          v={{
            fy: '',
            months: 12,
            stcg: 20,
            ltcg: 12.5,
            exemption: 125000,
            cess: 4,
            verified: false,
            note: '',
          }}
        />
      </section>

      <div id="email" />
      <section className="card">
        <h2>Daily summary email</h2>
        <p className="muted small">
          A short summary at 08:30 Singapore time: estimated net worth, what changed, what needs
          attention, and how old each input is. It goes to everyone who can sign in to this
          household, plus any extra addresses below. Mail is sent from your own Gmail account (set
          up once; see the setup notes).
        </p>
        <form action={saveDigestSettings} className="form">
          <label className="check">
            <input type="checkbox" name="enabled" defaultChecked={cfg?.enabled ?? false} /> Send the
            daily summary
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="include_retirement"
              defaultChecked={cfg?.include_retirement ?? true}
            />{' '}
            Include the retirement view when I have saved assumptions
          </label>
          <label>
            Extra recipients (up to 5, separated by commas)
            <input
              name="extra"
              defaultValue={(cfg?.extra_recipients ?? []).join(', ')}
              placeholder="parent@example.com"
            />
          </label>
          <div className="row">
            <button className="btn primary" disabled={role !== 'admin' && role !== 'member'}>
              Save
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Bank emails and AI</h2>
        <p className="muted small">
          Balance alerts from a bank&apos;s own address are read by fixed rules and need no key. To
          read PDF statements and unfamiliar emails, add a free key from Groq or Google AI Studio
          (Gemini). Account numbers are removed before any text is sent. The key is stored on the
          server and cannot be viewed again here; saving a new one replaces it.
        </p>
        <form action={saveIntegrations} className="form">
          <div className="formgrid">
            <label>
              AI service
              <select name="provider" defaultValue={ic?.ai_provider ?? 'groq'}>
                <option value="groq">Groq</option>
                <option value="gemini">Google Gemini</option>
              </select>
            </label>
            <label>
              API key {ic?.ai_key_set ? '(one is saved; leave empty to keep it)' : ''}
              <input
                name="key"
                type="password"
                autoComplete="off"
                placeholder={ic?.ai_key_set ? '••••••••' : 'paste key'}
              />
            </label>
            <label>
              Gmail label with forwarded bank emails
              <input name="label" defaultValue={ic?.inbox_label ?? 'FWOS/Inbox'} />
            </label>
          </div>
          {ic?.ai_key_set && (
            <label className="check">
              <input type="checkbox" name="clear" /> Remove the saved key
            </label>
          )}
          <button className="btn primary">Save</button>
        </form>
      </section>

      <section className="card">
        <h2>WhatsApp</h2>
        <p className="muted small">
          Fully automatic WhatsApp messages from a personal number are not possible without paid
          services or unofficial tools, so this opens WhatsApp with today&apos;s summary ready; you
          pick who gets it and press send.
        </p>
        <WhatsAppButton />
      </section>

      <section className="card">
        <h2>Recent deliveries</h2>
        {(log.data ?? []).length === 0 ? (
          <p className="muted">Nothing sent yet.</p>
        ) : (
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Date</th>
                <th>Result</th>
                <th className="num">Recipients</th>
              </tr>
            </thead>
            <tbody>
              {(log.data ?? []).map((r) => (
                <tr key={r.digest_date as string}>
                  <td data-label="Date">{r.digest_date as string}</td>
                  <td data-label="Result">
                    {r.status === 'accepted_by_provider'
                      ? 'Handed to the mail server'
                      : r.status === 'failed'
                        ? `Failed${r.error ? `: ${r.error as string}` : ''}`
                        : 'In progress'}
                  </td>
                  <td className="num" data-label="Recipients">
                    {r.recipients as number}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          &ldquo;Handed to the mail server&rdquo; is the most the app can know. It cannot confirm
          that an inbox received the message.
        </p>
      </section>
    </>
  );
}
