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

import { normalizeCountry, splitAdres } from '../_shared/adres-split.ts';
import { capabilityVoor } from '../_shared/vervoerders/capabilities.ts';
import { labelBarcode } from '../_shared/vervoerders/labelbarcode.ts';
export { splitAdres };

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
// 0-waarden. Bron-van-waarheid = de HST-capability-descriptor (ADR-0034);
// vervangen door werkelijke meting zodra Pick & Ship die levert.
const HST_DEFAULT_AFMETINGEN = capabilityVoor('hst_api')?.defaultAfmetingen ??
  { lengteCm: 120, breedteCm: 80, hoogteCm: 20, gewichtKg: 1 };
const DEFAULT_LENGTH_CM = HST_DEFAULT_AFMETINGEN.lengteCm;
const DEFAULT_WIDTH_CM = HST_DEFAULT_AFMETINGEN.breedteCm;
const DEFAULT_HEIGHT_CM = HST_DEFAULT_AFMETINGEN.hoogteCm;
const DEFAULT_WEIGHT_KG = HST_DEFAULT_AFMETINGEN.gewichtKg;

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
    // De labelbarcode (AI(00)+SSCC) uit de gedeelde seam — exact wat op het
    // label staat en bij elke vervoerder wordt aangemeld (single source).
    BarCode: { BarCode: labelBarcode(c.sscc) ?? '' },
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
    // Fallback-pad (geen colli-rijen). Sinds mig 389 is
    // zendingen.totaal_gewicht_kg een trigger-afgeleide van
    // SUM(zending_colli.gewicht_kg), dus dit totaal is consistent met het
    // per-colli-pad en met wat Rhenus/Verhoek sommeren (audit A2).
    Height: DEFAULT_HEIGHT_CM,
    Weight: zending.totaal_gewicht_kg ?? DEFAULT_WEIGHT_KG,
    BarCode: { BarCode: '' },
    PackageUnitID: DEFAULT_PACKAGE_UNIT_ID,
  };
}

// HST keurt een StreetNumberAddition >5 tekens af met HTTP 400 (live-fout
// ZEND-2026-0002: '"Unit 30" overschrijdt het maximum van 5 karakters').
const HST_STREET_NUMBER_ADDITION_MAX = 5;

// Korte toevoeging ('G', '001', '-5') → StreetNumberAddition; langere
// ('Unit 30', 'Gebouw B') → NameAddition, HST's vrije extra adresregel.
export function verdeelToevoeging(addition: string): {
  streetNumberAddition: string;
  nameAddition: string;
} {
  const trimmed = (addition ?? '').trim();
  if (trimmed.length <= HST_STREET_NUMBER_ADDITION_MAX) {
    return { streetNumberAddition: trimmed, nameAddition: '' };
  }
  return { streetNumberAddition: '', nameAddition: trimmed };
}

function bouwAddressUitZending(zending: ZendingInput): HstAddress {
  const { street, number, addition } = splitAdres(zending.afl_adres ?? '');
  const toevoeging = verdeelToevoeging(addition);
  return {
    CustomerCode: '',
    Name: zending.afl_naam ?? '',
    NameAddition: toevoeging.nameAddition,
    Street: street,
    StreetNumber: number,
    StreetNumberAddition: toevoeging.streetNumberAddition,
    ZipCode: normalizeZip(zending.afl_postcode ?? ''),
    City: zending.afl_plaats ?? '',
    PhoneNumber: zending.afl_telefoon ?? '',
    // Aflever-e-mailadres = track & trace-contact (mig 365). Bewust nooit een
    // factuur-adres — de klant moet wél de T&T krijgen maar niet de factuur.
    Email: zending.afl_email ?? '',
    Country: normalizeCountry(zending.afl_land ?? ''),
  };
}

function bouwAddressUitBedrijf(bedrijf: BedrijfInput): HstAddress {
  const { street, number, addition } = splitAdres(bedrijf.adres);
  const toevoeging = verdeelToevoeging(addition);
  return {
    CustomerCode: '',
    Name: bedrijf.bedrijfsnaam,
    NameAddition: toevoeging.nameAddition,
    Street: street,
    StreetNumber: number,
    StreetNumberAddition: toevoeging.streetNumberAddition,
    ZipCode: normalizeZip(bedrijf.postcode),
    City: bedrijf.plaats,
    PhoneNumber: bedrijf.telefoon,
    Email: bedrijf.email,
    Country: normalizeCountry(bedrijf.land),
  };
}

// "7122 LB" → "7122LB" (HST-voorbeeldbestand gebruikt postcode zonder spatie).
function normalizeZip(zip: string): string {
  return (zip ?? '').replace(/\s+/g, '').toUpperCase();
}
