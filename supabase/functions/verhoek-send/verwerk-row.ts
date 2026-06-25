// Verhoek-adapter op de verzend-orchestrator-skeleton (ADR-0035 slice 1). De
// gedeelde sequence (fetch → colli → 0-colli → preflight → bestandsnaam → build →
// transport → audit → markeer) leeft in `_shared/verzend-orchestrator.ts`; dit
// bestand levert alleen wat Verhoek-specifiek is. `verwerkRow` blijft de publieke
// entry (index.ts + karakterisatie-test) en delegeert naar de skeleton.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { bouwVerhoekBestandsnaam, bouwVerhoekXml, valideerVerhoekColli } from './xml-builder.ts';
import { type RelayConfig, uploadXmlViaRelay } from './relay-client.ts';
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
  relayConfig: RelayConfig | null; // null in dry-run
  opties: VerhoekOpties;
  dryRun: boolean;
}

// Transport-resultaat: zowel de relay-upload als de dry-run leveren deze shape.
interface SftpResultaat {
  ok: boolean;
  remotePad: string | null;
  errorMsg: string | null;
}

export const verhoekAdapter: VerzendAdapter<VerhoekTransportOrderRow, VerwerkContext, string, SftpResultaat> = {
  kanaal: 'verhoek',
  vervoerderCode: 'verhoek_sftp',
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
      : uploadXmlViaRelay(ctx.relayConfig!, bestandsnaam!, xml),
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

  // XML-kopie naar storage (best-effort) → document_pad. De skeleton roept
  // markeer_transportorder_verstuurd aan met dit pad.
  bewaarArtefact: async (supabase, _z, xml, _r, bestandsnaam) => {
    try {
      const path = `verhoek-xml/${bestandsnaam}`;
      const { error: upErr } = await supabase.storage
        .from('order-documenten')
        .upload(path, new TextEncoder().encode(xml), { contentType: 'application/xml', upsert: true });
      if (upErr) {
        console.error(`[verhoek-send] storage-upload faalde: ${upErr.message}`);
        return null;
      }
      return path;
    } catch (e) {
      console.error(`[verhoek-send] storage-upload exception: ${String(e)}`);
      return null;
    }
  },

  // extern_referentie = bestandsnaam; track_trace = zending_nr alleen als er een
  // afl_email is (gedragsneutraal t.o.v. markeer_verhoek_verstuurd).
  uitkomst: (z, _xml, _r, bestandsnaam) => ({
    externReferentie: bestandsnaam,
    trackTrace: ((z.afl_email as string | null) ?? '').trim() !== '' ? (z.zending_nr as string) : null,
  }),

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
