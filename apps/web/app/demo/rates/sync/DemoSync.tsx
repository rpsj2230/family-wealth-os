'use client';

import { SyncBoard, type BankSyncResult, type SyncActions } from '@/app/(app)/rates/sync/SyncBoard';
import { DEMO_SYNC_SCRIPT } from '@/lib/demo-rates-sync';
import type { SyncRowView } from '@/lib/rates-sync-view';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The sample's buttons: each one waits a moment, says what a real sync would say, and saves nothing anywhere. */
const actions: SyncActions = {
  async syncBank(bank): Promise<BankSyncResult> {
    await wait(900);
    const s = DEMO_SYNC_SCRIPT[bank];
    if (!s) return { bank, status: 'cannot', message: 'Cannot read: this is a sample.', docs: [] };
    return {
      bank,
      status: s.status,
      message: s.message,
      docs: s.docs.map((d) => ({ ...d, via: d.via ?? null, effectiveOn: d.effectiveOn ?? null })),
    };
  },
  async pastePage() {
    await wait(700);
    return {
      ok: true,
      message: 'This is a sample: the pasted page was acted out and nothing was saved anywhere.',
    };
  },
  async addPage() {
    await wait(300);
    return { ok: true, message: 'This is a sample: nothing was saved anywhere.' };
  },
  async removeThirdParty() {
    await wait(400);
    return { ok: true, removed: 0, message: 'This is a sample: nothing was removed.' };
  },
};

export function DemoSync({ rows, thirdParty }: { rows: SyncRowView[]; thirdParty: number }) {
  return (
    <SyncBoard
      rows={rows}
      hasAiKey
      thirdParty={thirdParty}
      settingsHref="/demo/settings?tab=connections"
      actions={actions}
      demo
    />
  );
}
