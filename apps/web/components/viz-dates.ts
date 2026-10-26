const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jun ’22" (the same on every machine, unlike the browser's own short month names). */
export const monthYear = (iso: string) => `${MON[Number(iso.slice(5, 7)) - 1]} ’${iso.slice(2, 4)}`;
/** "26 Oct" */
export const dayMonth = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
/** "26 Oct 2026" */
export const dayMonthYear = (iso: string) => `${dayMonth(iso)} ${iso.slice(0, 4)}`;
/** "Oct" or, when `withYear`, "Oct ’26" */
export const monthShort = (ym: string, withYear: boolean) =>
  withYear ? monthYear(`${ym}-01`) : MON[Number(ym.slice(5, 7)) - 1]!;
