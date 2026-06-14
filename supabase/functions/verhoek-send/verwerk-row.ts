// Verhoek-adapter op de verzend-orchestrator-skeleton (ADR-0035 slice 1). De
// gedeelde sequence (fetch → colli → 0-colli → preflight → bestandsnaam → build →
// transport → audit → markeer) leeft in `_shared/verzend-orchestrator.ts`; dit
// bestand levert alleen wat Verhoek-specifiek is. `verwerkRow` blijft de publieke
// entry (index.ts + karakterisatie-test) en delegeert naar de skeleton.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { bouwVerhoekBestandsnaam, bouwVerhoekXml, valideerVerhoekColli } from './xml-builder.ts';
import { type SftpConfig, uploadXmlViaSftp } from '../_shared/sftp-client.ts';
import {
  type VerzendAdapter,
  type VerzendSummaryBasis,
  type VerzendZending,
  verwerkVerzendRij,
} from '../_shared/verzend-orchestrator.ts';
import type { BedrijfInput, VerhoekOpties, ZendingInput } from './types.ts';

export interface VerhoekTransportOrderRow {
  id: number;
  zending_id: number;
  debiteur_nr: number | null;
  status: string;
  is_test: boolean;
  bestandsnaam: string | null;
}

export interface SendSummary extends VerzendSummaryBasis {
  processed: number;
  empty_queue: boolean;
  dry_run: boolean;
  details: Array<{ id: number; zending_id: number; status: 'sent' | 'error'; bestandsnaam?: string; error?: string }>;
}

export interface VerwerkContext {
  sftpConfig: SftpConfig | null; // null in dry-run
  opties: VerhoekOpties;
  dryRun: boolean;
}

// Transport-resultaat: zowel de SFTP-upload als de dry-run leveren deze shape.
interface SftpResultaat {
  ok: boolean;
  remotePad: string | null;
  errorMsg: string | null;
}

export const verhoekAdapter: VerzendAdapter<VerhoekTransportOrderRow, VerwerkContext, string, SftpResultaat> = {
  kanaal: 'verhoek',
  capabilityCode: 'verhoek_sftp',
  contentType: 'application/xml',
  zendingSelect:
    'zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, afl_email, opmerkingen, verzenddatum',
  orderSelect: 'order_nr',

  hardFailOnZeroColli: true,
  zeroColliMelding: (zendingId) =>
    `Geen zending_colli voor zending ${zendingId}. Pickronde moet genereer_zending_colli aanroepen — zonder ScanCode kan Verhoek ons label niet matchen.`,

  preflightColli: (colli) => valideerVerhoekColli(colli).map((p) => p.melding),
  preflightExtra: (ctx) =>
    // Echte verzending vereist een bevestigd opdrachtgevernummer (vraag 1
    // testmail). In dry-run mag het leeg blijven (lege tag, zoals testbestand).
    !ctx.dryRun && ctx.opties.opdrachtgever_nummer.trim() === ''
      ? ["opdrachtgever_nummer ontbreekt in app_config 'verhoek' — antwoord Verhoek (vraag 1) nog niet verwerkt."]
      : [],

  bestandsnaamTabel: 'verhoek_transportorders',
  maakBestandsnaam: (z) => bouwVerhoekBestandsnaam(z.zending_nr, new Date()),

  bouwPayload: ({ z, order, bedrijf, colli, ctx }) =>
    bouwVerhoekXml({
      zending: z as unknown as ZendingInput,
      order: { order_nr: order.order_nr as string },
      bedrijf: bedrijf as BedrijfInput,
      opties: ctx.opties,
      colli,
    }),
  payloadRaw: (xml) => xml,

  transport: (ctx, xml, bestandsnaam) =>
    ctx.dryRun
      ? Promise.resolve({ ok: true, remotePad: 'DRY_RUN — niet geüpload', errorMsg: null })
      : uploadXmlViaSftp(ctx.sftpConfig!, bestandsnaam!, xml),
  resultOk: (r) => r.ok,
  resultFout: (r) => r.errorMsg,

  auditExterneId: (bestandsnaam) => bestandsnaam,
  auditPayloadJson: (_xml, r, bestandsnaam, ctx) => ({
    bestandsnaam,
    remote_pad: r.remotePad,
    ok: r.ok,
    dry_run: ctx.dryRun,
    error: r.errorMsg,
  }),

  onSucces: async (supabase, row, _ctx, z, xml, _r, bestandsnaam, summary) => {
    // XML-kopie naar storage (best-effort).
    let storagePath: string | null = null;
    try {
      const path = `verhoek-xml/${bestandsnaam}`;
      const { error: upErr } = await supabase.storage
        .from('order-documenten')
        .upload(path, new TextEncoder().encode(xml), { contentType: 'application/xml', upsert: true });
      if (!upErr) storagePath = path;
      else console.error(`[verhoek-send] storage-upload faalde: ${upErr.message}`);
    } catch (e) {
      console.error(`[verhoek-send] storage-upload exception: ${String(e)}`);
    }

    summary.succeeded += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'sent', bestandsnaam: bestandsnaam ?? undefined });
    const { error: markOkErr } = await supabase.rpc('markeer_verhoek_verstuurd', {
      p_id: row.id,
      p_bestandsnaam: bestandsnaam,
      p_xml_storage_path: storagePath,
      p_track_trace_id: ((z.afl_email as string | null) ?? '').trim() !== '' ? z.zending_nr : null,
      p_request_xml: xml,
    });
    if (markOkErr) console.error(`[verhoek-send] markeer_verhoek_verstuurd faalde voor rij ${row.id}: ${markOkErr.message}`);
  },

  onFout: async (supabase, row, xml, r, summary) => {
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: r.errorMsg ?? 'onbekende fout' });
    const { error: markFoutErr } = await supabase.rpc('markeer_verhoek_fout', {
      p_id: row.id,
      p_error: r.errorMsg ?? 'onbekende fout',
      p_request_xml: xml,
      p_max_retries: 3,
    });
    if (markFoutErr) console.error(`[verhoek-send] markeer_verhoek_fout faalde voor rij ${row.id}: ${markFoutErr.message}`);
  },

  markFout: (supabase, row, summary, melding) => markFoutMetSummary(supabase, row, summary, melding),
};

export async function markFoutMetSummary(
  supabase: SupabaseClient,
  row: VerhoekTransportOrderRow,
  summary: VerzendSummaryBasis,
  error: string,
): Promise<void> {
  summary.failed += 1;
  summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error });
  const { error: markErr } = await supabase.rpc('markeer_verhoek_fout', { p_id: row.id, p_error: error, p_max_retries: 3 });
  if (markErr) console.error(`[verhoek-send] markeer_verhoek_fout faalde voor rij ${row.id}: ${markErr.message}`);
}

/** Publieke entry — index.ts (claim-loop) + karakterisatie-test. Delegeert naar
 *  de gedeelde skeleton met de Verhoek-adapter. */
export function verwerkRow(
  supabase: SupabaseClient,
  row: VerhoekTransportOrderRow,
  ctx: VerwerkContext,
  summary: SendSummary,
): Promise<void> {
  return verwerkVerzendRij(verhoekAdapter, supabase, row, ctx, summary);
}

// `VerzendZending` voor type-naslag bij de adapter-callbacks.
export type { VerzendZending };
