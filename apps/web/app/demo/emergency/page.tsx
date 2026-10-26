import type { Metadata } from 'next';
import Link from 'next/link';
import { buildHandbook, EMPTY_PROFILE, type HandbookInput } from '@fwos/core';
import { HandbookView } from '@/app/(app)/emergency/HandbookView';

export const metadata: Metadata = {
  title: 'Sample family handbook',
  robots: { index: false, follow: false },
};

const input: HandbookInput = {
  asOf: '2026-10-26',
  householdName: 'Sample family',
  people: [
    {
      name: 'Asha',
      dob: '1982-03-14',
      isMinor: false,
      guardian: null,
      panLast4: '4321',
      residency: 'NRI',
    },
    {
      name: 'Vikram',
      dob: '1980-11-02',
      isMinor: false,
      guardian: null,
      panLast4: '8765',
      residency: 'NRI',
    },
    {
      name: 'Kiran',
      dob: '2013-06-20',
      isMinor: true,
      guardian: 'Asha',
      panLast4: null,
      residency: null,
    },
  ],
  profile: {
    ...EMPTY_PROFILE,
    message: 'We made this so you are never left wondering what to do. Call Ravi first.',
    contacts: [
      {
        name: 'Ravi Menon',
        relation: 'my brother',
        phone: '+65 9000 0000',
        note: 'knows where the papers are',
      },
      {
        name: 'Meera Iyer',
        relation: 'my sister',
        phone: '+91 98100 00000',
        note: 'lives in Delhi',
      },
    ],
    advisors: [
      {
        name: 'Rao & Co',
        relation: 'lawyer',
        phone: '+65 6000 0000',
        note: 'holds a copy of the will',
      },
    ],
    willLocation: 'Fireproof box in the study; a copy with Rao & Co.',
    passwordManager: 'Family password manager; Ravi has the emergency sheet.',
  },
  banks: [],
  ownerName: {},
  funds: [],
  heldByOthers: [],
  policies: [],
  property: [],
  owedToUs: [],
};

/** Public preview of the handbook with invented people. ?empty=1 shows a handbook nobody has filled in; ?owner=1 the owner's view. */
export default async function DemoEmergency({
  searchParams,
}: {
  searchParams: Promise<{ empty?: string; owner?: string }>;
}) {
  const sp = await searchParams;
  const doc = buildHandbook(sp.empty ? { ...input, profile: EMPTY_PROFILE } : input);
  return (
    <main className="content" style={{ maxWidth: 940, margin: '0 auto' }}>
      <p className="notice warn noprint" role="note">
        Sample handbook with invented people. <Link href="/login">Sign in</Link> to see your own.
      </p>
      <HandbookView
        doc={doc}
        generatedAt="2026-10-26T01:30:00Z"
        settingsHref={sp.owner ? '/settings?tab=access' : undefined}
        accessNote={sp.owner ? 'The read-only family login can always open this.' : undefined}
      />
    </main>
  );
}
