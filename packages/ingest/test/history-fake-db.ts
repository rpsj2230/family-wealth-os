import type { HistoryExisting } from '../src/history';
import type { HistoryIo, NewHistoricalAsset } from '../src/history-import';

/** A database in memory: what the importer wrote is what the next plan sees. */
export class FakeDb {
  assets: HistoryExisting['assets'];
  observations: HistoryExisting['observations'];
  created: NewHistoricalAsset[] = [];
  superseded: [string, string][] = [];
  /** the note stored with each value, by observation id */
  notes = new Map<string, string | null>();
  fills: [string, string][] = [];
  failOn: ((a: NewHistoricalAsset) => boolean) | null = null;
  private n = 0;
  constructor(base: HistoryExisting) {
    this.assets = [...base.assets];
    this.observations = [...base.observations];
  }
  snapshot(): HistoryExisting {
    return { assets: this.assets, observations: this.observations };
  }
  io(): HistoryIo {
    return {
      createAsset: async (a) => {
        if (this.failOn?.(a)) return { error: 'not in this household' };
        const id = `new-${++this.n}`;
        this.created.push(a);
        this.assets.push({
          id,
          type: a.type,
          status: a.status,
          nickname: a.nickname,
          label: a.label,
          last4: a.last4,
          accountKind: a.accountKind,
          joint: a.joint,
          holderName: a.holderName,
          currency: a.currency,
          ownerName: a.ownerName,
          bank: a.bank,
          fd: a.fd
            ? {
                principal: a.fd.principal,
                rate: a.fd.rate,
                bookedOn: a.fd.bookedOn,
                maturityOn: a.fd.maturityOn,
                ref: a.fd.ref,
                refLast4: null,
              }
            : null,
        });
        return { id };
      },
      insertObservation: async (o) => {
        const id = `o-${this.observations.length + 1}`;
        this.observations.push({
          id,
          assetId: o.assetId,
          asOf: o.asOf,
          amount: o.amount,
          currency: o.currency,
          source: 'workbook',
          sourceRef: o.sourceRef,
          confidence: 'imported_unverified',
          supersededBy: null,
        });
        this.notes.set(id, o.note);
        return id;
      },
      supersede: async (oldId, newId) => {
        this.superseded.push([oldId, newId]);
        const o = this.observations.find((x) => x.id === oldId)!;
        o.supersededBy = newId;
      },
      fillFdNumber: async (assetId, ref) => {
        const a = this.assets.find((x) => x.id === assetId);
        if (!a?.fd || a.fd.ref) return false;
        a.fd.ref = ref;
        this.fills.push([assetId, ref]);
        return true;
      },
    };
  }
}
