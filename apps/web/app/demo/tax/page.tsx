import type { Metadata } from 'next';
import Link from 'next/link';
import { TaxSimulator } from '@/components/TaxSimulator';

export const metadata: Metadata = {
  title: 'Sample: tax simulator',
  robots: { index: false, follow: false },
};

export default function DemoTax() {
  return (
    <main className="content">
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <h1>Tax simulator (sample)</h1>
      <TaxSimulator sample />
    </main>
  );
}
