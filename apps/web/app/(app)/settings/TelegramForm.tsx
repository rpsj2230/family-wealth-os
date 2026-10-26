'use client';

import { useActionState, useState } from 'react';
import { findChats, saveTelegram, testTelegram, type TelegramState } from './telegram';

/** Three steps: make a bot, say hello to it, let the app find the chat. The token is never shown again once saved. */
export function TelegramForm({ isSet, chatIds }: { isSet: boolean; chatIds: string }) {
  const [chats, setChats] = useState(chatIds);
  const [found, findAct, finding] = useActionState(async (p: TelegramState | null, f: FormData) => {
    const r = await findChats(p, f);
    if (r.chats && r.chats.length > 0 && !chats) setChats(r.chats.map((c) => c.id).join(', '));
    return r;
  }, null);
  const [tested, testAct, testing] = useActionState(testTelegram, null);
  const [saved, saveAct, saving] = useActionState(saveTelegram, null);
  return (
    <form className="form" aria-busy={finding || testing || saving}>
      <ol className="stepper">
        <li>
          In Telegram open <b>@BotFather</b>, send <code>/newbot</code>, choose a name, and copy the
          token it gives you.
        </li>
        <li>
          Open your new bot, press <b>Start</b> and send it any message. To use a family group, add
          the bot to the group and write there.
        </li>
        <li>
          Paste the token below and press <b>Find my chat</b>. Then <b>Save</b>. The daily summary
          arrives by itself, free.
        </li>
      </ol>
      <label>
        Bot token {isSet ? '(one is saved; leave empty to keep it)' : ''}
        <input
          name="token"
          type="password"
          autoComplete="off"
          placeholder={isSet ? '••••••••' : '123456789:AA…'}
        />
      </label>
      <label>
        Chats that get the summary
        <input
          name="chats"
          value={chats}
          onChange={(e) => setChats(e.target.value)}
          placeholder="found for you, or paste chat numbers"
        />
      </label>
      {found?.chats && (
        <ul className="list small">
          {found.chats.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="linkbtn"
                onClick={() =>
                  setChats((cur) =>
                    cur.split(/[\s,]+/).includes(c.id) ? cur : cur ? `${cur}, ${c.id}` : c.id,
                  )
                }
              >
                Add {c.title}
              </button>{' '}
              <span className="muted">
                ({c.kind}, {c.id})
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <button className="btn" formAction={findAct} disabled={finding}>
          {finding ? 'Looking…' : 'Find my chat'}
        </button>
        <button className="btn" formAction={testAct} disabled={testing}>
          {testing ? 'Sending…' : 'Send a test'}
        </button>
        <button className="btn primary" formAction={saveAct} disabled={saving}>
          Save
        </button>
        {isSet && (
          <label className="check">
            <input type="checkbox" name="clear" /> Switch Telegram off
          </label>
        )}
      </div>
      {[found, tested, saved].map(
        (s, i) =>
          s && (
            <p
              key={i}
              role={s.ok ? 'status' : 'alert'}
              className={s.ok ? 'ok small' : 'fail small'}
            >
              {s.message}
            </p>
          ),
      )}
    </form>
  );
}
