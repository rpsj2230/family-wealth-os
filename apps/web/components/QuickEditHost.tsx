import type { ReactNode } from 'react';
import type { PersonStyle } from '@fwos/core';
import { saveQuickEdit } from '@/app/(app)/accounts/actions';
import { addBankItem } from '@/app/(app)/monthly/actions';
import type { QuickRow } from '@/lib/quick-edit';
import { QuickEditProvider } from './QuickEdit';

export interface QuickEditModel {
  rows: QuickRow[];
  owners: { id: string; name: string }[];
  institutions: { id: string; name: string }[];
}

/**
 * Puts the one-account edit panel (and the "add an account" sheet) on a page, wired to the real save actions.
 * Public sample pages use QuickEditProvider directly without actions, so the panel works there but stores nothing.
 */
export function QuickEditHost({
  model,
  styles,
  today,
  fxHint = {},
  initialOpen,
  children,
}: {
  model: QuickEditModel;
  styles: Record<string, PersonStyle>;
  today: string;
  fxHint?: Record<string, number>;
  /** open this account's panel as soon as the page shows (from a link such as /accounts?edit=...) */
  initialOpen?: string | null;
  children: ReactNode;
}) {
  return (
    <QuickEditProvider
      {...model}
      styles={styles}
      today={today}
      fxHint={fxHint}
      save={saveQuickEdit}
      addItem={addBankItem}
      initialOpen={initialOpen ?? null}
    >
      {children}
    </QuickEditProvider>
  );
}
