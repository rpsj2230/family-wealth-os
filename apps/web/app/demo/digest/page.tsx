import type { Metadata } from 'next';
import Link from 'next/link';
import { buildDigestEmail } from '@fwos/core';
import { DemoShell } from '@/components/DemoShell';
import { DigestFrames } from '@/components/DigestFrames';
import { PageHead } from '@/components/PageHead';
import { demoDigestInput } from '@/lib/demo-digest';

export const metadata: Metadata = {
  title: 'Sample daily e-mail',
  robots: { index: false, follow: false },
};

/** Public preview of the daily summary e-mail with an invented household: the same builder as the real one, no private data. */
export default function DemoDigest() {
  const email = buildDigestEmail(demoDigestInput());
  return (
    <DemoShell>
      <PageHead
        title="Preview today’s e-mail"
        subtitle="The daily summary as it arrives, on a phone and on a laptop. Invented names and amounts."
        actions={
          <Link className="btn" href="/demo/settings?tab=notifications">
            Back to Notifications
          </Link>
        }
      />
      <DigestFrames email={email} />
    </DemoShell>
  );
}
