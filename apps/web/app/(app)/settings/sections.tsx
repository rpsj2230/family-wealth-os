import Link from 'next/link';
import { formatInr, personStyles, type AppConfig, type EmergencyProfile } from '@fwos/core';
import { SetupChecklist, type SetupChecklistItem } from '@/components/SetupChecklist';
import {
  CONFIG_GROUPS,
  GROUP_TITLE,
  RULE_GROUPS,
  groupValues,
  type RuleGroup,
} from '@/lib/settings-fields';
import { tabHref } from '@/lib/settings-tabs';
import { WhatsAppButton } from '../share/WhatsAppButton';
import { AccessForm, EmergencyForm } from './AccessForms';
import {
  AiConnection,
  DigestForm,
  IntegrationsForm,
  RateCheckButton,
  RateSourceForm,
} from './ConnectForms';
import {
  CashflowForm,
  CashflowRow,
  PersonForm,
  ResidencyList,
  type FlowRow,
  type PersonRow,
} from './PeopleForms';
import { LiquidityForm, RuleGroupForm, TaxRuleForm, type TaxValues } from './RuleForms';
import { TelegramForm } from './TelegramForm';
import { deleteRateSource } from './actions';

/** Every section below takes plain props, so the page and the public sample page build them the same way. */

export const niceDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

const SectionIntro = ({ children }: { children: React.ReactNode }) => (
  <p className="muted setintro">{children}</p>
);

/* ------------------------------------------------------------------ Setup */

export function SetupSection({ items }: { items: SetupChecklistItem[] }) {
  return (
    <>
      <SectionIntro>
        A short list of what the portal needs from you, with a link to each. Nothing here is
        required: every page works without it, and each item makes one part more exact.
      </SectionIntro>
      <SetupChecklist items={items} title="What is set up" />
      <p className="muted small">
        Secrets stay write-only: the AI key, the Telegram token and each PAN are never shown again
        after saving; this list only says that one exists.
      </p>
    </>
  );
}

/* ----------------------------------------------------------------- People */

export function PeopleSection({
  people,
  flows,
  fxNow,
}: {
  people: PersonRow[];
  flows: FlowRow[];
  fxNow: Record<string, number>;
}) {
  const styles = personStyles(people.map((p) => ({ id: p.id, name: p.name })));
  const nameOf = new Map(people.map((o) => [o.id, o.name]));
  const monthly = (x: FlowRow) => (x.frequency === 'yearly' ? x.amount / 12 : x.amount);
  const sums = new Map<string, { inc: number; exp: number }>();
  for (const f of flows) {
    const e = sums.get(f.currency) ?? { inc: 0, exp: 0 };
    if (f.kind === 'income') e.inc += monthly(f);
    else e.exp += monthly(f);
    sums.set(f.currency, e);
  }
  const missingFx = [...sums.keys()].filter((c) => !(c in fxNow));
  const savingInr = [...sums.entries()].reduce(
    (t, [cur, e]) => t + (e.inc - e.exp) * (fxNow[cur] ?? 0),
    0,
  );
  const short = people.filter((p) => !p.dob || (!p.isMinor && !p.panLast4)).length;
  return (
    <>
      <SectionIntro>
        Who is in the household and what comes in and goes out. Dates of birth set the retirement
        ages; PANs are stored write-only.
      </SectionIntro>
      <section className="setsec" id="people" aria-labelledby="people-h">
        <div className="sectionhead">
          <h3 id="people-h">People</h3>
          {short > 0 && (
            <span className="pill warn">
              {short} {short === 1 ? 'person needs' : 'people need'} details
            </span>
          )}
        </div>
        <ResidencyList />
        {people.length === 0 && (
          <p className="empty">
            No one is in the household yet. People are created when the workbook is imported:{' '}
            <Link href="/import">open Import</Link>.
          </p>
        )}
        {people.map((p) => (
          <PersonForm
            key={p.id}
            p={p}
            style={styles[p.id]}
            others={people.filter((o) => o.id !== p.id).map((o) => ({ id: o.id, name: o.name }))}
          />
        ))}
      </section>

      <section className="setsec card" id="money" aria-labelledby="money-h">
        <h3 id="money-h">Income and spending</h3>
        <p className="muted small">
          Add each line in its own currency. The monthly saving is worked out from these; nothing is
          assumed. Change an amount in place and press Save.
        </p>
        {flows.length === 0 ? (
          <p className="empty">
            Nothing entered yet. Add your salary and your monthly spending below; “Can I retire
            now?” starts from them.
          </p>
        ) : (
          <div className="flowlist">
            {flows.map((f) => (
              <CashflowRow
                key={f.id}
                f={f}
                whose={f.ownerId ? (nameOf.get(f.ownerId) ?? 'Household') : 'Household'}
              />
            ))}
          </div>
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
            About <strong>{formatInr(Math.round(savingInr))}</strong> a month at today’s exchange
            rates.
          </p>
        )}
        {missingFx.length > 0 && (
          <p className="small muted">
            The exchange rate for {missingFx.join(', ')} loads with the daily market-data job.
          </p>
        )}
        <CashflowForm people={people.map((o) => ({ id: o.id, name: o.name }))} />
      </section>
    </>
  );
}

/* ------------------------------------------------------------ Money rules */

export function RulesSection({ config, confirmed }: { config: AppConfig; confirmed: RuleGroup[] }) {
  const open = RULE_GROUPS.length - confirmed.length;
  const anchors: [string, string][] = [
    ...CONFIG_GROUPS.map((g): [string, string] => [g.id, g.title]),
    ['liquidity', GROUP_TITLE.liquidity],
  ];
  return (
    <>
      <SectionIntro>
        These numbers can change by law or by choice. Change one and every screen, alert and
        reminder that uses it follows. Each card saves on its own.
      </SectionIntro>
      <div className={`notice ${open > 0 ? 'warn' : 'ok'}`} role="note">
        {open > 0 ? (
          <>
            <strong>
              {open} of {RULE_GROUPS.length} cards still run on the built-in numbers.
            </strong>{' '}
            They are sensible starting points, but press Save on a card once you have looked at it
            and it is marked confirmed.
          </>
        ) : (
          <>All {RULE_GROUPS.length} cards are confirmed by you.</>
        )}
      </div>
      <nav className="chipbar small" aria-label="Cards on this page">
        {anchors.map(([id, title]) => (
          <a key={id} className="fchip" href={`#${id}`}>
            {title}
          </a>
        ))}
      </nav>
      {CONFIG_GROUPS.map((g) => (
        <RuleGroupForm
          key={g.key}
          group={g}
          values={groupValues(g, config)}
          confirmed={confirmed.includes(g.key)}
        />
      ))}
      <LiquidityForm c={config.liquidity} confirmed={confirmed.includes('liquidity')} />
      <p className="muted small">
        Capital-gains rates and the tax-free allowance are year by year: see{' '}
        <Link href={tabHref('tax')}>Tax rules</Link>.
      </p>
    </>
  );
}

/* -------------------------------------------------------------- Tax rules */

export interface TaxYear {
  v: TaxValues;
  custom: boolean;
  builtin: boolean;
  current: boolean;
  sources: { title: string; url: string }[];
}

export function TaxSection({ years, currentFy }: { years: TaxYear[]; currentFy: string }) {
  const now = years.find((y) => y.v.fy === currentFy);
  const others = years.filter((y) => y.v.fy !== currentFy);
  return (
    <>
      <SectionIntro>
        The tax-free allowance, the rates and the holding period are inputs, not facts built into
        the app. When the rules change, edit the year here or add the new year. A year with no entry
        assumes the latest earlier year, and the Tax page says so.
      </SectionIntro>
      <div id="tax">
        {now ? (
          <TaxRuleForm {...now} />
        ) : (
          <p className="notice warn">
            Nothing is entered for FY {currentFy}: the latest earlier year is assumed. Add the year
            below.
          </p>
        )}
      </div>
      {others.length > 0 && (
        <details className="disclose">
          <summary>Other years ({others.length})</summary>
          {others.map((y) => (
            <TaxRuleForm key={y.v.fy} {...y} />
          ))}
        </details>
      )}
      <details className="disclose" open={!now}>
        <summary>Add a financial year</summary>
        <TaxRuleForm
          isNew
          custom
          builtin={false}
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
      </details>
      <p className="muted small">
        Harvest limits and the refund inputs for NRO interest are in{' '}
        <Link href={tabHref('rules', 'harvest-rules')}>Money rules</Link>.
      </p>
    </>
  );
}

/* ---------------------------------------------------------- Notifications */

export interface DeliveryRow {
  date: string;
  channel: string;
  status: string;
  recipients: number;
  error: string | null;
}

export function NotificationsSection({
  digest,
  telegram,
  deliveries,
}: {
  digest: { enabled: boolean; extra: string[]; includeRetirement: boolean };
  telegram: { isSet: boolean; chatIds: string };
  deliveries: DeliveryRow[];
}) {
  return (
    <>
      <SectionIntro>
        The same short summary can reach you three ways. Each is separate: use one, two or all.
      </SectionIntro>
      <ul className="channels" aria-label="Where the summary goes">
        <li>
          <span>E-mail</span>
          <span className={`pill ${digest.enabled ? 'ok' : ''}`}>
            {digest.enabled ? 'On' : 'Off'}
          </span>
        </li>
        <li>
          <span>Telegram</span>
          <span className={`pill ${telegram.isSet ? 'ok' : ''}`}>
            {telegram.isSet ? 'On' : 'Off'}
          </span>
        </li>
        <li>
          <span>WhatsApp</span>
          <span className="pill">When you press it</span>
        </li>
      </ul>

      <section className="card" id="digest" aria-labelledby="digest-h">
        <h3 id="digest-h">Daily summary e-mail</h3>
        <p className="muted small">
          Estimated net worth, what changed, what needs attention, and how old each input is. Mail
          is sent from your own Gmail account, set up once (see the setup notes).
        </p>
        <DigestForm
          enabled={digest.enabled}
          includeRetirement={digest.includeRetirement}
          extra={digest.extra}
        />
      </section>

      <section className="card" id="telegram" aria-labelledby="telegram-h">
        <h3 id="telegram-h">Daily summary on Telegram (automatic)</h3>
        <p className="muted small">
          The same summary on your phone every day with nothing to press. Telegram’s bot service is
          free and needs no phone number or business account.{' '}
          <strong>{telegram.isSet ? 'Telegram is on.' : 'Telegram is off.'}</strong> The bot token
          is write-only: once saved it cannot be shown again.
        </p>
        <TelegramForm isSet={telegram.isSet} chatIds={telegram.chatIds} />
      </section>

      <section className="card" id="whatsapp" aria-labelledby="whatsapp-h">
        <h3 id="whatsapp-h">WhatsApp</h3>
        <p className="muted small">
          WhatsApp does not allow free automatic messages from a personal number, and unofficial
          tools risk the number being blocked. So this only opens WhatsApp with today’s summary
          ready for you to send. Use Telegram above for a fully automatic message.
        </p>
        <div className="row">
          <WhatsAppButton />
          <Link className="btn ghost" href="/share">
            Preview and copy the text
          </Link>
        </div>
      </section>

      <section className="card" id="deliveries" aria-labelledby="deliveries-h">
        <h3 id="deliveries-h">Recent deliveries</h3>
        {deliveries.length === 0 ? (
          <p className="empty">
            Nothing sent yet. Switch on the e-mail or Telegram above; the first summary goes out at
            08:30 Singapore time.
          </p>
        ) : (
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Date</th>
                <th>Channel</th>
                <th>Result</th>
                <th className="num">Recipients</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((r) => (
                <tr key={`${r.date}-${r.channel}`}>
                  <td data-label="Date">{niceDate(r.date)}</td>
                  <td data-label="Channel">{r.channel === 'telegram' ? 'Telegram' : 'E-mail'}</td>
                  <td data-label="Result">
                    {r.status === 'accepted_by_provider'
                      ? r.channel === 'telegram'
                        ? 'Sent to Telegram'
                        : 'Handed to the mail server'
                      : r.status === 'failed'
                        ? `Failed${r.error ? `: ${r.error}` : ''}`
                        : 'In progress'}
                  </td>
                  <td className="num" data-label="Recipients">
                    {r.recipients}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          “Handed to the mail server” is the most the app can know. It cannot confirm that an inbox
          received the message.
        </p>
      </section>
    </>
  );
}

/* ------------------------------------------------------------ Connections */

export interface RateSourceRow {
  id: string;
  bank: string;
  url: string;
  lastRunOn: string | null;
  lastResult: string | null;
}

export function ConnectionsSection({
  ai,
  sources,
  demo = false,
}: {
  ai: {
    provider: 'groq' | 'gemini' | 'openrouter' | null;
    keySet: boolean;
    label: string;
    testedAt?: string | null;
    testOk?: boolean | null;
    testNote?: string | null;
  };
  sources: RateSourceRow[];
  demo?: boolean;
}) {
  return (
    <>
      <SectionIntro>
        What the portal reads on your behalf: forwarded bank e-mails, PDF statements and the banks’
        published rates.
      </SectionIntro>
      <section className="card" id="email" aria-labelledby="email-h">
        <div className="sectionhead">
          <h3 id="email-h">Bank e-mails and AI</h3>
          <span className={`pill ${ai.keySet ? 'ok' : 'warn'}`}>
            {ai.keySet ? 'AI key saved' : 'No AI key'}
          </span>
        </div>
        <p className="muted small">
          Balance alerts from a bank’s own address are read by fixed rules and need no key. To read
          PDF statements and unfamiliar e-mails, add a free key from OpenRouter (recommended: it
          tries several free models one after another), Groq or Google AI Studio (Gemini). Account
          numbers are removed before any text is sent. See what the reader did in the{' '}
          <Link href="/inbox">bank e-mail inbox</Link>.
        </p>
        <AiConnection
          demo={demo}
          status={{
            provider: ai.provider,
            keySet: ai.keySet,
            testedAt: ai.testedAt ?? null,
            testOk: ai.testOk ?? null,
            testNote: ai.testNote ?? null,
          }}
        />
        <ol className="stepper small">
          <li>
            In Gmail, create a label (for example FWOS/Inbox) and a filter that applies it to bank
            e-mails.
          </li>
          <li>Type the label’s name below, exactly as it appears in Gmail.</li>
          <li>Paste an AI key. It is stored on the server and is never shown again.</li>
        </ol>
        <IntegrationsForm provider={ai.provider} keySet={ai.keySet} label={ai.label} />
      </section>

      <section className="card" id="rates" aria-labelledby="rates-h">
        <h3 id="rates-h">Bank rate pages</h3>
        <p className="muted small">
          List the page where each bank publishes its deposit rates. Every Monday the app reads them
          with your AI key and keeps the rates with the date it checked. Rates you type on the{' '}
          <Link href="/rates">Rates page</Link> are never overwritten. To refresh now: GitHub &gt;
          Actions &gt; Refresh interest rates &gt; Run workflow.
        </p>
        {!ai.keySet && sources.length > 0 && (
          <p className="notice warn small">
            Rate pages are read with the AI key above, and none is saved yet.
          </p>
        )}
        {sources.length === 0 ? (
          <p className="empty">
            No rate pages yet. Add the first one below; the Rates page then fills itself every
            Monday.
          </p>
        ) : (
          <table className="tbl lines responsive">
            <thead>
              <tr>
                <th>Bank and page</th>
                <th>Last read</th>
                <th>Check</th>
                <th>
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((r) => (
                <tr key={r.id}>
                  <td data-label="Bank and page">
                    <strong>{r.bank}</strong>
                    <div className="small muted" style={{ wordBreak: 'break-all' }}>
                      {r.url}
                    </div>
                  </td>
                  <td className="small muted" data-label="Last read">
                    {r.lastRunOn
                      ? `${niceDate(r.lastRunOn)}${r.lastResult ? `: ${r.lastResult}` : ''}`
                      : 'Not read yet'}
                  </td>
                  <td data-label="Check">
                    <RateCheckButton id={r.id} bank={r.bank} />
                  </td>
                  <td>
                    <form action={deleteRateSource}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn compact ghost" aria-label={`Remove ${r.bank}`}>
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
    </>
  );
}

/* ------------------------------------------------------ Emergency and access */

const PROFILE_FIELDS: [keyof EmergencyProfile, string][] = [
  ['message', 'a message to the family'],
  ['willLocation', 'where the will is'],
  ['documentsLocation', 'where the documents are'],
  ['lockerDetails', 'the bank locker'],
  ['passwordManager', 'where the passwords are'],
  ['devices', 'the devices'],
  ['emailAccounts', 'the e-mail accounts'],
  ['backupKeyLocation', 'where the backup key is'],
  ['nominees', 'the nominees'],
];

export function AccessSection({
  profile,
  access,
}: {
  profile: EmergencyProfile;
  access: { mode: 'always' | 'inactive' | 'manual'; days: number; released: boolean };
}) {
  const missing = PROFILE_FIELDS.filter(([k]) => !String(profile[k]).trim()).map(([, l]) => l);
  const filled = PROFILE_FIELDS.length - missing.length;
  return (
    <>
      <SectionIntro>
        The family handbook is written from your records plus what you enter here. The read-only
        family login can open it without seeing anything else.
      </SectionIntro>
      <div id="emergency">
        <section className="card" id="access" aria-labelledby="access-h">
          <div className="sectionhead">
            <h3 id="access-h">Who can open the handbook, and when</h3>
            <Link className="btn compact" href="/emergency">
              Open the handbook
            </Link>
          </div>
          <AccessForm mode={access.mode} days={access.days} released={access.released} />
        </section>

        <section className="card" id="handbook" aria-labelledby="handbook-h">
          <div className="sectionhead">
            <h3 id="handbook-h">What the handbook says</h3>
            <span
              className={`pill ${missing.length === 0 && profile.contacts.length > 0 ? 'ok' : 'warn'}`}
            >
              {filled} of {PROFILE_FIELDS.length} filled · {profile.contacts.length}{' '}
              {profile.contacts.length === 1 ? 'person' : 'people'} to call
            </span>
          </div>
          {(missing.length > 0 || profile.contacts.length === 0) && (
            <p className="notice warn small" role="note">
              Still empty:{' '}
              {[profile.contacts.length === 0 ? 'who to call first' : '', ...missing]
                .filter(Boolean)
                .join(', ')}
              . Each empty item shows as “not recorded” in the handbook.
            </p>
          )}
          <EmergencyForm p={profile} />
        </section>
      </div>
    </>
  );
}
