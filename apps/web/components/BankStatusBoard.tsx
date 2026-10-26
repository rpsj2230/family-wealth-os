import type { BankStanding, SourceTag, StandingSummary } from '@fwos/core';
import { BankBadge } from './BankBadge';
import { Meter } from './Meter';
import { UpdatedCell } from './BankTable';
import './datain.css';

const STATE_PILL = {
  current: { tone: 'ok', text: 'Up to date' },
  waiting: { tone: 'warn', text: 'Waiting' },
  attention: { tone: 'bad', text: 'Needs you' },
} as const;

/** The kind of a source word, for the chip colour. */
function kindOf(word: string): SourceTag['kind'] {
  if (word === 'Calculated') return 'calc';
  if (word === 'You') return 'manual';
  if (word === 'Imported sheet') return 'import';
  if (word === 'No value yet') return 'none';
  return 'auto';
}

/**
 * Where each bank stands this month: counts, how the latest values arrived, and one line per bank with what it is waiting for.
 * The two buttons are given by the page (jump to the bank, mark it unchanged); without them the board is read-only.
 */
export function BankStatusBoard({
  standings,
  summary,
  monthLabel,
  onJump,
  onSame,
  sameCount,
}: {
  standings: BankStanding[];
  summary: StandingSummary;
  monthLabel: string;
  onJump?: (key: string) => void;
  onSame?: (key: string) => void;
  /** how many lines "nothing changed" would fill for a bank */
  sameCount?: (key: string) => number;
}) {
  const waitingBanks = summary.waiting + summary.attention;
  return (
    <section className="card board" aria-labelledby="board-h">
      <div className="board-head">
        <h2 id="board-h">Where each bank stands</h2>
        <span className="muted small">
          {summary.balancesCurrent} of {summary.balances} balances dated {monthLabel}
        </span>
      </div>
      <p style={{ margin: '0 0 10px' }}>
        {waitingBanks === 0 ? (
          <strong>Every bank is up to date for {monthLabel}.</strong>
        ) : (
          <>
            <strong>
              {summary.current} of {summary.banks} banks are up to date
            </strong>{' '}
            for {monthLabel}. {waitingBanks} still need a value.
            {summary.depositsToConfirm > 0 && (
              <>
                {' '}
                {summary.depositsToConfirm} matured deposit
                {summary.depositsToConfirm === 1 ? '' : 's'} need
                {summary.depositsToConfirm === 1 ? 's' : ''} you to say where the money went.
              </>
            )}
          </>
        )}
      </p>
      <Meter
        total={summary.banks}
        format={(n) => `${n} bank${n === 1 ? '' : 's'}`}
        parts={[
          { label: 'Up to date', value: summary.current, colour: '#16a34a' },
          { label: 'Waiting for a value', value: summary.waiting, colour: '#d97706' },
          { label: 'Needs you', value: summary.attention, colour: '#dc2626' },
        ]}
      />
      {summary.mix.length > 0 && (
        <p className="mixrow small">
          <span className="muted">How the latest balances arrived:</span>
          {summary.mix.map((m) => (
            <span key={m.word} className={`srcchip ${kindOf(m.word)}`}>
              {m.word} {m.count}
            </span>
          ))}
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Bank</th>
            <th>This month</th>
            <th>Latest value</th>
            <th>Still waiting</th>
            <th className="sr-only">Actions</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s) => {
            const pill = STATE_PILL[s.state];
            const n = sameCount?.(s.key) ?? 0;
            return (
              <tr key={s.key}>
                <td data-label="Bank">
                  <span className="bankcell">
                    <BankBadge name={s.name} size={26} />
                    {s.name}
                  </span>
                </td>
                <td data-label="This month">
                  <span className={`statuspill ${pill.tone}`}>
                    {s.state === 'current'
                      ? 'Up to date'
                      : s.state === 'waiting'
                        ? `${s.waiting} waiting`
                        : s.depositsToConfirm > 0 && s.waiting === 0
                          ? 'Deposit to confirm'
                          : 'Needs you'}
                  </span>
                </td>
                <td data-label="Latest value">
                  {s.lastSource ? (
                    <UpdatedCell asOf={s.lastUpdated} source={s.lastSource} />
                  ) : (
                    <span className="muted small">
                      {s.balances === 0 ? 'Deposits only' : 'No value yet'}
                    </span>
                  )}
                </td>
                <td data-label="Still waiting" className="small">
                  {s.waitingCodes.length > 0 ? (
                    s.waitingCodes.slice(0, 3).join(', ') +
                    (s.waitingCodes.length > 3 ? ` and ${s.waitingCodes.length - 3} more` : '')
                  ) : s.depositsToConfirm > 0 ? (
                    `${s.depositsToConfirm} matured deposit${s.depositsToConfirm === 1 ? '' : 's'}`
                  ) : (
                    <span className="muted">Nothing</span>
                  )}
                </td>
                <td>
                  <div className="acts">
                    {onJump && (
                      <button
                        type="button"
                        className="btn compact"
                        onClick={() => onJump(s.key)}
                        aria-label={`Go to ${s.name}`}
                      >
                        {s.state === 'current' ? 'Open' : 'Update'}
                      </button>
                    )}
                    {onSame && n > 0 && s.state !== 'current' && (
                      <button
                        type="button"
                        className="btn compact ghost"
                        onClick={() => onSame(s.key)}
                        title="Fills each box with the last balance, dated today. Nothing is saved until you press Save."
                      >
                        Nothing changed
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
