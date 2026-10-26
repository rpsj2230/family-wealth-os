import { redirect } from 'next/navigation';

/** The old address of the "other items" sheet; it now lives on the second tab of the Monthly update. */
export default function MonthlyAllRedirect() {
  redirect('/monthly?tab=other');
}
