import { redirect } from 'next/navigation';

/** The monthly fund update now lives on the Investments page ("Update funds"); this keeps old links and bookmarks working. */
export default function UpdateFundsRedirect(): never {
  redirect('/investments?tab=update');
}
