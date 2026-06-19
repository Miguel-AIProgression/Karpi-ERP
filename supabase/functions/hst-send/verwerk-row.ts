// HST-adapter op de verzend-orchestrator-skeleton (ADR-0035 slice 3). HST is het
// LIVE pad + het enige REST-transport. De gedeelde sequence leeft in
// `_shared/verzend-orchestrator.ts`; dit bestand levert het HST-specifieke deel:
// JSON-payload via REST, PDF naar storage (geen XML), géén bestandsnaam-dedup,
// en markeer_hst_*-RPC's met transport_order_id/tracking/pdf-velden. HST logt in
// `summary.details` fase-CODES i.p.v. de foutmelding — daarom mapt `markFout` de
// skeleton-`fase` terug naar de code.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { bouwTransportOrderPayload } from './payload-builder.ts';
import { postTransportOrder } from './hst-client.ts';
import {
  type VerzendAdapter,
  type VerzendFase,
  type VerzendSummaryBasis,
  verwerkVerzendRij,
} from '../_shared/verzend-orchestrator.ts';
import type {
  BedrijfInput,
  HstResponse,
  HstTransportOrderPayload,
  OrderInput,
  ZendingInput,
} from './types.ts';

export interface SendSummary extends VerzendSummaryBasis {
  processed: number;
  empty_queue: boolean;
  details: Array<{
    id: number;
    zending_id: number;
    status: 'sent' | 'error';
    transportOrderId?: string | null;
    httpCode?: number;
    error?: string;
  }>;
}

export interface HstTransportOrderRow {
  id: number;
  zending_id: number;
  debiteur_nr: number | null;
  status: string;
  is_test: boolean;
  // HST gebruikt geen SFTP-bestandsnaam; het veld bestaat op de wachtrij-rij maar
  // blijft NULL (geen maakBestandsnaam → skeleton leest 't niet).
  extern_referentie?: string | null;
}

export interface HstSecrets {
  hstBaseUrl: string;
  hstUsername: string;
  hstWachtwoord: string;
  hstCustomerId: string;
}

// De foutmelding-fase → de detail-code die HST in summary.details logt
// (gedragsneutraal t.o.v. de oude verwerkRow).
const FASE_CODE: Record<VerzendFase, string> = {
  zending: 'zending_niet_gevonden',
  order: 'order_niet_gevonden',
  bedrijf: 'bedrijfsgegevens_ontbreken',
  colli_query: 'colli_query_fout',
  geen_colli: 'geen_colli',
  preflight: 'preflight',
  bestandsnaam: 'bestandsnaam', // HST kent geen bestandsnaam — nooit geraakt
};

export const hstAdapter: VerzendAdapter<HstTransportOrderRow, HstSecrets, HstTransportOrderPayload, HstResponse> = {
  kanaal: 'hst',
  vervoerderCode: 'hst_api',
  contentType: 'application/json',
  zendingSelect:
    'zending_nr, order_id, afl_naam, afl_adres, afl_postcode, afl_plaats, afl_land, afl_telefoon, afl_email, totaal_gewicht_kg, aantal_colli, opmerkingen, verzenddatum',
  orderSelect: 'order_nr',

  // Zonder colli's kan HST's scanner ons label niet aan de TransportOrder
  // koppelen — liever niet POSTen + duidelijke fout (harde guard vóór preflight).
  hardFailOnZeroColli: true,
  zeroColliMelding: (zendingId) =>
    `Geen zending_colli voor zending ${zendingId}. Pickronde moet genereer_zending_colli aanroepen vóórdat de zending op "Klaar voor verzending" gaat — anders kan HST's scanner ons label niet koppelen.`,

  // HST valideert geen per-colli velden (capability colliVelden=[]); de
  // payload-builder valt terug op pallet-default-afmetingen.
  preflightColli: () => [],

  // REST → geen bestandsnaam-dedup (geen maakBestandsnaam → skeleton slaat de
  // extern_referentie-persist-stap over).

  bouwPayload: ({ z, order, bedrijf, colli, ctx }) =>
    bouwTransportOrderPayload({
      zending: z as unknown as ZendingInput,
      order: order as unknown as OrderInput,
      bedrijf: bedrijf as BedrijfInput,
      hstCustomerId: ctx.hstCustomerId,
      colli,
    }),
  payloadRaw: (payload) => JSON.stringify(payload),

  transport: (ctx, payload) =>
    postTransportOrder({
      baseUrl: ctx.hstBaseUrl,
      username: ctx.hstUsername,
      wachtwoord: ctx.hstWachtwoord,
      payload,
    }),
  resultOk: (r) => r.ok,
  resultFout: (r) => r.errorMsg,
  // HST gaf een OrderNumber mee ondanks Success=false → order bestaat al, niet
  // opnieuw POSTen (anders duplicaat). De orchestrator maakt de rij terminaal.
  resultTerminaal: (r) => r.aangemeldMaarFout === true,

  auditExterneId: (_bestandsnaam, r, z) => r.transportOrderId ?? (z.zending_nr as string | null) ?? null,
  auditPayloadJson: (payload, r) => ({
    request: payload,
    response: r.body,
    http_code: r.httpCode,
    ok: r.ok,
    transport_order_id: r.transportOrderId,
    tracking_number: r.trackingNumber,
  }),

  // PDF-vrachtbrief naar storage als HST 'm meegaf (best-effort: een mislukte
  // upload mag het HST-succes niet ongedaan maken — POST is al gelukt). De
  // skeleton zet het pad als document_pad in markeer_transportorder_verstuurd
  // → spiegel-trigger naar order_documenten (mig 304 → mig 426).
  bewaarArtefact: async (supabase, z, _payload, r, _bestandsnaam) => {
    const zendingNr = z.zending_nr as string | null;
    if (!r.pdfBase64 || !zendingNr) return null;
    const path = `hst-vrachtbrieven/${zendingNr}.pdf`;
    const upErr = await uploadPdf(supabase, path, r.pdfBase64);
    if (upErr) {
      console.error(`PDF-upload voor zending ${zendingNr} faalde: ${upErr}`);
      return null;
    }
    return path;
  },

  // Generieke verstuurd-velden. zending.track_trace kreeg voorheen
  // COALESCE(tracking_number, transport_order_id) — hier expliciet gemaakt.
  uitkomst: (_z, _payload, r) => ({
    externReferentie: r.transportOrderId ?? null,
    trackTrace: r.trackingNumber ?? r.transportOrderId ?? null,
  }),

  noteerSucces: (row, r, _bestandsnaam, summary) => {
    summary.succeeded += 1;
    summary.details.push({
      id: row.id,
      zending_id: row.zending_id,
      status: 'sent',
      transportOrderId: r.transportOrderId,
      httpCode: r.httpCode,
    });
  },
  noteerFout: (row, r, summary) => {
    summary.failed += 1;
    summary.details.push({
      id: row.id,
      zending_id: row.zending_id,
      status: 'error',
      httpCode: r.httpCode,
      error: r.errorMsg ?? 'onbekende fout',
    });
  },
  // HST logt de fase-CODE in summary.details i.p.v. de melding (gedragsneutraal).
  noteerMarkFout: (row, _melding, fase, summary) => {
    summary.failed += 1;
    summary.details.push({ id: row.id, zending_id: row.zending_id, status: 'error', error: FASE_CODE[fase] });
  },
};

// Upload de PDF (base64-string van HST) naar de order-documenten-bucket.
// Returnt null bij succes of een error-message-string bij falen. Bewust geen
// throw — een PDF-upload-fout mag het HST-succes niet ongedaan maken.
async function uploadPdf(
  supabase: SupabaseClient,
  path: string,
  base64: string,
): Promise<string | null> {
  try {
    const bytes = base64ToBytes(base64);
    const { error } = await supabase.storage
      .from('order-documenten')
      .upload(path, bytes, {
        contentType: 'application/pdf',
        upsert: true, // overschrijf bij retry / heruitvoer
      });
    return error ? error.message : null;
  } catch (err) {
    return `decode/upload-exception: ${String(err)}`;
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Publieke entry — index.ts (claim-loop) + karakterisatie-test. */
export function verwerkRow(
  supabase: SupabaseClient,
  row: HstTransportOrderRow,
  secrets: HstSecrets,
  summary: SendSummary,
): Promise<void> {
  return verwerkVerzendRij(hstAdapter, supabase, row, secrets, summary);
}
