'use client';

import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react';
import type { AiProvider } from '@fwos/ingest';
// the provider names only: importing the whole package would put its readers in the browser bundle
import { AI_PROVIDERS, PROVIDER_NAME } from '@fwos/ingest/src/ai-providers';
import {
  inOrder,
  moveKey,
  renumbered,
  roleOf,
  summaryPill,
  testStatus,
  unusedProviders,
  usageStatus,
  type AiKeyRow,
} from '@/lib/ai-key-view';
import { demoTestChain, demoTestKey } from '@/lib/demo-ai-keys';
import {
  moveAiKey,
  removeAiKey,
  saveAiKey,
  setAiKeyEnabled,
  testAiKey,
  testAiKeys,
  type AiTestState,
  type FormResult,
} from './actions';
import { Field } from './fields';

/** What the card can do. The live card calls the server actions; the public sample changes its own list and sends nothing. */
export interface AiKeyHandlers {
  save(provider: AiProvider, key: string, label: string): Promise<FormResult>;
  setEnabled(provider: AiProvider, enabled: boolean): Promise<FormResult>;
  move(provider: AiProvider, direction: 'up' | 'down'): Promise<FormResult>;
  remove(provider: AiProvider): Promise<FormResult>;
  testKey(provider: AiProvider): Promise<AiTestState>;
  testChain(): Promise<AiTestState>;
}

const liveHandlers: AiKeyHandlers = {
  save: saveAiKey,
  setEnabled: setAiKeyEnabled,
  move: moveAiKey,
  remove: removeAiKey,
  testKey: testAiKey,
  testChain: testAiKeys,
};

/** The AI keys of the household, with their order, switches, tests and the form to add one. */
export function AiKeys({ keys }: { keys: AiKeyRow[] }) {
  return <AiKeysPanel keys={keys} handlers={liveHandlers} />;
}

/** The same card on the public sample: invented keys, changes kept only on this page, nothing sent anywhere. */
export function AiKeysSample({ initial }: { initial: AiKeyRow[] }) {
  const [keys, setKeys] = useState(initial);
  const handlers: AiKeyHandlers = {
    async save(provider, key, label) {
      if (key.trim().length < 8)
        return { ok: false, message: 'That does not look like an API key. Paste the whole key.' };
      // the sample never keeps what was typed
      const known = keys.find((k) => k.provider === provider);
      const fresh: AiKeyRow = {
        provider,
        priority: known?.priority ?? keys.length + 1,
        enabled: known?.enabled ?? true,
        label: label.trim() || known?.label || null,
        lastOkAt: null,
        lastModel: null,
        lastErrorAt: null,
        lastErrorStatus: null,
        lastError: null,
        testedAt: null,
        testOk: null,
        testNote: null,
      };
      setKeys(renumbered([...keys.filter((k) => k.provider !== provider), fresh]));
      return { ok: true, message: 'Saved (sample: nothing is stored).' };
    },
    async setEnabled(provider, enabled) {
      setKeys(keys.map((k) => (k.provider === provider ? { ...k, enabled } : k)));
      return {
        ok: true,
        message: enabled ? 'Switched on.' : 'Switched off. The key is kept but not used.',
      };
    },
    async move(provider, direction) {
      setKeys(moveKey(keys, provider, direction));
      return { ok: true, message: direction === 'up' ? 'Moved up.' : 'Moved down.' };
    },
    async remove(provider) {
      setKeys(renumbered(keys.filter((k) => k.provider !== provider)));
      return { ok: true, message: 'The key is removed.' };
    },
    testKey: async (provider) => demoTestKey(provider),
    testChain: async () => demoTestChain(keys),
  };
  return <AiKeysPanel keys={keys} handlers={handlers} demo />;
}

const POSITION = (i: number, n: number) => `position ${i + 1} of ${n}`;

function TestOutput({ state, heading }: { state: AiTestState; heading: string }) {
  return (
    <div className="aikey-out">
      <p
        className={`notice ${state.ok ? 'ok' : 'warn'} small`}
        role={state.ok ? 'status' : 'alert'}
      >
        {heading}
      </p>
      <ul className="list small">
        {state.steps.map((x, i) => (
          <li key={i} className={x.neutral ? 'muted' : x.ok ? 'pass' : 'fail'}>
            <strong>{x.neutral ? 'Not asked' : x.ok ? 'OK' : 'Problem'}</strong> — {x.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AiKeysPanel({
  keys,
  handlers,
  demo = false,
}: {
  keys: AiKeyRow[];
  handlers: AiKeyHandlers;
  demo?: boolean;
}) {
  const sorted = inOrder(keys);
  const roles = roleOf(keys);
  const pill = summaryPill(keys);
  const free = unusedProviders(AI_PROVIDERS, keys);
  const anyOn = keys.some((k) => k.enabled);

  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<FormResult | null>(null);
  const [tests, setTests] = useState<Partial<Record<AiProvider, AiTestState>>>({});
  const [chain, setChain] = useState<AiTestState | null>(null);
  const [adding, setAdding] = useState<AiProvider | ''>('');
  // the button to put the focus back on after a key has moved (moving a row in the page drops the focus)
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (refocus.current) {
      document.getElementById(refocus.current)?.focus();
      refocus.current = null;
    }
  }, [keys]);

  const name = (p: AiProvider) => PROVIDER_NAME[p];
  /** a test result no longer describes a key that was replaced or removed */
  const forget = (p: AiProvider) =>
    setTests((t) => Object.fromEntries(Object.entries(t).filter(([k]) => k !== p)));
  const run = (what: string, job: () => Promise<void>) => {
    setBusy(what);
    start(async () => {
      try {
        await job();
      } finally {
        setBusy(null);
      }
    });
  };
  const report = async (p: AiProvider, job: Promise<FormResult>) => {
    const r = await job;
    setSaid({ ok: r.ok, message: `${name(p)}: ${r.message}` });
    return r;
  };

  const move = (p: AiProvider, direction: 'up' | 'down', index: number) => {
    const target = direction === 'up' ? index - 1 : index + 1;
    // keep the focus on the same direction unless the key has reached that end of the list
    const stays = direction === 'up' ? target > 0 : target < sorted.length - 1;
    refocus.current = `aikey-${p}-${stays ? direction : direction === 'up' ? 'down' : 'up'}`;
    run(`move:${p}`, async () => {
      await report(p, handlers.move(p, direction));
    });
  };

  const onAdd = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const provider = String(data.get('provider') ?? '');
    const key = String(data.get('key') ?? '');
    const label = String(data.get('label') ?? '');
    if (!AI_PROVIDERS.includes(provider as AiProvider)) return;
    run('add', async () => {
      const r = await report(
        provider as AiProvider,
        handlers.save(provider as AiProvider, key, label),
      );
      if (r.ok) {
        form.reset();
        setAdding('');
      }
    });
  };

  const onReplace = (e: FormEvent<HTMLFormElement>, p: AiProvider) => {
    e.preventDefault();
    const form = e.currentTarget;
    const key = String(new FormData(form).get('key') ?? '');
    run(`replace:${p}`, async () => {
      const r = await report(p, handlers.save(p, key, ''));
      if (r.ok) {
        form.reset();
        forget(p);
      }
    });
  };

  return (
    <div className="aikeys-block" aria-busy={pending}>
      <div className="aikeys-head">
        <h4 id="aikeys-h">AI keys</h4>
        <span className={`pill ${pill.tone}`}>{pill.text}</span>
      </div>
      <p className="muted small aikeys-how">
        How the order works: the key marked <strong>First choice</strong> is asked first. If it
        fails (refused, out of credit, busy, too slow, or an answer that cannot be used), the next
        key that is switched on is asked, and so on, until one answers. A key that is refused or out
        of credit is skipped for the rest of that job, so one broken key does not slow every page
        down. A key switched off is kept but never used.
      </p>

      {sorted.length === 0 ? (
        <p className="notice warn small" role="status">
          <strong>No AI key yet.</strong> Add one below; then come back here to test it. Add a
          second one as a fallback if you like.
        </p>
      ) : (
        <ol className="aikeys" aria-labelledby="aikeys-h">
          {sorted.map((k, i) => {
            const nm = name(k.provider);
            const use = usageStatus(k);
            const last = testStatus(k);
            const result = tests[k.provider];
            const off = !k.enabled;
            return (
              <li key={k.provider} className={`aikey${off ? ' off' : ''}`}>
                <div className="aikey-head">
                  <span className="aikey-no" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div className="aikey-title">
                    <strong>{nm}</strong>
                    {k.label && <span className="muted small"> · {k.label}</span>}
                    <span className={`pill ${off ? '' : 'info'}`}>{roles.get(k.provider)}</span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={k.enabled}
                    aria-label={`Use the ${nm} key`}
                    className="aiswitch"
                    disabled={pending}
                    onClick={() =>
                      run(`switch:${k.provider}`, async () => {
                        await report(k.provider, handlers.setEnabled(k.provider, !k.enabled));
                      })
                    }
                  >
                    <span className="aiswitch-track" aria-hidden="true">
                      <span className="aiswitch-knob" />
                    </span>
                    <span className="aiswitch-text">{k.enabled ? 'On' : 'Off'}</span>
                  </button>
                </div>
                <p className={`aikey-status small ${use.tone}`}>{use.text}</p>
                {last && <p className={`aikey-status small ${last.tone}`}>{last.text}</p>}
                <div className="aikey-actions">
                  <button
                    type="button"
                    id={`aikey-${k.provider}-up`}
                    className="btn compact"
                    disabled={pending || i === 0}
                    aria-label={`Move ${nm} up: tried earlier (now ${POSITION(i, sorted.length)})`}
                    onClick={() => move(k.provider, 'up', i)}
                  >
                    <span aria-hidden="true">↑</span> Move up
                  </button>
                  <button
                    type="button"
                    id={`aikey-${k.provider}-down`}
                    className="btn compact"
                    disabled={pending || i === sorted.length - 1}
                    aria-label={`Move ${nm} down: tried later (now ${POSITION(i, sorted.length)})`}
                    onClick={() => move(k.provider, 'down', i)}
                  >
                    <span aria-hidden="true">↓</span> Move down
                  </button>
                  <button
                    type="button"
                    className="btn compact"
                    disabled={pending}
                    aria-label={`Test the ${nm} key on its own`}
                    onClick={() =>
                      run(`test:${k.provider}`, async () => {
                        const r = await handlers.testKey(k.provider);
                        setTests((t) => ({ ...t, [k.provider]: r }));
                      })
                    }
                  >
                    {busy === `test:${k.provider}` ? 'Testing…' : 'Test this key'}
                  </button>
                  <button
                    type="button"
                    className="btn compact ghost"
                    disabled={pending}
                    aria-label={`Remove the ${nm} key`}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Remove the ${nm} key? It is deleted from the server and cannot be shown again; you would paste it again to use it.`,
                        )
                      )
                        return;
                      run(`remove:${k.provider}`, async () => {
                        await report(k.provider, handlers.remove(k.provider));
                        forget(k.provider);
                      });
                    }}
                  >
                    Remove
                  </button>
                </div>
                <details className="aikey-replace">
                  <summary>Replace the key</summary>
                  <form onSubmit={(e) => onReplace(e, k.provider)} className="aikey-replaceform">
                    <Field
                      label={`New ${nm} key`}
                      hint="It replaces the saved key and keeps its place in the order. It cannot be shown again."
                    >
                      <input
                        name="key"
                        type="password"
                        autoComplete="off"
                        required
                        placeholder="paste the new key"
                      />
                    </Field>
                    <button className="btn compact" disabled={pending}>
                      {busy === `replace:${k.provider}` ? 'Saving…' : 'Replace key'}
                    </button>
                  </form>
                </details>
                <div aria-live="polite">
                  {result && !(busy === `test:${k.provider}`) && (
                    <TestOutput
                      state={result}
                      heading={
                        result.ok
                          ? `Tested the ${nm} key on its own: it works and reads a bank alert correctly.`
                          : `Tested the ${nm} key on its own: not working yet. See below.`
                      }
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <div className="aikeys-chain">
        <button
          type="button"
          className="btn"
          disabled={pending || !anyOn}
          title={anyOn ? undefined : 'Switch a key on first'}
          onClick={() =>
            run('chain', async () => {
              setChain(null);
              setChain(await handlers.testChain());
            })
          }
        >
          {busy === 'chain' ? 'Testing the chain… (up to a minute)' : 'Test the whole chain'}
        </button>
        <span className="muted small">
          Asks the keys that are on, in order, as the jobs do, and says which one answers.
        </span>
      </div>
      <div aria-live="polite">
        {chain && busy !== 'chain' && (
          <TestOutput
            state={chain}
            heading={
              chain.ok
                ? `The chain works: ${chain.answeredBy ? name(chain.answeredBy) : 'a key'} would answer.`
                : 'No key could answer. See below.'
            }
          />
        )}
      </div>

      {free.length === 0 ? (
        <p className="muted small">Every service already has a key.</p>
      ) : (
        <form onSubmit={onAdd} className="form addflow aikeys-add" aria-busy={busy === 'add'}>
          <h4>Add a key</h4>
          <div className="formgrid g3">
            <Field
              label="AI service"
              hint="Claude Haiku is the most reliable and costs well under a rupee a month here; the others are free but some of their models are slow or restricted."
            >
              <select
                name="provider"
                value={adding || free[0]}
                onChange={(e) => setAdding(e.target.value as AiProvider)}
              >
                {free.map((p) => (
                  <option key={p} value={p}>
                    {name(p)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="API key"
              hint="Paste the key once. It is stored on the server and cannot be shown again."
            >
              <input
                name="key"
                type="password"
                autoComplete="off"
                required
                placeholder="paste key"
              />
            </Field>
            <Field label="Name (optional)" hint="Only to tell two keys of yours apart.">
              <input name="label" maxLength={60} autoComplete="off" />
            </Field>
          </div>
          <div className="saverow">
            <button className="btn primary" disabled={pending}>
              {busy === 'add' ? 'Saving…' : 'Add key'}
            </button>
          </div>
        </form>
      )}

      <div aria-live="polite" className="aikeys-said">
        {said && (
          <p className={`small ${said.ok ? 'ok' : 'fail'}`} role={said.ok ? 'status' : 'alert'}>
            {said.ok ? '✓ ' : ''}
            {said.message}
          </p>
        )}
      </div>
      {demo && (
        <p className="muted small">
          This is a sample: the keys are invented, changes stay on this page, and nothing is sent or
          saved.
        </p>
      )}
    </div>
  );
}
