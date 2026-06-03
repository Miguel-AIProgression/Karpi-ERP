// Pure payload-builder: ruwe Supabase-data → HST TransportOrder JSON.
//
// Géén DB-toegang, géén secrets — alleen data-mapping. Daardoor triviaal
// unit-testbaar met een fixture (zie payload-builder.test.ts).
//
// Bron-shape: door HST aangeleverd voorbeeldbestand (mail Niek Zandvoort
// 2026-05-27) + live curl-rondreis op 2026-05-27 die HTTP 201 retourneerde
// met OrderNumber `T75038267000180`. Zie `fixtures/README.md`.
//
// Plan: docs/superpowers/plans/2026-05-01-logistiek-hst-api-koppeling.md

import type {
  BedrijfInput,
  HstAddress,
  HstTransportOrderLine,
  HstTransportOrderPayload,
  OrderInput,
  ZendingColliInput,
  ZendingInput,
} from './types.ts';

// Defaults voor velden die V1 nog niet uit Pick & Ship krijgt. Pas aan zodra
// de werkelijke pakket-afmetingen + service-keuze per zending bekend zijn.
const DEFAULT_ORDER_TYPE = 'DELIVERY_LARGE';
const DEFAULT_SHIPPING_SERVICE_ID = 'FFBL';
const DEFAULT_PACKAGE_UNIT_ID = 'SP';
const DEFAULT_GOODS_DESCRIPTION = 'Tapijten';
// Standaard pallet-achtige afmetingen (cm). Bewust niet 0 — HST verwerpt soms
// 0-waarden. Vervangen door werkelijke meting zodra Pick & Ship die levert.
const DEFAULT_LENGTH_CM = 120;
const DEFAULT_WIDTH_CM = 80;
const DEFAULT_HEIGHT_CM = 20;
const DEFAULT_WEIGHT_KG = 1;

export interface BouwTransportOrderArgs {
  zending: ZendingInput;
  order: OrderInput;
  bedrijf: BedrijfInput;
  hstCustomerId: string;
  /** Eén regel per fysieke colli. Verplicht voor de SSCC-koppeling: HST
   * registreert de meegestuurde BarCode aan de TransportOrder zodat hun
   * scanner ons label aan `OrderNumber` kan matchen. Leeg = fallback naar
   * één aggregate-regel zonder BarCode (alleen voor zendingen waar de
   * pickronde nog geen colli's heeft aangemaakt — die mag eigenlijk niet
   * naar HST gestuurd worden; de orchestrator guard't hierop). */
  colli: ZendingColliInput[];
}

export function bouwTransportOrderPayload(
  args: BouwTransportOrderArgs,
): HstTransportOrderPayload {
  const { zending, order, bedrijf, hstCustomerId, colli } = args;

  const lines: HstTransportOrderLine[] = colli.length > 0
    ? colli.map((c) => bouwLineUitColli(c, order))
    : [bouwAggregateLine(zending, order)];

  return {
    CustomerID: hstCustomerId,
    // CustomerReference = zending_nr — uniek per zending, getoond in HST-portaal.
    CustomerReference: zending.zending_nr,
    TransportInstruction: zending.opmerkingen ?? '',
    OrderType: DEFAULT_ORDER_TYPE,
    // HasBarcode=true vertelt HST: "wij printen zelf de labels, gebruik onze
    // SSCC's als matching-key bij scan". Alleen waar als we daadwerkelijk
    // BarCode-velden meesturen (= zodra colli's bestaan).
    HasBarcode: colli.length > 0,
    TransportOrderLines: lines,
    ShippingServices: [
      {
        ShippingServiceID: DEFAULT_SHIPPING_SERVICE_ID,
        // ExtraInformation = order_nr als secundaire ref voor HST-medewerkers.
        ExtraInformation: order.order_nr,
      },
    ],
    ToAddress: bouwAddressUitZending(zending),
    FromAddress: bouwAddressUitBedrijf(bedrijf),
  };
}

function bouwLineUitColli(c: ZendingColliInput, order: OrderInput): HstTransportOrderLine {
  return {
    Quantity: 1,
    GoodsOnPallet: 0,
    GoodsDescription: c.omschrijving_snapshot ?? `${DEFAULT_GOODS_DESCRIPTION} (${order.order_nr})`,
    ExchangePacking: false,
    Length: DEFAULT_LENGTH_CM,
    Width: DEFAULT_WIDTH_CM,
    Height: DEFAULT_HEIGHT_CM,
    Weight: c.gewicht_kg ?? DEFAULT_WEIGHT_KG,
    // AI(00) + 18-cijferige SSCC = de Code128-waarde die ook op het label staat.
    BarCode: { BarCode: `00${c.sscc}` },
    PackageUnitID: DEFAULT_PACKAGE_UNIT_ID,
  };
}

function bouwAggregateLine(zending: ZendingInput, order: OrderInput): HstTransportOrderLine {
  return {
    Quantity: zending.aantal_colli ?? 1,
    GoodsOnPallet: 0,
    GoodsDescription: `${DEFAULT_GOODS_DESCRIPTION} (${order.order_nr})`,
    ExchangePacking: false,
    Length: DEFAULT_LENGTH_CM,
    Width: DEFAULT_WIDTH_CM,
    Height: DEFAULT_HEIGHT_CM,
    Weight: zending.totaal_gewicht_kg ?? DEFAULT_WEIGHT_KG,
    BarCode: { BarCode: '' },
    PackageUnitID: DEFAULT_PACKAGE_UNIT_ID,
  };
}

function bouwAddressUitZending(zending: ZendingInput): HstAddress {
  const { street, number, addition } = splitAdres(zending.afl_adres ?? '');
  return {
    CustomerCode: '',
    Name: zending.afl_naam ?? '',
    NameAddition: '',
    Street: street,
    StreetNumber: number,
    StreetNumberAddition: addition,
    ZipCode: normalizeZip(zending.afl_postcode ?? ''),
    City: zending.afl_plaats ?? '',
    PhoneNumber: '',
    Email: '',
    Country: normalizeCountry(zending.afl_land ?? ''),
  };
}

function bouwAddressUitBedrijf(bedrijf: BedrijfInput): HstAddress {
  const { street, number, addition } = splitAdres(bedrijf.adres);
  return {
    CustomerCode: '',
    Name: bedrijf.bedrijfsnaam,
    NameAddition: '',
    Street: street,
    StreetNumber: number,
    StreetNumberAddition: addition,
    ZipCode: normalizeZip(bedrijf.postcode),
    City: bedrijf.plaats,
    PhoneNumber: bedrijf.telefoon,
    Email: bedrijf.email,
    Country: normalizeCountry(bedrijf.land),
  };
}

// Splitst "Tweede Broekdijk 10 A" → { street: "Tweede Broekdijk", number: "10", addition: "A" }
// HST wil straat, nummer en toevoeging in aparte velden.
export function splitAdres(adres: string): { street: string; number: string; addition: string } {
  const trimmed = (adres ?? '').trim();
  if (!trimmed) return { street: '', number: '', addition: '' };
  // Match: <straatnaam (letters/spaties/punten)> <nummer (cijfers)><optioneel toevoeging (letters/streep/spatie+letters)>
  const m = trimmed.match(/^(.+?)\s+(\d+)\s*([A-Za-z][A-Za-z0-9\-\s]*)?$/);
  if (!m) {
    return { street: trimmed, number: '', addition: '' };
  }
  return {
    street: m[1].trim(),
    number: m[2].trim(),
    addition: (m[3] ?? '').trim(),
  };
}

// "7122 LB" → "7122LB" (HST-voorbeeldbestand gebruikt postcode zonder spatie).
function normalizeZip(zip: string): string {
  return (zip ?? '').replace(/\s+/g, '').toUpperCase();
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
  return upper;
}
