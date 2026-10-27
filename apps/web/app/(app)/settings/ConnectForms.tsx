'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import {
  addRateSource,
  checkRatePage,
  readPastedRatePage,
  saveDigestSettings,
  saveInboxLabel,
} from './actions';
import type { RateCheck } from '@fwos/ingest';
import { Field, SaveRow, Tick, useForm } from './fields';

export function DigestForm({
  enabled,
  includeRetirement,
  includeGoals,
  extra,
  previewHref,
}: {
  enabled: boolean;
  includeRetirement: boolean;
  includeGoals: boolean;
  extra: string[];
  previewHref: string;
}) {
  const { res, act, pending } = useForm(saveDigestSettings);
  return (
    <form action={act} className="form" aria-busy={pending}>
      <Tick
        name="enabled"
        label="Send the daily summary by e-mail"
        hint="At 08:30 Singapore time, to everyone who can sign in to this household."
        defaultChecked={enabled}
      />
      <Tick
        name="include_goals"
        label="Include the goals view"
        hint="Each goal with how far it is and whether the current pace reaches it."
        defaultChecked={includeGoals}
      />
      <Tick
        name="include_retirement"
        label="Include the retirement view"
        hint="Added only when you have saved retirement assumptions."
        defaultChecked={includeRetirement}
      />
      <Field
        label="Extra recipients"
        hint="Up to five addresses, separated by commas. They receive the same summary."
      >
        <input name="extra" defaultValue={extra.join(', ')} placeholder="parent@example.com" />
      </Field>
      <SaveRow label="Save e-mail settings" pending={pending} res={res} />
      <p className="muted small">
        <Link href={previewHref}>Preview today’s e-mail</Link> shows it as it would arrive, on a
        phone and on a laptop.
      </p>
    </form>
  );
}

/** The Gmail label the reader looks at. (The AI keys are in AiKeysCard.) */
export function InboxLabelForm({ label }: { label: string }) {
  const { res, act, pending } = useForm(saveInboxLabel);
  return (
    <form action={act} className="form" aria-busy={pending}>
      <Field
        label="Gmail label with forwarded bank e-mails"
        hint="The reader looks only at e-mails carrying this label."
      >
        <input name="label" defaultValue={label} />
      </Field>
      <SaveRow label="Save label" pending={pending} res={res} />
    </form>
  );
}

export function RateSourceForm() {
  const { res, act, pending } = useForm(addRateSource);
  return (
    <form action={act} className="form addflow" aria-busy={pending}>
      <h4>Add a rate page</h4>
      <div className="formgrid">
        <Field label="Bank name" hint="As you want it shown on the Rates page.">
          <input name="bank" required />
        </Field>
        <Field
          label="Address of the bank’s rate page"
          hint="The full address, starting with https://, of the page that lists its deposit rates."
        >
          <input name="url" inputMode="url" placeholder="https://" required />
        </Field>
      </div>
      <SaveRow label="Add page" pending={pending} res={res} />
    </form>
  );
}

/** Tests one bank's rate page now (page read, AI reading) and shows each step; nothing is saved. */
export function RateCheckButton({ id, bank }: { id: string; bank: string }) {
  const [res, setRes] = useState<RateCheck | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="ratecheck">
      <button
        type="button"
        className="btn compact"
        disabled={pending}
        aria-label={`Check whether ${bank} can be synced`}
        onClick={() =>
          start(async () => {
            setRes(null);
            setRes(await checkRatePage(id));
          })
        }
      >
        {pending ? 'Checking…' : 'Check sync'}
      </button>
      <div role="status" aria-live="polite">
        {res && (
          <details open className="ratecheck-out">
            <summary className={res.ok ? 'ok' : 'bad'}>
              <span aria-hidden="true">{res.ok ? '✓ ' : '✗ '}</span>
              {res.verdict}
            </summary>
            <ul className="small muted">
              {res.steps.map((s, i) => (
                <li key={i}>
                  <span aria-hidden="true">{s.ok ? '✓ ' : '✗ '}</span>
                  {s.text}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}

/**
 * For a bank whose page a program cannot open: open it in your own browser, copy all the text, paste it here. The rates are read from the
 * text and saved like a refresh. Nothing is sent from the bank's site by this program.
 */
export function PastePageBox({ id, bank }: { id: string; bank: string }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <details className="pastepage">
      <summary>Paste the page instead</summary>
      <p className="small muted">
        Open {bank}&apos;s rate page in your own browser, press Ctrl+A (Cmd+A on a Mac), Ctrl+C, and
        paste below. The rates are read from the text and saved; a rate you typed is never
        overwritten.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        aria-label={`Text copied from the ${bank} rate page`}
        placeholder="Paste the whole page here"
      />
      <button
        type="button"
        className="btn compact"
        disabled={pending || text.trim().length === 0}
        onClick={() =>
          start(async () => {
            setRes(null);
            const r = await readPastedRatePage(id, text);
            setRes(r);
            if (r.ok) setText('');
          })
        }
      >
        {pending ? 'Reading…' : 'Read the rates'}
      </button>
      <div role="status" aria-live="polite">
        {res && <p className={`small ${res.ok ? 'ok' : 'bad'}`}>{res.message}</p>}
      </div>
    </details>
  );
}
