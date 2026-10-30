'use client';

import { useState } from 'react';
import { contactLines, parseContactLines, type Contact, type EmergencyProfile } from '@fwos/core';
import { saveEmergencyAccess, saveEmergencyProfile } from './actions';
import { Field, Msg, SaveRow, useForm } from './fields';

export function AccessForm({
  mode,
  days,
  released,
  daysSetBelow = false,
}: {
  mode: 'always' | 'inactive' | 'manual';
  days: number;
  released: boolean;
  /** the inactivity alert's form below sets the days (once its database update is applied) */
  daysSetBelow?: boolean;
}) {
  const { res, act, pending } = useForm(saveEmergencyAccess);
  return (
    <form action={act} className="form" aria-busy={pending}>
      <fieldset className="choices">
        <legend>The read-only family login can open the handbook</legend>
        <label className="choice">
          <input type="radio" name="mode" value="always" defaultChecked={mode === 'always'} />
          <span>
            <b>Always</b>
            <span className="fld-hint">
              Simplest. The login shows the handbook and nothing else.
            </span>
          </span>
        </label>
        <label className="choice">
          <input type="radio" name="mode" value="inactive" defaultChecked={mode === 'inactive'} />
          <span>
            <b>Only after nobody from the household has signed in for</b>{' '}
            {daysSetBelow ? (
              <b>{days}</b>
            ) : (
              <input
                className="mini"
                name="days"
                inputMode="numeric"
                defaultValue={days}
                aria-label="Days without a sign-in"
              />
            )}{' '}
            days
            {daysSetBelow && (
              <span className="fld-hint">
                The same day the first trusted person is told; change it under “If you stop using
                the portal” below.
              </span>
            )}
            <span className="fld-hint">It opens by itself if something happens to all of you.</span>
          </span>
        </label>
        <label className="choice">
          <input type="radio" name="mode" value="manual" defaultChecked={mode === 'manual'} />
          <span>
            <b>Only when I release it</b>
            <span className="fld-hint">Use the buttons below; you can lock it again.</span>
          </span>
        </label>
      </fieldset>
      <p className="muted small">
        Right now: {released ? 'released by hand' : 'not released by hand'}. Household members can
        always open it.
      </p>
      <div className="saverow">
        <button className="btn primary" name="intent" value="save" disabled={pending}>
          Save
        </button>
        <button className="btn" name="intent" value="release" disabled={pending}>
          Release now
        </button>
        <button className="btn" name="intent" value="lock" disabled={pending}>
          Lock again
        </button>
        <Msg r={res} pending={pending} />
      </div>
    </form>
  );
}

const clean = (s: string) => s.replace(/[|\r\n]+/g, ' ').trim();

/**
 * People to call, one row each. The rows travel as one hidden field in the same “name | who | phone | note” lines the
 * handbook reads, so adding a person is a button, not a text format to remember.
 */
function ContactRows({
  name,
  label,
  hint,
  initial,
  roleLabel,
}: {
  name: string;
  label: string;
  hint: string;
  initial: Contact[];
  roleLabel: string;
}) {
  const [rows, setRows] = useState<Contact[]>(
    initial.length > 0 ? initial : [{ name: '', relation: '', phone: '', note: '' }],
  );
  const set = (i: number, k: keyof Contact, v: string) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const value = contactLines(
    parseContactLines(
      rows
        .filter((r) => r.name.trim())
        .map((r) => [r.name, r.relation, r.phone, r.note].map(clean).join(' | '))
        .join('\n'),
    ),
  );
  return (
    <fieldset className="contacts">
      <legend>{label}</legend>
      <p className="fld-hint">{hint}</p>
      <input type="hidden" name={name} value={value} />
      {rows.map((r, i) => (
        <div className="contactrow" key={i}>
          <input
            value={r.name}
            onChange={(e) => set(i, 'name', e.target.value)}
            aria-label={`${label}: name, row ${i + 1}`}
            placeholder="Name"
          />
          <input
            value={r.relation}
            onChange={(e) => set(i, 'relation', e.target.value)}
            aria-label={`${label}: ${roleLabel}, row ${i + 1}`}
            placeholder={roleLabel}
          />
          <input
            value={r.phone}
            onChange={(e) => set(i, 'phone', e.target.value)}
            aria-label={`${label}: phone, row ${i + 1}`}
            placeholder="Phone, with country code"
            inputMode="tel"
          />
          <input
            value={r.note}
            onChange={(e) => set(i, 'note', e.target.value)}
            aria-label={`${label}: note, row ${i + 1}`}
            placeholder="Note, e.g. knows where the papers are"
          />
          <button
            type="button"
            className="btn compact ghost"
            onClick={() =>
              setRows((x) =>
                x.length > 1
                  ? x.filter((_, j) => j !== i)
                  : [{ name: '', relation: '', phone: '', note: '' }],
              )
            }
            aria-label={`Remove row ${i + 1} of ${label}`}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn compact"
        onClick={() => setRows((x) => [...x, { name: '', relation: '', phone: '', note: '' }])}
      >
        Add a person
      </button>
    </fieldset>
  );
}

export function EmergencyForm({ p }: { p: EmergencyProfile }) {
  const { res, act, pending } = useForm(saveEmergencyProfile);
  const area = (name: string, label: string, value: string, hint: string, rows = 2) => (
    <Field label={label} hint={hint}>
      <textarea name={name} rows={rows} defaultValue={value} />
    </Field>
  );
  return (
    <form action={act} className="form" aria-busy={pending}>
      <Field
        label="A message to the family"
        hint="Shown first in the handbook, and in the short version for the children. Say it in your own words."
        wide
      >
        <textarea
          name="message"
          rows={3}
          defaultValue={p.message}
          placeholder="e.g. We made this so you are never left wondering what to do."
        />
      </Field>
      <ContactRows
        name="contacts"
        label="Call these people first"
        hint="In the order they should be called. The handbook shows these on its first page, with phone links."
        initial={p.contacts}
        roleLabel="Who they are"
      />
      <ContactRows
        name="advisors"
        label="Advisers: lawyer, accountant, insurance agent"
        hint="People who know the paperwork."
        initial={p.advisors}
        roleLabel="Role"
      />
      <h4>Where things are</h4>
      <p className="muted small">
        Say <em>where</em> things are, never what they are: no passwords, PINs or account numbers
        belong here.
      </p>
      <div className="formgrid">
        {area(
          'willLocation',
          'The will and estate papers',
          p.willLocation,
          'Who holds the original, and where a copy is.',
        )}
        {area(
          'documentsLocation',
          'Other important documents',
          p.documentsLocation,
          'Passports, property papers, insurance policies.',
        )}
        {area('lockerDetails', 'Bank locker', p.lockerDetails, 'Bank, branch and who has the key.')}
        {area(
          'passwordManager',
          'Passwords and logins',
          p.passwordManager,
          'Which password manager is used and who can open it.',
        )}
        {area(
          'devices',
          'Phones, computers and other devices',
          p.devices,
          'Where they are and how to unlock them.',
        )}
        {area(
          'emailAccounts',
          'E-mail accounts used for banks and investments',
          p.emailAccounts,
          'The addresses, not the passwords.',
        )}
        {area(
          'backupKeyLocation',
          'Key to the encrypted backups of this app',
          p.backupKeyLocation,
          'Where it is kept and who has it.',
        )}
        {area(
          'nominees',
          'Nominees on accounts, funds and policies',
          p.nominees,
          'Who, for which.',
        )}
      </div>
      {area(
        'instructions',
        'Anything else the family should know or do',
        p.instructions,
        'Wishes, deadlines, people to tell.',
        4,
      )}
      <SaveRow label="Save emergency information" pending={pending} res={res} />
    </form>
  );
}
