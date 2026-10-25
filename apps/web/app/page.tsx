import { classifyFreshness } from '@fwos/core';

export default function Home() {
  // Smoke test that the shared finance core is wired in; replaced by the real dashboard in P2.
  const sample = classifyFreshness({ asOf: null, today: new Date(), expectedDays: 35 });
  return (
    <main>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo" src="/brand/rp-logo.png" alt="RP" />
      <h1>Family Wealth OS</h1>
      <p className="card">
        Foundation build in progress (phase P0). Core engine status check: <code>{sample.status}</code>.
      </p>
    </main>
  );
}
