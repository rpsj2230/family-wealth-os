'use client';

import { addRateSource, saveDigestSettings, saveIntegrations } from './actions';
import { Field, SaveRow, Tick, useForm } from './fields';

export function DigestForm({
  enabled,
  includeRetirement,
  extra,
}: {
  enabled: boolean;
  includeRetirement: boolean;
  extra: string[];
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
    </form>
  );
}

/** The AI key is write-only: a saved key is never shown, only replaced or removed. */
export function IntegrationsForm({
  provider,
  keySet,
  label,
}: {
  provider: 'groq' | 'gemini' | 'openrouter' | null;
  keySet: boolean;
  label: string;
}) {
  const { res, act, pending } = useForm(saveIntegrations);
  return (
    <form action={act} className="form" aria-busy={pending}>
      <div className="formgrid g3">
        <Field label="AI service" hint="Both have a free tier that is enough for this household.">
          <select name="provider" defaultValue={provider ?? 'openrouter'}>
            <option value="openrouter">OpenRouter (free models, tried one after another)</option>
            <option value="groq">Groq</option>
            <option value="gemini">Google Gemini</option>
          </select>
        </Field>
        <Field
          label={keySet ? 'API key (one is saved)' : 'API key'}
          hint={
            keySet
              ? 'Leave empty to keep the saved key. It cannot be shown again; a new one replaces it.'
              : 'Paste the key once. It is stored on the server and cannot be shown again.'
          }
        >
          <input
            name="key"
            type="password"
            autoComplete="off"
            placeholder={keySet ? '••••••••' : 'paste key'}
          />
        </Field>
        <Field
          label="Gmail label with forwarded bank e-mails"
          hint="The reader looks only at e-mails carrying this label."
        >
          <input name="label" defaultValue={label} />
        </Field>
      </div>
      {keySet && <Tick name="clear" label="Remove the saved key" />}
      <SaveRow label="Save" pending={pending} res={res} />
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
