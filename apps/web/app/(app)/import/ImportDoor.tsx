'use client';

import { useId, useState } from 'react';
import { TaxFileForm } from '@/app/(app)/tax/filing/TaxFileForm';
import { KIND_CHOICES, detectMany, guessOwner, type ImportKind } from '@/lib/import-detect';
import { CasForm, FundCsvForm, ImportForm, SyncLayoutForm } from './ImportForm';
import { HistoryForm } from './HistoryForm';
import { BankStatementForm } from './BankStatementForm';
import '@/components/quickedit.css';

interface Chosen {
  file: File;
  head: string;
}

/** Reads the first few kilobytes as plain characters (any encoding: only ASCII markers matter). */
async function peek(file: File): Promise<string> {
  const buf = await file.slice(0, 4096).arrayBuffer();
  return new TextDecoder('latin1').decode(buf);
}

/**
 * The single front door of Import: choose a file, and the page works out what it is and shows the matching form with the
 * file already attached. Nothing is uploaded until the person presses the button on that form, and each form shows a
 * preview or asks for the missing detail first. The person can always say what the file is if the guess is wrong.
 */
export function ImportDoor({
  owners,
  accounts = [],
  today,
  taxFy,
  hasWorkbook,
  demo = false,
}: {
  owners: { id: string; name: string }[];
  /** the bank accounts a statement can be for, labelled so they can be told apart */
  accounts?: { id: string; label: string; last4: string | null }[];
  today: string;
  taxFy: string;
  /** a workbook has been imported before: only its order, names and links usually need updating */
  hasWorkbook: boolean;
  demo?: boolean;
}) {
  const inputId = useId();
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [override, setOverride] = useState<ImportKind | ''>('');
  const [workbookMode, setWorkbookMode] = useState<'layout' | 'import' | 'history'>(
    hasWorkbook ? 'layout' : 'import',
  );
  const [reading, setReading] = useState(false);

  const found = detectMany(
    chosen.map((c) => ({ name: c.file.name, size: c.file.size, head: c.head })),
  );
  const kind: ImportKind | null = override || found.kind;
  const first = chosen[0]?.file;
  const pick = found.pick >= 0 ? (chosen[found.pick]?.file ?? first) : first;
  const guessed = pick ? guessOwner(pick.name, owners) : '';
  const needsConfirm = chosen.length > 0 && !override && (!found.kind || !found.confident);

  async function onChoose(list: FileList | null) {
    const files = Array.from(list ?? []).slice(0, 12);
    setOverride('');
    if (files.length === 0) {
      setChosen([]);
      return;
    }
    setReading(true);
    setChosen(await Promise.all(files.map(async (file) => ({ file, head: await peek(file) }))));
    setReading(false);
  }

  return (
    <div className="door">
      <section className="card doorcard" aria-labelledby={`${inputId}-h`}>
        <h2 id={`${inputId}-h`}>Choose a file</h2>
        <p className="muted small">
          Your Excel workbook, a fund statement (PDF), a fund app export (CSV) or a tax statement
          (Form 26AS or AIS). The app works out which one it is and shows what will happen before
          anything is saved.
        </p>
        <label className="dropzone" htmlFor={inputId}>
          <span className="dropzone-title">
            {chosen.length === 0
              ? 'Choose a file from your computer or phone'
              : 'Choose a different file'}
          </span>
          <span className="muted small">
            .xlsx, .pdf, .csv, .json, .txt or .html, up to 5 MB each
          </span>
          <input
            id={inputId}
            type="file"
            multiple
            accept=".xlsx,.xlsm,.xls,.pdf,.csv,.json,.txt,.htm,.html"
            onChange={(e) => void onChoose(e.target.files)}
          />
        </label>
        {demo && (
          <p className="muted small">
            In this sample the file is only looked at in your browser; nothing is uploaded.
          </p>
        )}

        {reading && (
          <p className="muted" role="status">
            Looking at the file…
          </p>
        )}

        {chosen.length > 0 && !reading && (
          <div className="detected" role="status" aria-live="polite">
            <p className="detected-line">
              <strong>
                {chosen.length === 1 ? chosen[0]!.file.name : `${chosen.length} files chosen`}
              </strong>
            </p>
            <p className={needsConfirm ? 'warnline' : 'okline'}>
              {override ? 'You chose how to read it.' : found.message}
            </p>
            <label className="small kindpick">
              {needsConfirm ? 'What is this file?' : 'Not right? Say what it is'}
              <select
                value={override || (found.confident && found.kind ? found.kind : '')}
                onChange={(e) => setOverride(e.target.value as ImportKind | '')}
              >
                <option value="">{needsConfirm ? 'Choose…' : 'Keep the suggestion'}</option>
                {KIND_CHOICES.map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </section>

      {kind && pick && !reading && (
        <section className="card doorcard" aria-label="What happens next">
          {kind === 'workbook' && (
            <>
              <h2>Your Excel workbook</h2>
              <div className="qe-seg" role="group" aria-label="What should the workbook do">
                <button
                  type="button"
                  className={workbookMode === 'layout' ? 'on' : ''}
                  aria-pressed={workbookMode === 'layout'}
                  onClick={() => setWorkbookMode('layout')}
                >
                  Update order, names and links
                </button>
                <button
                  type="button"
                  className={workbookMode === 'import' ? 'on' : ''}
                  aria-pressed={workbookMode === 'import'}
                  onClick={() => setWorkbookMode('import')}
                >
                  Import balances and deposits
                </button>
                <button
                  type="button"
                  className={workbookMode === 'history' ? 'on' : ''}
                  aria-pressed={workbookMode === 'history'}
                  onClick={() => setWorkbookMode('history')}
                >
                  History from all monthly tabs
                </button>
              </div>
              <fieldset disabled={demo && workbookMode !== 'history'} className="plain">
                {workbookMode === 'history' ? (
                  <HistoryForm key={pick.name + pick.size} file={pick} demo={demo} />
                ) : workbookMode === 'layout' ? (
                  <>
                    <p className="muted small">
                      Makes the screens follow your sheet&rsquo;s order, names (NRE, NRO, joint),
                      the link between each deposit and its savings account, deposit numbers (last
                      four digits) and notes. It never changes a balance or a deposit amount, so it
                      is safe to repeat whenever you reorder the sheet.
                    </p>
                    <SyncLayoutForm key={pick.name + pick.size} today={today} file={pick} />
                  </>
                ) : (
                  <>
                    <p className="muted small">
                      For the first time, or a new household: shows a preview with checks against
                      your own sheet. Nothing is saved until you press Import.
                    </p>
                    <ImportForm key={pick.name + pick.size} today={today} file={pick} />
                  </>
                )}
              </fieldset>
            </>
          )}
          {kind === 'cas' && (
            <>
              <h2>Fund statement</h2>
              <p className="muted small">
                Stores every fund, every transaction, the amount invested and any running SIP. The
                password is the one you chose when you requested it, usually your PAN in capitals;
                it is used once and never saved.
              </p>
              <fieldset disabled={demo} className="plain">
                <CasForm
                  key={pick.name + pick.size}
                  owners={owners}
                  file={pick}
                  defaultOwner={guessed}
                />
              </fieldset>
            </>
          )}
          {kind === 'csv' && (
            <>
              <h2>Fund app export</h2>
              <p className="muted small">
                Shows, for each fund, whether it updates a fund you have or adds a new one. Press
                Preview first; nothing is saved until you press Import.
              </p>
              <fieldset disabled={demo} className="plain">
                <FundCsvForm
                  key={chosen.map((c) => c.file.name + c.file.size).join('|')}
                  owners={owners}
                  initialFiles={chosen.map((c) => c.file).filter((f) => /\.csv$/i.test(f.name))}
                />
              </fieldset>
            </>
          )}
          {kind === 'bank' && (
            <>
              <h2>Bank statement</h2>
              <p className="muted small">
                Reads every line: interest, rent, money from abroad, transfers between your
                accounts, deposits, fund purchases and spending. Your own money and lifetime profit
                are then worked out from what really happened. Press Preview first; nothing is saved
                until you press Save.
              </p>
              <fieldset disabled={demo} className="plain">
                <BankStatementForm key={pick.name + pick.size} accounts={accounts} file={pick} />
              </fieldset>
            </>
          )}
          {kind === 'tax' && (
            <>
              <h2>Tax statement</h2>
              <p className="muted small">
                Reads Form 26AS or the AIS and compares it with what the app expected. A protected
                PDF is opened with the date of birth saved in Settings. Nothing is changed by
                itself.
              </p>
              <fieldset disabled={demo} className="plain">
                <TaxFileForm
                  key={pick.name + pick.size}
                  owners={owners}
                  fy={taxFy}
                  file={pick}
                  defaultOwner={guessed}
                />
              </fieldset>
            </>
          )}
        </section>
      )}

      {accounts.length > 0 && (
        <details className="card doorcard" data-testid="paste-rows">
          <summary>
            <strong>Paste rows from net banking</strong>{' '}
            <span className="muted small">
              (for the odd month the bank’s e-mails missed: no file needed)
            </span>
          </summary>
          <p className="muted small">
            On the bank’s page, select the rows of the transactions table, copy and paste them here.
            Rows already on file are not added again, and the preview says whether the rows join up
            with the account’s balance on file or what is still missing in between.
          </p>
          <fieldset disabled={demo} className="plain">
            <BankStatementForm accounts={accounts} file={null} />
          </fieldset>
        </details>
      )}
    </div>
  );
}
