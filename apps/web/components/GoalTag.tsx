'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { tagFundGoal } from '@/app/(app)/investments/actions';

/** Choose the goal a fund counts towards; saved the moment the choice is made. */
export function GoalTag({
  assetId,
  goals,
  current,
  fundName,
}: {
  assetId: string;
  goals: { id: string; name: string }[];
  /** goal ids the fund is allocated to today */
  current: string[];
  fundName: string;
}) {
  const [value, setValue] = useState(current[0] ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (current.length > 1)
    return (
      <span className="small">
        {current.length} goals ·{' '}
        <Link href="/goals" title="This fund is split between several goals on the Goals page">
          see split
        </Link>
      </span>
    );
  if (goals.length === 0)
    return (
      <Link className="small" href="/goals">
        Add a goal
      </Link>
    );
  return (
    <span className="goaltag">
      <select
        aria-label={`Goal for ${fundName}`}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          setMsg(null);
          start(async () => {
            const r = await tagFundGoal(assetId, v);
            setMsg(r.ok ? 'Saved' : r.message);
            if (!r.ok) setValue(current[0] ?? '');
          });
        }}
      >
        <option value="">No goal</option>
        {goals.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      {msg && (
        <span className={msg === 'Saved' ? 'ok small' : 'fail small'} role="status">
          {msg}
        </span>
      )}
    </span>
  );
}
