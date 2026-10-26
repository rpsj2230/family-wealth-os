/**
 * Runs the Google Sheet sync: finds the month's tab (or copies the last month's), keeps one hidden safety copy before replacing data,
 * and applies the planner's writes in a few batched calls. The planner (sheet-sync.ts) decides what to write; this file only talks to
 * Google, through the `SheetsApi` it is given, so it runs against a fake in tests.
 *
 * Calls (a real sync makes four to six): list the tabs, [copy the template, or copy the existing tab as the safety copy], read the tab,
 * [add rows and fix date formats], write the values.
 */
import { randomInt } from 'node:crypto';
import { SheetSyncError, type SheetsApi, type TabInfo } from './gsheet-client';
import { colNumber } from './sheet-grid';
import {
  findMonthTab,
  formatMonthTitle,
  insertIndexFor,
  monthIn,
  monthTabs,
  pickTemplate,
  tabOrder,
  type MonthTab,
  type YearMonth,
} from './sheet-months';
import {
  describePlan,
  layoutOf,
  planSheetSync,
  type NeedsPlacing,
  type RowPlan,
  type SyncAsset,
  type SyncOptions,
  type SyncPlan,
} from './sheet-sync';

/** The columns of the sheet that are read: the register and the summary blocks to its right end at AB. */
const LAST_COLUMN = 'AD';

export interface SyncConfig {
  timeZone: string;
  firstRow: number;
  lastRow: number;
  backupSuffix: string;
}

export interface SyncApp {
  assets: SyncAsset[];
  owners: string[];
  defaultOwner: string;
}

export interface SyncRunInput {
  api: SheetsApi;
  spreadsheetId: string;
  now: Date;
  app: SyncApp;
  config: SyncConfig;
  /** false = preview: nothing is changed in the spreadsheet */
  apply: boolean;
  /** a number for the safety copy's tab; only tests set it */
  newSheetId?: () => number;
}

/** What a person sees: what was (or would be) done to the spreadsheet. Plain data, safe to send to the browser. */
export interface SyncView {
  stage: 'preview' | 'applied';
  target: {
    title: string;
    /** the tab was already there; its data is replaced */
    existed: boolean;
    /** the tab the new one is (or was) copied from */
    copiedFrom: string | null;
    position: 'left' | 'right' | null;
  };
  /** the hidden safety copy of the tab, made before its data is replaced */
  backup: { title: string; replaces: boolean } | null;
  summary: string;
  counts: SyncPlan['counts'];
  rows: RowPlan[];
  placeByHand: NeedsPlacing[];
  /** the day the sync ran for, in the household's time zone */
  today: string;
}

/** What a person sees of a plan: the plan's rows and counts with where it goes. Also used for the sample on the public demo pages. */
export function syncView(
  plan: SyncPlan,
  stage: SyncView['stage'],
  where: Pick<SyncView, 'target' | 'backup' | 'today'>,
): SyncView {
  return {
    stage,
    ...where,
    summary: describePlan(plan),
    counts: plan.counts,
    rows: plan.rows,
    placeByHand: plan.placeByHand,
  };
}

export type SyncResult =
  { ok: true; view: SyncView } | { ok: false; code: string; message: string };

const fail = (e: unknown): { ok: false; code: string; message: string } =>
  e instanceof SheetSyncError
    ? { ok: false, code: e.code, message: e.message }
    : {
        ok: false,
        code: 'other',
        message: `The sync stopped unexpectedly (${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 160)}). Run the preview again before writing.`,
      };

/** Which tab is for which month, and which tab a new one would be copied from. */
export interface TabChoice {
  title: string;
  target: YearMonth & { iso: string };
  tabs: MonthTab[];
  all: TabInfo[];
  existing: MonthTab | null;
  template: MonthTab | null;
  order: ReturnType<typeof tabOrder>;
  /** the name a new tab gets, written like the existing ones */
  newTitle: string;
}

export async function chooseTabs(
  api: SheetsApi,
  spreadsheetId: string,
  now: Date,
  config: SyncConfig,
): Promise<TabChoice> {
  const { title, tabs: all } = await api.listTabs(spreadsheetId);
  const target = monthIn(config.timeZone, now);
  const months = monthTabs(all);
  const existing = findMonthTab(months, target);
  const template = existing ? null : pickTemplate(months, target);
  if (!existing && !template) {
    throw new SheetSyncError(
      'no_template',
      months.length === 0
        ? `No tab in this spreadsheet is named like a month (for example “${formatMonthTitle(target)}”), so there is nothing to copy. Name last month’s tab like that and try again.`
        : `This spreadsheet has no month tab before ${formatMonthTitle(target)} to copy from (the earliest is “${months[0]!.title}”). Add last month’s tab and try again.`,
    );
  }
  const style = (existing ?? template ?? months[0]!).style;
  return {
    title,
    target,
    tabs: months,
    all,
    existing,
    template,
    order: tabOrder(months),
    newTitle: existing?.title ?? formatMonthTitle(target, style),
  };
}

const optionsOf = (app: SyncApp, config: SyncConfig): SyncOptions => ({
  owners: app.owners,
  defaultOwner: app.defaultOwner,
  firstRow: config.firstRow,
  lastRow: config.lastRow,
});

const readRows = (tab: TabInfo, config: SyncConfig) => Math.min(tab.rows, config.lastRow * 2);

const NOT_THE_LAYOUT = (title: string) =>
  `The tab “${title}” does not look like the usual layout: none of its lines between the first and last row could be read as a deposit, balance, fund or loan. Open it, check that column E holds dates, Cash-NRE/Cash-NRO, Cash SG or SIP goals as before, and try again.`;

/** The preview (apply = false) and the real sync (apply = true). Returns a plain result; it never throws. */
export async function runSheetSync(input: SyncRunInput): Promise<SyncResult> {
  try {
    return { ok: true, view: await sync(input) };
  } catch (e) {
    return fail(e);
  }
}

async function sync(input: SyncRunInput): Promise<SyncView> {
  const { api, spreadsheetId, app, config } = input;
  const choice = await chooseTabs(api, spreadsheetId, input.now, config);
  const opts = optionsOf(app, config);
  const source = (choice.existing ?? choice.template)!;
  const sourceInfo = choice.all.find((t) => t.sheetId === source.sheetId)!;
  const backupTitle = `${choice.newTitle}${config.backupSuffix}`;
  const oldBackup = choice.all.find((t) => t.title === backupTitle) ?? null;
  const position = choice.existing ? null : choice.order === 'newest_left' ? 'left' : 'right';

  const view = (plan: SyncPlan, stage: SyncView['stage']): SyncView =>
    syncView(plan, stage, {
      target: {
        title: choice.newTitle,
        existed: !!choice.existing,
        copiedFrom: choice.template?.title ?? null,
        position,
      },
      backup: choice.existing ? { title: backupTitle, replaces: !!oldBackup } : null,
      today: choice.target.iso,
    });

  // The tab the plan is made against: the month's own tab, or (for a month with no tab yet) the template it will be copied from.
  const first = await api.readGrid(
    spreadsheetId,
    sourceInfo,
    readRows(sourceInfo, config),
    LAST_COLUMN,
  );
  if (layoutOf(first, opts).recognised === 0)
    throw new SheetSyncError('no_register', NOT_THE_LAYOUT(source.title));
  if (!input.apply) return view(planSheetSync(first, app.assets, opts), 'preview');

  if (oldBackup && !oldBackup.hidden)
    throw new SheetSyncError(
      'other',
      `A visible tab is already called “${backupTitle}”. The sync keeps its safety copy under that name and will not touch a tab you can see: rename or delete yours and try again.`,
    );

  // 1. the tab to fill: a copy of the template, or the existing tab after a hidden safety copy of it is made
  let tab: TabInfo;
  if (choice.existing) {
    const newId = (input.newSheetId ?? (() => randomInt(100_000_000, 2_000_000_000)))();
    await api.batchUpdate(spreadsheetId, [
      ...(oldBackup ? [{ deleteSheet: { sheetId: oldBackup.sheetId } }] : []),
      {
        duplicateSheet: {
          sourceSheetId: choice.existing.sheetId,
          insertSheetIndex: choice.all.length,
          newSheetId: newId,
          newSheetName: backupTitle,
        },
      },
      { updateSheetProperties: { properties: { sheetId: newId, hidden: true }, fields: 'hidden' } },
    ]);
    tab = sourceInfo;
  } else {
    const { replies } = await api.batchUpdate(spreadsheetId, [
      {
        duplicateSheet: {
          sourceSheetId: choice.template!.sheetId,
          insertSheetIndex: insertIndexFor(choice.order, choice.template!),
          newSheetName: choice.newTitle,
        },
      },
    ]);
    const p = (
      replies[0] as { duplicateSheet?: { properties?: Record<string, unknown> } } | undefined
    )?.duplicateSheet?.properties;
    const grid = p?.gridProperties as { rowCount?: number; columnCount?: number } | undefined;
    if (typeof p?.sheetId !== 'number')
      throw new SheetSyncError(
        'other',
        'Google did not confirm the new tab. Open the spreadsheet to see whether it was created, then run the preview again.',
      );
    tab = {
      sheetId: p.sheetId,
      title: choice.newTitle,
      index: typeof p.index === 'number' ? p.index : insertIndexFor(choice.order, choice.template!),
      hidden: false,
      rows: grid?.rowCount ?? sourceInfo.rows,
      columns: grid?.columnCount ?? sourceInfo.columns,
    };
  }

  // 2. plan against the tab as it is now, so the writes match what is really there (the safety copy leaves the tab as it was)
  const grid = choice.existing
    ? first
    : await api.readGrid(spreadsheetId, tab, readRows(tab, config), LAST_COLUMN);
  const plan = planSheetSync(grid, app.assets, opts);

  // 3. new rows (bottom first, so the rows above keep their numbers), their formulas, and date formats for cells that had none
  const structure: object[] = [];
  const cols = (c: string) => ({
    startColumnIndex: colNumber(c) - 1,
    endColumnIndex: colNumber(c),
  });
  for (const ins of [...plan.inserts].sort((a, b) => b.anchor - a.anchor)) {
    structure.push({
      insertDimension: {
        range: {
          sheetId: tab.sheetId,
          dimension: 'ROWS',
          startIndex: ins.anchor,
          endIndex: ins.anchor + ins.count,
        },
        inheritFromBefore: true,
      },
    });
    ins.formulas.forEach((f, i) => {
      for (const c of f.columns)
        structure.push({
          copyPaste: {
            source: {
              sheetId: tab.sheetId,
              startRowIndex: f.fromRow - 1,
              endRowIndex: f.fromRow,
              ...cols(c),
            },
            destination: {
              sheetId: tab.sheetId,
              startRowIndex: ins.anchor + i,
              endRowIndex: ins.anchor + i + 1,
              ...cols(c),
            },
            pasteType: 'PASTE_FORMULA',
            pasteOrientation: 'NORMAL',
          },
        });
    });
  }
  for (const f of plan.dateFormats) {
    const m = /^([A-Z]+)(\d+)$/.exec(f.ref)!;
    structure.push({
      repeatCell: {
        range: {
          sheetId: tab.sheetId,
          startRowIndex: Number(m[2]) - 1,
          endRowIndex: Number(m[2]),
          ...cols(m[1]!),
        },
        cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: f.pattern } } },
        fields: 'userEnteredFormat.numberFormat',
      },
    });
  }
  if (structure.length > 0) await api.batchUpdate(spreadsheetId, structure);

  // 4. the values
  await api.writeValues(
    spreadsheetId,
    plan.writes.map((w) => ({
      range: `'${tab.title.replace(/'/g, "''")}'!${w.ref}`,
      values: [[w.value]],
    })),
  );
  return view(plan, 'applied');
}

// ----------------------------------------------------------------------------------------------
// The connection test
// ----------------------------------------------------------------------------------------------
export interface TestStep {
  ok: boolean;
  text: string;
}

export interface SheetTestResult {
  ok: boolean;
  steps: TestStep[];
  /** the month tab the next sync fills, and the one it would copy */
  target: string | null;
  template: string | null;
  monthTabs: string[];
}

/**
 * Checks the whole chain without changing anything of substance: the key is accepted, the spreadsheet is found, its month tabs are
 * named as expected, there is a tab to copy from, the layout is recognised, and the account may edit.
 */
export async function testSheetConnection(args: {
  api: SheetsApi;
  spreadsheetId: string;
  now: Date;
  app: SyncApp;
  config: SyncConfig;
}): Promise<SheetTestResult> {
  const steps: TestStep[] = [];
  const out = (
    ok: boolean,
    target: string | null = null,
    template: string | null = null,
    months: string[] = [],
  ): SheetTestResult => ({
    ok,
    steps,
    target,
    template,
    monthTabs: months,
  });
  steps.push({
    ok: true,
    text: `The service-account key was read. It signs in as ${args.api.email}.`,
  });
  let choice: TabChoice;
  try {
    choice = await chooseTabs(args.api, args.spreadsheetId, args.now, args.config);
  } catch (e) {
    if (e instanceof SheetSyncError && e.code === 'no_template') {
      // the spreadsheet itself was reached; only the month tabs are wrong
      steps.push({ ok: true, text: 'Google accepted the key and the spreadsheet was found.' });
      steps.push({ ok: false, text: e.message });
      return out(false);
    }
    steps.push({ ok: false, text: fail(e).message });
    return out(false);
  }
  steps.push({
    ok: true,
    text: `Google accepted the key. The spreadsheet “${choice.title}” has ${choice.all.length} tab${choice.all.length === 1 ? '' : 's'}.`,
  });
  const names = choice.tabs.map((t) => t.title);
  steps.push({
    ok: true,
    text: `Month tabs found: ${names.length > 6 ? `${names.slice(-6).join(', ')} and ${names.length - 6} older` : names.join(', ')}.`,
  });
  steps.push({
    ok: true,
    text: choice.existing
      ? `This month already has a tab (“${choice.existing.title}”). A sync keeps a hidden safety copy of it, then replaces its data.`
      : `This month has no tab yet. A sync copies “${choice.template!.title}” (the latest earlier month) into a new tab named “${choice.newTitle}”, placed ${choice.order === 'newest_left' ? 'to its left' : 'to its right'}.`,
  });
  const source = (choice.existing ?? choice.template)!;
  const info = choice.all.find((t) => t.sheetId === source.sheetId)!;
  try {
    const grid = await args.api.readGrid(
      args.spreadsheetId,
      info,
      readRows(info, args.config),
      LAST_COLUMN,
    );
    const layout = layoutOf(grid, optionsOf(args.app, args.config));
    if (layout.recognised === 0) {
      steps.push({ ok: false, text: NOT_THE_LAYOUT(source.title) });
      return out(false, choice.newTitle, choice.template?.title ?? null, names);
    }
    const k = layout.byKind;
    steps.push({
      ok: true,
      text: `The layout of “${source.title}” is recognised: ${layout.recognised} lines (${k.fd ?? 0} deposits, ${(k.cash ?? 0) + (k.cash_sg ?? 0)} balances, ${(k.fund ?? 0) + (k.ulip ?? 0)} funds, ${k.loan ?? 0} loans, ${k.third_party ?? 0} held by others)${layout.unclassified ? `; ${layout.unclassified} line${layout.unclassified === 1 ? '' : 's'} with an amount match no rule and will be left alone` : ''}.`,
    });
    await args.api.confirmEditAccess(args.spreadsheetId, choice.title);
    steps.push({
      ok: true,
      text: 'The service account may edit the spreadsheet. (This step sets the file name to what it already is; nothing else is changed.)',
    });
  } catch (e) {
    steps.push({ ok: false, text: fail(e).message });
    return out(false, choice.newTitle, choice.template?.title ?? null, names);
  }
  return out(true, choice.newTitle, choice.template?.title ?? null, names);
}
