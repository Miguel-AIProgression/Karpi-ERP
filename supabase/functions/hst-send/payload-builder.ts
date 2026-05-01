// Pure payload-builder: ruwe Supabase-data → HST TransportOrder JSON.
//
// Géén DB-toegang, géén secrets — alleen data-mapping. Daardoor triviaal
// unit-testbaar met een fixture (zie payload-builder.test.ts).
//
// LET OP veld-namen: deze zijn een redelijke gok op basis van een typische
// REST transport-API. Tijdens Fase 0 (live curl tegen ACCP) moet de fixture
// in `fixtures/example-transportorder-request.json` vervangen worden door de
// werkelijke HST-shape; pas vervolgens deze builder + types.ts aan tot de
// fixture-test groen blijft.
//
// Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md (Task 2.2)

import type {
  BedrijfInput,
  HstTransportOrderPayload,
  OrderInput,
  ZendingInput,
} from './types.ts';

export interface BouwTransportOrderArgs {
  zending: ZendingInput;
  order: OrderInput;
  bedrijf: BedrijfInput;
  hstCustomerId: string;
}

export function bouwTransportOrderPayload(
  args: BouwTransportOrderArgs,
): HstTransportOrderPayload {
  const { zending, order, bedrijf, hstCustomerId } = args;

  return {
    customerId: hstCustomerId,
    // referenceNumber = zending_nr — uniek per zending, getoond in HST-portaal.
    referenceNumber: zending.zending_nr,
    // customerReference = order_nr — secundaire link naar de order in Karpi.
    customerReference: order.order_nr,
    pickupDate: zending.verzenddatum,
    shipper: {
      name: bedrijf.bedrijfsnaam,
      address: bedrijf.adres,
      postalCode: bedrijf.postcode,
      city: bedrijf.plaats,
      // Normaliseer 'Nederland' → ISO-2 'NL'. Andere landen worden 1-op-1 doorgegeven
      // (bedrijfsgegevens-record bevat in de praktijk al ISO-2).
      country: normalizeCountry(bedrijf.land),
      phone: bedrijf.telefoon,
      email: bedrijf.email,
    },
    consignee: {
      name: zending.afl_naam ?? '',
      address: zending.afl_adres ?? '',
      postalCode: zending.afl_postcode ?? '',
      city: zending.afl_plaats ?? '',
      country: normalizeCountry(zending.afl_land ?? ''),
    },
    packages: [
      {
        // 'PARCEL' is een aanname; HST kan een andere code gebruiken (bv. 'PCK',
        // 'COLLI'). Bevestigen na Fase 0 op basis van OpenAPI-spec.
        type: 'PARCEL',
        quantity: zending.aantal_colli ?? 1,
        weightKg: zending.totaal_gewicht_kg ?? null,
      },
    ],
    remarks: zending.opmerkingen ?? null,
  };
}

function normalizeCountry(land: string): string {
  const trimmed = (land ?? '').trim();
  if (!trimmed) return '';
  const upper = trimmed.toUpperCase();
  if (upper === 'NEDERLAND' || upper === 'THE NETHERLANDS' || upper === 'HOLLAND') {
    return 'NL';
  }
  if (upper === 'DUITSLAND' || upper === 'GERMANY') return 'DE';
  if (upper === 'BELGIE' || upper === 'BELGIË' || upper === 'BELGIUM') return 'BE';
  if (upper === 'FRANKRIJK' || upper === 'FRANCE') return 'FR';
  // ISO-2 codes en onbekende landen: 1-op-1 in upper-case doorgeven.
  return upper;
}
