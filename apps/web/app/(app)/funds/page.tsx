import { redirect } from 'next/navigation';

/** Fund matching now lives on the Investments page ("Match funds"); this keeps old links and bookmarks working. */
export default function FundsRedirect(): never {
  redirect('/investments?tab=match');
}
