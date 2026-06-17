// Rhenus-adapter op de verzend-orchestrator-skeleton (ADR-0035 slice 2). Spiegelt
// de Verhoek-adapter; de gedeelde sequence leeft in `_shared/verzend-orchestrator.ts`.
// Rhenus-eigenheden: order leest `klant_referentie`, 0-colli loopt via de preflight
// (incident 0455395, GEEN harde length-check), geen track_trace bij verstuurd,
// en de XML-builder krijgt een `nu`-tijdstip.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { externReferentie } from '../_shared/referentie.ts';

import { bouwRhenusBestandsnaam, bouwRhenusXml, valideerRhenusColli } from './xml-builder.ts';
import { type SftpConfig, uploadXmlViaSftp } from '../_shared/sftp-client.ts';
import {
  type VerzendAdapter,
  type VerzendSummaryBasis,
  verwerkVerzendRij,
} from '../_shared/verzend-orchestrator.ts';
import type { BedrijfInput, RhenusOpties, ZendingInput } from './types.ts';

export interface RhenusTransportOrderRow {
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
  opties: RhenusOpties;
  dryRun: boolean;
}

interface SftpResultaat {
  ok: boolean;
  remotePad: string | null;
  errorMsg: string | null;
}

export const rhenusAdapter: VerzendAdapter<RhenusTransportOrderRow, VerwerkContext, string, SftpResultaat> = {
  kanaal: 'rhenus',
  capabilityCode: 'rhenus_sftp',
  contentType: 'application/xml',
  zendingSelect:
    'zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, verzenddatum',
  orderSelect: 'order_nr, klant_referentie',

  // Rhenus: 0-colli loopt via de preflight (valideerRhenusColli, incident
  // 0455395) — géén aparte harde length-check vóór de preflight.
  hardFailOnZeroColli: false,
  zeroColliMelding: (zendingId) => `Geen zending_colli voor zending ${zendingId}.`,

  preflightColli: (colli) => valideerRhenusColli(colli).map((p) => p.melding),

  bestandsnaamTabel: 'rhenus_transportorders',
  maakBestandsnaam: (z, ctx) => bouwRhenusBestandsnaam(ctx.opties.bestandsnaam_prefix, z.zending_nr, new Date()),

  bouwPayload: ({ z, order, bedrijf, colli, ctx }) =>
    bouwRhenusXml({
      zending: z as unknown as ZendingInput,
      order: { order_nr: order.order_nr as string, klant_referentie: externReferentie(order.klant_referentie as string | null) },
      bedrijf: bedrijf as BedrijfInput,
      opties: ctx.opties,
      colli,
      nu: new Date(),
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

  onSucces: async (supabase, row, _ctx, _z, xml, _r, bestandsnaam, summary) => {
    let storagePath: string | null = null;
    try {
      const path = `rhenus-xml/${bestandsnaam}`;
      const { error: upErr } = await supabase.storage
        .from('order-documenten')
        .upload(path, new TextEncoder().encode(xml), { contentType: 'application/xml', upsert: true });
      if (!upErr) storagePath = path;
      else console.error(`[rhenus-send] storage-upload faalde: ${upErr.message}`);
    } catch (e) {
      console.error(`[rhenus-send] storage-upload exception: ${String(e)}`);
    }

    summary.succeeded += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'sent', bestandsnaam: bestandsnaam ?? undefined });
    const { error: markOkErr } = await supabase.rpc('markeer_rhenus_verstuurd', {
      p_id: row.id,
      p_bestandsnaam: bestandsnaam,
      p_xml_storage_path: storagePath,
      p_request_xml: xml,
    });
    if (markOkErr) console.error(`[rhenus-send] markeer_rhenus_verstuurd faalde voor rij ${row.id}: ${markOkErr.message}`);
  },

  onFout: async (supabase, row, xml, r, summary) => {
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: r.errorMsg ?? 'onbekende fout' });
    const { error: markFoutErr } = await supabase.rpc('markeer_rhenus_fout', {
      p_id: row.id,
      p_error: r.errorMsg ?? 'onbekende fout',
      p_request_xml: xml,
      p_max_retries: 3,
    });
    if (markFoutErr) console.error(`[rhenus-send] markeer_rhenus_fout faalde voor rij ${row.id}: ${markFoutErr.message}`);
  },

  markFout: (supabase, row, summary, melding) => markFoutMetSummary(supabase, row, summary, melding),
};

export async function markFoutMetSummary(
  supabase: SupabaseClient,
  row: RhenusTransportOrderRow,
  summary: VerzendSummaryBasis,
  error: string,
): Promise<void> {
  summary.failed += 1;
  summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error });
  const { error: markErr } = await supabase.rpc('markeer_rhenus_fout', { p_id: row.id, p_error: error, p_max_retries: 3 });
  if (markErr) console.error(`[rhenus-send] markeer_rhenus_fout faalde voor rij ${row.id}: ${markErr.message}`);
}

/** Publieke entry — index.ts (claim-loop) + karakterisatie-test. */
export function verwerkRow(
  supabase: SupabaseClient,
  row: RhenusTransportOrderRow,
  ctx: VerwerkContext,
  summary: SendSummary,
): Promise<void> {
  return verwerkVerzendRij(rhenusAdapter, supabase, row, ctx, summary);
}
