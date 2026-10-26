import {
  build26asRequest,
  buildAisRequest,
  casPdfText,
  isPasswordError,
  parse26as,
  parse26asAi,
  parseAisAi,
  parseAisJson,
  parseAisText,
  sniffTaxFile,
  type Ais,
  type AiProvider,
  type Form26as,
} from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface TaxFileResult {
  ok: boolean;
  message: string;
  kind: '26as' | 'ais' | null;
  fy: string | null;
  warnings: string[];
}

const textOf = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);
const htmlToPlain = (h: string) =>
  h
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<\/(tr|p|div|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/**
 * Reads an uploaded Form 26AS or AIS (PDF, text, saved web page or JSON), checks that it belongs to the chosen person and stores
 * the figures. `passwords` are tried in turn for a protected PDF (26AS: date of birth as DDMMYYYY; AIS: PAN in lower case then the
 * date of birth). If the plain reader finds nothing and an AI key is given, the AI is asked for the same table.
 */
export async function importTaxFile(
  db: SupabaseClient,
  hh: string,
  owner: { id: string; panLast4: string | null },
  bytes: Uint8Array,
  opts: {
    passwords: string[];
    ai: { provider: AiProvider; key: string } | null;
    fyHint?: string | null;
    fetchJson?: (
      url: string,
      init: { method: 'POST'; headers: Record<string, string>; body: string },
    ) => Promise<unknown>;
  },
): Promise<TaxFileResult> {
  const fail = (message: string): TaxFileResult => ({
    ok: false,
    message,
    kind: null,
    fy: null,
    warnings: [],
  });
  let text: string | null = null;
  let json: unknown = null;
  const head = textOf(bytes.slice(0, 8)).trimStart();
  if (head.startsWith('%PDF')) {
    let last: unknown = null;
    for (const pw of [undefined, ...opts.passwords]) {
      try {
        text = await casPdfText(bytes, pw);
        break;
      } catch (e) {
        last = e;
        if (!isPasswordError(e)) break;
      }
    }
    if (text === null)
      return fail(
        isPasswordError(last)
          ? 'The PDF is password-protected and the password was not right. For Form 26AS it is the date of birth as DDMMYYYY; for the AIS it is your PAN in small letters followed by the date of birth.'
          : `The PDF could not be read (${(last as Error | null)?.message ?? 'unknown error'}).`,
      );
  } else if (head.startsWith('{') || head.startsWith('[')) {
    try {
      json = JSON.parse(textOf(bytes));
    } catch {
      return fail('The file looks like JSON but could not be read.');
    }
  } else if (head.startsWith('PK')) {
    return fail(
      'This is a zip file. Open it first (the password is the date of birth as DDMMYYYY) and upload the text file inside, or download the PDF instead.',
    );
  } else {
    const raw = textOf(bytes);
    text = /<html|<table|<body/i.test(raw.slice(0, 2000)) ? htmlToPlain(raw) : raw;
  }

  let parsed: Form26as | Ais;
  if (json !== null) {
    parsed = parseAisJson(json);
  } else {
    const sniff = sniffTaxFile(text ?? '');
    parsed = sniff === 'ais' ? parseAisText(text!) : parse26as(text!);
  }
  const empty =
    parsed.kind === '26as'
      ? parsed.deductors.length === 0 && parsed.taxPaid.length === 0
      : parsed.lines.length === 0;
  if (empty && opts.ai && opts.fetchJson && (text !== null || json !== null)) {
    const body = text ?? JSON.stringify(json);
    const req =
      parsed.kind === '26as'
        ? build26asRequest(opts.ai.provider, opts.ai.key, body)
        : buildAisRequest(opts.ai.provider, opts.ai.key, body);
    try {
      const answer = await opts.fetchJson(req.url, req.init);
      const viaAi =
        parsed.kind === '26as'
          ? parse26asAi(opts.ai.provider, answer)
          : parseAisAi(opts.ai.provider, answer);
      const found =
        viaAi.kind === '26as' ? viaAi.deductors.length + viaAi.taxPaid.length : viaAi.lines.length;
      if (found > 0) {
        viaAi.fy ??= parsed.fy;
        viaAi.panLast4 = parsed.panLast4;
        parsed = viaAi;
      }
    } catch {
      /* keep the plain result and its warnings */
    }
  }
  const stillEmpty =
    parsed.kind === '26as'
      ? parsed.deductors.length === 0 && parsed.taxPaid.length === 0
      : parsed.lines.length === 0;
  if (stillEmpty)
    return {
      ok: false,
      message:
        'Nothing could be read from this file. Check that it is the Form 26AS or AIS for the right year.',
      kind: parsed.kind,
      fy: parsed.fy,
      warnings: parsed.warnings,
    };
  if (parsed.panLast4 && owner.panLast4 && parsed.panLast4 !== owner.panLast4)
    return fail('The PAN in this file does not match the person chosen.');
  const fy = parsed.fy ?? opts.fyHint ?? null;
  if (!fy)
    return fail(
      'The financial year could not be found in the file. Choose the year and upload again.',
    );
  const stored = { ...parsed, fy };
  const { error } = await db.from('tax_statements').upsert(
    {
      household_id: hh,
      owner_id: owner.id,
      fy,
      kind: parsed.kind,
      parsed: stored,
      read_by: parsed.source,
      uploaded_on: new Date().toISOString().slice(0, 10),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'household_id,owner_id,fy,kind' },
  );
  if (error) return fail('That could not be saved.');
  return {
    ok: true,
    kind: parsed.kind,
    fy,
    warnings: parsed.warnings,
    message:
      parsed.kind === '26as'
        ? `Form 26AS for ${fy} read: ${parsed.deductors.length} deductors, tax credited ₹${Math.round(parsed.totalTds).toLocaleString('en-IN')}.`
        : `AIS for ${fy} read: ${parsed.lines.length} information lines.`,
  };
}

export interface StoredStatement {
  ownerId: string;
  fy: string;
  kind: '26as' | 'ais';
  readBy: 'rules' | 'ai';
  uploadedOn: string;
  parsed: Form26as | Ais;
}

export async function loadTaxStatements(
  db: SupabaseClient,
  fy: string,
  householdId?: string,
): Promise<StoredStatement[]> {
  const q = db
    .from('tax_statements')
    .select('owner_id, fy, kind, read_by, uploaded_on, parsed')
    .eq('fy', fy);
  const r = await (householdId ? q.eq('household_id', householdId) : q);
  return (
    (r.data ?? []) as unknown as {
      owner_id: string;
      fy: string;
      kind: '26as' | 'ais';
      read_by: 'rules' | 'ai';
      uploaded_on: string;
      parsed: Form26as | Ais;
    }[]
  ).map((x) => ({
    ownerId: x.owner_id,
    fy: x.fy,
    kind: x.kind,
    readBy: x.read_by,
    uploadedOn: x.uploaded_on,
    parsed: x.parsed,
  }));
}
