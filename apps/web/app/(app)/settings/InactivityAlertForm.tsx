'use client';

import { useState, useTransition } from 'react';
import {
  alertSchedulePreview,
  alertSettingsProblem,
  DEFAULT_APP_URL,
  familyAlert,
  isWhatsAppKey,
  MAX_ALERT_CONTACTS,
  normalisePhone,
  type AlertContactView,
  type ChainView,
} from '@fwos/core';
import {
  saveInactivityAlert,
  sendInactivityTest,
  type AlertTestResult,
  type FormResult,
} from './actions';
import { Field, Msg } from './fields';

/** CallMeBot's activation (callmebot.com, checked 30 Oct 2026); kept here so the browser bundle needs nothing from the jobs. */
const CALLMEBOT_NUMBER = '+34 644 33 66 63';
const CALLMEBOT_ACTIVATION = 'I allow callmebot to send me messages';

export interface AlertNumbers {
  warnDays: number;
  alertDays: number;
  warnEveryDays: number;
  reminders: number;
  remindEveryDays: number;
}

export interface InactivityAlertProps {
  /** false until the database update that adds the alert is applied: the form is shown but cannot be saved */
  ready: boolean;
  values: AlertNumbers;
  contacts: AlertContactView[];
  /** read-only family logins in the household (null: not known) */
  familyLogins: number | null;
  /** household members with a full login */
  members: number;
  last: { absenceFrom: string; people: ChainView[] } | null;
  /** the public sample: nothing is saved or sent */
  demo?: boolean;
}

interface Row {
  uid: string;
  id?: string;
  name: string;
  email: string;
  phone: string;
  keySaved: boolean;
  keyMode: 'keep' | 'set' | 'clear';
  newKey: string;
}

let seq = 0;
const uid = () => `r${++seq}`;
const blank = (): Row => ({
  uid: uid(),
  name: '',
  email: '',
  phone: '',
  keySaved: false,
  keyMode: 'set',
  newKey: '',
});

const toNum = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const day = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Singapore',
      })
    : '—';

/** Whether a row will have a working WhatsApp after saving. */
const whatsAppOn = (r: Row) =>
  !!normalisePhone(r.phone) &&
  ((r.keySaved && r.keyMode === 'keep') || (r.keyMode === 'set' && isWhatsAppKey(r.newKey)));

async function sampleSave(): Promise<FormResult> {
  return { ok: true, message: 'This is a sample: nothing is saved.' };
}

async function sampleTest(names: string[]): Promise<AlertTestResult> {
  const m = familyAlert(
    {
      ownerName: 'Asha',
      appUrl: DEFAULT_APP_URL,
      familyLogins: ['family@example.com'],
      passwordWhere: 'In the 1Password family vault; Vikram knows the master password.',
      callFirst: { name: 'Ravi Menon', relation: 'my brother', phone: '+65 9000 0000' },
      mode: 'inactive',
      released: false,
      releaseBy: ['Asha', 'Vikram'],
      daysAbsent: 30,
    },
    { test: true, recipientName: names[0] || 'Ragini', confirmToken: 'TEST' },
  );
  return {
    ok: true,
    message: 'This is a sample: nothing is sent. Below is what the test e-mail says.',
    preview: { subject: m.subject, text: m.text },
  };
}

/** Settings > Emergency and access: the owner's warnings, the people told in order, and the latest chain. */
export function InactivityAlertForm(p: InactivityAlertProps) {
  const [nums, setNums] = useState({
    warnDays: String(p.values.warnDays),
    alertDays: String(p.values.alertDays),
    warnEveryDays: String(p.values.warnEveryDays),
    reminders: String(p.values.reminders),
    remindEveryDays: String(p.values.remindEveryDays),
  });
  const [rows, setRows] = useState<Row[]>(
    p.contacts.length > 0
      ? p.contacts.map((c) => ({
          uid: uid(),
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          keySaved: c.keySaved,
          keyMode: c.keySaved ? 'keep' : 'set',
          newKey: '',
        }))
      : [blank()],
  );
  const [res, setRes] = useState<FormResult | null>(null);
  const [test, setTest] = useState<AlertTestResult | null>(null);
  const [pending, start] = useTransition();
  const [testing, startTest] = useTransition();

  const parsed = {
    warnDays: toNum(nums.warnDays),
    alertDays: toNum(nums.alertDays),
    warnEveryDays: toNum(nums.warnEveryDays),
    reminders: toNum(nums.reminders),
    remindEveryDays: toNum(nums.remindEveryDays),
  };
  const problem = alertSettingsProblem(parsed);
  const names = rows.map((r) => r.name.trim()).filter(Boolean);
  const preview = problem
    ? problem
    : alertSchedulePreview(
        {
          warnDays: parsed.warnDays!,
          alertDays: parsed.alertDays!,
          warnEveryDays: parsed.warnEveryDays!,
          reminders: parsed.reminders!,
          remindEveryDays: parsed.remindEveryDays!,
        },
        names,
      );
  const set = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: -1 | 1) =>
    setRows((rs) => {
      const j = i + by;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const payload = JSON.stringify(
    rows
      .filter((r) => r.name.trim() || r.email.trim() || r.phone.trim())
      .map((r) => ({
        ...(r.id ? { id: r.id } : {}),
        name: r.name,
        email: r.email,
        phone: r.phone,
        key:
          r.keyMode === 'clear'
            ? { clear: true }
            : r.keyMode === 'set' && r.newKey.trim()
              ? { set: r.newKey.trim() }
              : r.keySaved
                ? { keep: true }
                : { clear: true },
      })),
  );
  const notActivated = rows
    .filter((r) => r.name.trim() && normalisePhone(r.phone) && !whatsAppOn(r))
    .map((r) => r.name.trim());
  const cannotReach = rows
    .filter((r) => r.name.trim() && !r.email.trim() && !whatsAppOn(r))
    .map((r) => r.name.trim());
  const everyone =
    p.members === 2
      ? 'Both members of the household get'
      : p.members === 1
        ? 'You get'
        : `All ${p.members} members of the household get`;
  const onSubmit = (f: FormData) =>
    start(async () => {
      setRes(p.demo ? await sampleSave() : await saveInactivityAlert(null, f));
    });
  const num = (k: keyof typeof nums, label: string, hint: string, unit: string) => (
    <Field label={label} hint={hint} unit={unit}>
      <input
        name={k}
        inputMode="numeric"
        className="mini"
        value={nums[k]}
        onChange={(e) => setNums((n) => ({ ...n, [k]: e.target.value }))}
      />
    </Field>
  );

  return (
    <div className="inactivity" data-testid="inactivity-alert">
      {!p.ready && (
        <p className="notice warn" role="note">
          Run the database update first (migration 20261030000100_emergency_guide.sql). Until then
          you can read how the alert works, but nothing can be saved or tested.
        </p>
      )}
      <ul className="list small inactivity-how">
        <li>
          <b>Your warnings.</b> From day {parsed.warnDays ?? '…'} without a sign-in, the members get
          an e-mail{' '}
          {Number(nums.warnEveryDays) > 1 ? `every ${nums.warnEveryDays} days` : 'every day'}: “Are
          you all right?”, how many days are left, and a button “I’m fine — postpone”. Signing in
          does the same.
        </li>
        <li>
          <b>The first person.</b> After {parsed.alertDays ?? '…'} days (the day the handbook opens
          to the family login) the first person below gets a short, calm message: that you kept the
          family’s money records here, the link, how to sign in with the family login, where the
          password is kept (your words under “Passwords and logins”), whom to call first, and a
          button “I have received this”. No amounts, no account numbers, no PDF.
        </li>
        <li>
          <b>Then the next.</b> Without a confirmation they are reminded, then the next person is
          told the same way. Everything stops when someone confirms or anyone from the household
          signs in. E-mail always; WhatsApp too for people who activated it.
        </li>
        <li>
          {everyone} an e-mail copy of every message (without the “I have received this” button), so
          you see exactly what was sent.
        </li>
      </ul>
      {p.familyLogins === 0 && (
        <p className="notice warn small" role="note">
          There is no read-only family login yet, so the people told could not sign in. Create one
          (Supabase, Authentication, Add user, then add it to the household as the emergency viewer)
          before you rely on this.
        </p>
      )}

      <form action={onSubmit} className="form" aria-busy={pending}>
        <fieldset disabled={!p.ready && !p.demo} className="inactivity-fields">
          <input type="hidden" name="contacts" value={payload} />
          <h4>When</h4>
          <div className="formgrid">
            {num(
              'warnDays',
              'Warn me from day',
              'Your first “Are you all right?” e-mail, 3 to 365, before the day below.',
              'days without a sign-in',
            )}
            {num(
              'warnEveryDays',
              'Warn me every',
              'Until the first person is told; 1 is every day, at most 14.',
              'days',
            )}
            {num(
              'alertDays',
              'Tell the first person after',
              '7 to 365. The handbook opens to the family login the same day.',
              'days',
            )}
            {num(
              'reminders',
              'Reminders for each person',
              '0 to 10, before the next person is told.',
              'reminders',
            )}
            {num('remindEveryDays', 'Days between reminders', '1 to 14.', 'days')}
          </div>
          <p
            className={`small ${problem ? 'fail' : 'muted'}`}
            aria-live="polite"
            data-testid="alert-preview"
          >
            {preview}
          </p>

          <h4>Who is told, in this order</h4>
          <ol className="alertpeople">
            {rows.map((r, i) => (
              <li key={r.uid} className="alertperson">
                <div className="contactrow alertrow">
                  <input
                    value={r.name}
                    onChange={(e) => set(i, { name: e.target.value })}
                    aria-label={`Person ${i + 1}: name`}
                    placeholder="Name"
                    maxLength={80}
                  />
                  <input
                    value={r.email}
                    onChange={(e) => set(i, { email: e.target.value })}
                    aria-label={`Person ${i + 1}: e-mail`}
                    placeholder="E-mail"
                    type="email"
                    autoComplete="off"
                  />
                  <input
                    value={r.phone}
                    onChange={(e) => set(i, { phone: e.target.value })}
                    aria-label={`Person ${i + 1}: WhatsApp number`}
                    placeholder="WhatsApp, with country code"
                    inputMode="tel"
                    autoComplete="off"
                  />
                  {r.keySaved && r.keyMode === 'keep' ? (
                    <span className="keysaved">
                      <span className="pill ok">WhatsApp key saved</span>
                      <button
                        type="button"
                        className="btn compact"
                        onClick={() => set(i, { keyMode: 'set', newKey: '' })}
                        aria-label={`Replace the WhatsApp key of person ${i + 1}`}
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        className="btn compact ghost"
                        onClick={() => set(i, { keyMode: 'clear' })}
                        aria-label={`Remove the WhatsApp key of person ${i + 1}`}
                      >
                        Remove key
                      </button>
                    </span>
                  ) : r.keyMode === 'clear' ? (
                    <span className="keysaved small">
                      The key is removed when you save.{' '}
                      <button
                        type="button"
                        className="btn compact ghost"
                        onClick={() => set(i, { keyMode: 'keep' })}
                      >
                        Undo
                      </button>
                    </span>
                  ) : (
                    <span className="keysaved">
                      <input
                        type="password"
                        autoComplete="off"
                        value={r.newKey}
                        onChange={(e) => set(i, { newKey: e.target.value })}
                        aria-label={`Person ${i + 1}: CallMeBot WhatsApp key`}
                        placeholder={r.keySaved ? 'New CallMeBot key' : 'CallMeBot key (optional)'}
                      />
                      {r.keySaved && (
                        <button
                          type="button"
                          className="btn compact ghost"
                          onClick={() => set(i, { keyMode: 'keep', newKey: '' })}
                        >
                          Keep the saved key
                        </button>
                      )}
                    </span>
                  )}
                </div>
                <div className="alertrow-tools">
                  <span className="muted small">
                    {i === 0 ? 'Told first' : `Then person ${i + 1}`}
                  </span>
                  <button
                    type="button"
                    className="btn compact ghost"
                    onClick={() => move(i, -1)}
                    disabled={i === 0}
                    aria-label={`Move person ${i + 1} up`}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="btn compact ghost"
                    onClick={() => move(i, 1)}
                    disabled={i === rows.length - 1}
                    aria-label={`Move person ${i + 1} down`}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="btn compact ghost"
                    onClick={() =>
                      setRows((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : [blank()]))
                    }
                    aria-label={`Remove person ${i + 1}`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="btn compact"
            disabled={rows.length >= MAX_ALERT_CONTACTS}
            onClick={() => setRows((x) => [...x, blank()])}
          >
            Add a person
          </button>
          <span className="muted small">
            {' '}
            At most {MAX_ALERT_CONTACTS}. With nobody on the list, the alert is off.
          </span>
          {notActivated.map((n) => (
            <p key={`wa-${n}`} className="notice warn small" role="note">
              WhatsApp not activated for {n}: {n} gets e-mail only until the CallMeBot key is saved.
            </p>
          ))}
          {cannotReach.map((n) => (
            <p key={`no-${n}`} className="notice warn small" role="note">
              {n} cannot be reached: add an e-mail address or activate WhatsApp.
            </p>
          ))}

          <details className="callmebot">
            <summary>How each person activates WhatsApp (free, once, on their own phone)</summary>
            <ol className="list small">
              <li>
                Save CallMeBot’s number <b>{CALLMEBOT_NUMBER}</b> in the phone’s contacts (any
                name). The number can change: check it at
                callmebot.com/blog/free-api-whatsapp-messages.
              </li>
              <li>
                From their own WhatsApp, send it the message <b>{CALLMEBOT_ACTIVATION}</b>.
              </li>
              <li>
                CallMeBot answers “API Activated for your phone number. Your APIKEY is 123123”. If
                nothing arrives within 2 minutes, try again after 24 hours.
              </li>
              <li>
                They tell you the key; paste it here with their WhatsApp number. It is stored on the
                server and never shown again.
              </li>
            </ol>
            <p className="muted small">
              CallMeBot is a free service for personal use, run by a third party: messages come from
              its number, not yours, and delivery is not guaranteed, so the e-mail always goes too.
              Tell each person what the message would be about, so it does not alarm them. The
              WhatsApp text leaves where the password is kept to the e-mail when the person has one.
            </p>
          </details>

          <div className="saverow">
            <button
              className="btn primary"
              disabled={pending || (!p.ready && !p.demo) || !!problem}
            >
              Save the alert
            </button>
            <button
              type="button"
              className="btn"
              disabled={testing || (!p.ready && !p.demo)}
              onClick={() =>
                startTest(async () => {
                  setTest(p.demo ? await sampleTest(names) : await sendInactivityTest());
                })
              }
            >
              {testing ? 'Sending…' : 'Send a test to me'}
            </button>
            <Msg r={res} pending={pending} />
          </div>
          <p className="muted small">
            The test sends the first person’s message to you only, marked TEST. Nobody on the list
            receives anything.
          </p>
        </fieldset>
      </form>
      <div aria-live="polite">
        {test && (
          <div className="alert-test" data-testid="alert-test">
            <p
              className={`notice ${test.ok ? 'ok' : 'warn'} small`}
              role={test.ok ? 'status' : 'alert'}
            >
              {test.message}
            </p>
            {test.preview && (
              <details open>
                <summary>{test.preview.subject}</summary>
                <pre className="alert-test-text">{test.preview.text}</pre>
              </details>
            )}
          </div>
        )}
      </div>

      <h4>Last alert</h4>
      {p.last ? (
        <table className="table small" data-testid="last-alert">
          <caption className="muted small">
            The absence that began {day(p.last.absenceFrom)}
          </caption>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Messages</th>
              <th scope="col">First, last</th>
              <th scope="col">Confirmed</th>
            </tr>
          </thead>
          <tbody>
            {p.last.people.map((x, i) => (
              <tr key={i}>
                <td>{x.name}</td>
                <td>{x.sends === 1 ? 'told once' : `told ${x.sends} times`}</td>
                <td>
                  {day(x.firstSentAt)}, {day(x.lastSentAt)}
                </td>
                <td>{x.confirmedAt ? `yes, ${day(x.confirmedAt)}` : 'not yet'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted small">Nobody has been told yet.</p>
      )}
    </div>
  );
}
