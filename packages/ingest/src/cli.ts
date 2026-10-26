/* eslint-disable no-console */
// Dry run: node/tsx src/cli.ts <workbook.xlsx> [asOf=YYYY-MM-DD]   — prints the report, writes nothing.
import { formatReport, planWorkbook } from './workbook';

const file = process.argv[2];
if (!file) {
  console.error('usage: dry-run <workbook.xlsx> [asOf]');
  process.exit(2);
}
const asOf = process.argv[3] ?? new Date().toISOString().slice(0, 10);
const plan = await planWorkbook(file, { asOf });
console.log(formatReport(plan));
if (process.argv.includes('--json')) console.log(JSON.stringify(plan, null, 2));
process.exitCode = plan.reconciliation.every((r) => r.ok) ? 0 : 1;
