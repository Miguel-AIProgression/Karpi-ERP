// HST-specifieke TypeScript-types voor de hst-send edge function.
//
// Bron-van-waarheid: het door HST geleverde voorbeeldbestand (mail Niek
// Zandvoort 2026-05-27) + de OpenAPI-schema-stub uit `/restdoc/rest/api/v1#/`.
// Live curl-rondreis op 2026-05-27 bevestigde de request- én response-shape
// (zie `fixtures/README.md`).
//
// Deze types leven bewust binnen de verticale slice (`supabase/functions/hst-send/`)
// en NIET in `_shared/` — alleen deze caller gebruikt ze.
//
// Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md

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
  afl_telefoon: string | null;
  afl_email: string | null;
  totaal_gewicht_kg: number | null;
  aantal_colli: number | null;
  opmerkingen: string | null;
  verzenddatum: string | null; // ISO-date 'YYYY-MM-DD'
}

export interface OrderInput {
  order_nr: string;
  debiteur_nr?: number | null;
}

// Eén fysiek colli binnen de zending (mig 209: 1 tapijt = 1 colli).
// SSCC = 18-cijferige GS1-barcode. De volledige Code128-waarde op de label
// krijgt AI(00) prefix: `00${sscc}` → 20 chars.
export interface ZendingColliInput {
  colli_nr: number;
  sscc: string;
  gewicht_kg: number | null;
  omschrijving_snapshot: string | null;
}

export interface BedrijfInput {
  bedrijfsnaam: string;
  adres: string;        // bv. "Tweede Broekdijk 10" — wordt gesplitst in Street/StreetNumber
  postcode: string;
  plaats: string;
  land: string;
  telefoon: string;
  email: string;
}

// ----------------------------------------------------------------------------
// Output-types: de JSON-shape die naar HST gaat + de geparste respons.
// PascalCase volgt de HST-API. Velden gemarkeerd als optional (`?`) ontbreken
// in het voorbeeldbestand en blijken in praktijk weglaatbaar.
// ----------------------------------------------------------------------------

export interface HstAddress {
  CustomerCode: string;          // mag "" zijn voor afzender; voor ontvanger optioneel HST-klantcode
  Name: string;
  NameAddition: string;
  Street: string;
  StreetNumber: string;
  StreetNumberAddition: string;
  ZipCode: string;
  City: string;
  PhoneNumber: string;
  Email: string;
  Country: string;               // ISO-2, bv. "NL"
}

export interface HstTransportOrderLine {
  Quantity: number;
  GoodsOnPallet: number;
  GoodsDescription: string;
  ExchangePacking: boolean;
  Length: number;                // cm
  Width: number;                 // cm
  Height: number;                // cm
  Weight: number;                // kg
  BarCode: { BarCode: string };  // "" indien geen eigen barcode
  PackageUnitID: string;         // bv. "SP"
}

export interface HstShippingService {
  ShippingServiceID: string;     // bv. "FFBL"
  ExtraInformation: string;      // vrije tekst — telefoon/referentie
}

export interface HstTransportOrderPayload {
  CustomerID: string;
  CustomerReference: string;     // wij gebruiken zending_nr (uniek per zending, getoond in HST-portaal)
  TransportInstruction: string;  // vrije tekst voor de chauffeur (uit zendingen.opmerkingen)
  OrderType: string;             // bv. "DELIVERY_LARGE"
  TransportOrderLines: HstTransportOrderLine[];
  ShippingServices: HstShippingService[];
  ToAddress: HstAddress;
  FromAddress: HstAddress;
  // Optionele velden uit de OpenAPI-spec (niet aanwezig in voorbeeldbestand).
  // Toevoegen wanneer Karpi ze gaat gebruiken; nu weglaten om payload schoon te houden.
  PickupDate?: string;
  ShippingDate?: string;
  IndicatedDeliveryDate?: string;
  IndicatedReturnDate?: string;
  WhoNumber?: string;
  HasBarcode?: boolean;
  DouaneAmount?: number;
  DouaneCurrency?: string;
  CountryOfOrigin?: string;
  OrderInfos?: Array<{ Code: string; Description: string; InfoField: string }>;
  Hazmats?: unknown[];
  LimitedQuantities?: unknown[];
}

// Response shape — bevestigd via live test 2026-05-27 (HTTP 201).
export interface HstTransportOrderResponseBody {
  Success: boolean;
  OrderNumber: string;
  PDFDocument?: { Contents: string }; // base64-PDF (vrachtbrief/label)
}

export interface HstResponse {
  ok: boolean;
  httpCode: number;
  // deno-lint-ignore no-explicit-any
  body: any;
  transportOrderId: string | null;  // = HST.OrderNumber
  trackingNumber: string | null;    // V1: zelfde als OrderNumber (HST levert geen apart tracking-veld)
  pdfBase64: string | null;         // PDF voor toekomstig opslaan in storage; nu niet in DB gelogd
  errorMsg: string | null;
}
