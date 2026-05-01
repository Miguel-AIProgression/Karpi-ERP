// HST-specifieke TypeScript-types voor de hst-send edge function.
//
// Deze types leven bewust binnen de verticale slice (`supabase/functions/hst-send/`)
// en NIET in `_shared/`. Reden: ze worden alleen door deze ene caller gebruikt.
// `_shared/` blijft alleen voor wat werkelijk door meerdere edge functions gedeeld
// wordt (bv. de Supabase-client-factory). Bij toekomstige Rhenus/Verhoek-vertical
// komen daar eigen types in `supabase/functions/rhenus-send/types.ts` etc.
//
// Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md (Task 2.2)

// ----------------------------------------------------------------------------
// Input-types: ruwe data zoals door de orchestrator (index.ts) uit Supabase
// wordt opgehaald. De payload-builder mapt deze naar HstTransportOrderPayload.
// ----------------------------------------------------------------------------

export interface ZendingInput {
  zending_nr: string;
  afl_naam: string | null;
  afl_adres: string | null;
  afl_postcode: string | null;
  afl_plaats: string | null;
  afl_land: string | null;
  totaal_gewicht_kg: number | null;
  aantal_colli: number | null;
  opmerkingen: string | null;
  verzenddatum: string | null; // ISO-date 'YYYY-MM-DD'
}

export interface OrderInput {
  order_nr: string;
}

export interface BedrijfInput {
  bedrijfsnaam: string;
  adres: string;
  postcode: string;
  plaats: string;
  land: string;
  telefoon: string;
  email: string;
}

// ----------------------------------------------------------------------------
// Output-types: de JSON-shape die naar HST gaat + de geparste respons.
// LET OP: de exacte veld-namen zijn placeholder tot Fase 0 (live curl-tests
// tegen de ACCP-omgeving) is uitgevoerd. Pas deze types aan zodra de werkelijke
// HST OpenAPI-spec uit `docs/logistiek/hst-api/openapi.json` beschikbaar is.
// ----------------------------------------------------------------------------

export interface HstTransportOrderPayload {
  customerId: string;
  referenceNumber: string;
  customerReference: string;
  pickupDate: string | null;
  shipper: {
    name: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
    phone: string;
    email: string;
  };
  consignee: {
    name: string;
    address: string;
    postalCode: string;
    city: string;
    country: string;
  };
  packages: Array<{
    type: string;
    quantity: number;
    weightKg: number | null;
  }>;
  remarks: string | null;
}

export interface HstResponse {
  ok: boolean;
  httpCode: number;
  // deno-lint-ignore no-explicit-any
  body: any;
  transportOrderId: string | null;
  trackingNumber: string | null;
  errorMsg: string | null;
}
