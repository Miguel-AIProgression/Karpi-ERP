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
  // SFTP-bestandsnaam = de extern_referentie op de wachtrij-rij (retry-dedup).
  extern_referentie: string | null;
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
  vervoerderCode: 'rhenus_sftp',
  contentType: 'application/xml',
  zendingSelect:
    'zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, verzenddatum',
  orderSelect: 'order_nr, klant_referentie',

  // Rhenus: 0-colli loopt via de preflight (valideerRhenusColli, incident
  // 0455395) — géén aparte harde length-check vóór de preflight.
  hardFailOnZeroColli: false,
  zeroColliMelding: (zendingId) => `Geen zending_colli voor zending ${zendingId}.`,

  preflightColli: (colli) => valideerRhenusColli(colli).map((p) => p.melding),

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

  // XML-kopie naar storage (best-effort) → document_pad.
  bewaarArtefact: async (supabase, _z, xml, _r, bestandsnaam) => {
    try {
      const path = `rhenus-xml/${bestandsnaam}`;
      const { error: upErr } = await supabase.storage
        .from('order-documenten')
        .upload(path, new TextEncoder().encode(xml), { contentType: 'application/xml', upsert: true });
      if (upErr) {
        console.error(`[rhenus-send] storage-upload faalde: ${upErr.message}`);
        return null;
      }
      return path;
    } catch (e) {
      console.error(`[rhenus-send] storage-upload exception: ${String(e)}`);
      return null;
    }
  },

  // Rhenus heeft GEEN T&T-slot → trackTrace null (markeer laat zending.track_trace
  // ongemoeid, gedragsneutraal t.o.v. markeer_rhenus_verstuurd).
  uitkomst: (_z, _xml, _r, bestandsnaam) => ({ externReferentie: bestandsnaam, trackTrace: null }),

  noteerSucces: (row, _r, bestandsnaam, summary) => {
    summary.succeeded += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'sent', bestandsnaam: bestandsnaam ?? undefined });
  },
  noteerFout: (row, r, summary) => {
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: r.errorMsg ?? 'onbekende fout' });
  },
  noteerMarkFout: (row, melding, _fase, summary) => {
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: melding });
  },
};

/** Publieke entry — index.ts (claim-loop) + karakterisatie-test. */
export function verwerkRow(
  supabase: SupabaseClient,
  row: RhenusTransportOrderRow,
  ctx: VerwerkContext,
  summary: SendSummary,
): Promise<void> {
  return verwerkVerzendRij(rhenusAdapter, supabase, row, ctx, summary);
}
