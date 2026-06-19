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

const DEFAULT_ORDER_TYPE = 'DELIVERY_LARGE';
// Verzendeenheid "Colli" — HST-code, kleine letters. Door HST bevestigd via een
// live test (T75038267004386, 2026-06-18); 'SP' (= Wegwerp pallet) was de oude
// default. Codelijst staat niet in HST's OpenAPI (vrij stringveld). Zie
// fixtures/README.md.
const DEFAULT_PACKAGE_UNIT_ID = 'col';
const DEFAULT_GOODS_DESCRIPTION = 'Tapijten';
// HST's Mendix-veld GoodsDescription accepteert max 30 tekens en weigert de
// hele TransportOrder anders met een validation error (live-fout ZEND-2026-0059:
// 'GoodsDescription: Maximale lengte is 30'). De colli-omschrijving-snapshot
// (mig 399, kwaliteit + kleur + maat) is regelmatig langer → hier afkappen.
const HST_GOODS_DESCRIPTION_MAX = 30;

function trunceerOmschrijving(omschrijving: string): string {
  const t = (omschrijving ?? '').trim();
  return t.length <= HST_GOODS_DESCRIPTION_MAX ? t : t.slice(0, HST_GOODS_DESCRIPTION_MAX).trim();
}
// Karpi verstuurt opgerolde tapijtrollen: de colli-LENGTE = de korte zijde van
// het tapijt (uit de zending_colli-snapshot, mig 399), BREEDTE en HOOGTE = de
// vaste rol-diameter (30 cm). Bewust niet 0 — HST verwerpt soms 0-waarden.
const ROL_BREEDTE_CM = 30;
const ROL_HOOGTE_CM = 30;
// Fallback-afmeting (lengte als de colli geen maat draagt — zeldzaam sinds mig
// 399) + gewicht-fallback. Bron-van-waarheid = de HST-capability-descriptor
// (ADR-0034).
const HST_DEFAULT_AFMETINGEN = capabilityVoor('hst_api')?.defaultAfmetingen ??
  { lengteCm: 120, breedteCm: 80, hoogteCm: 20, gewichtKg: 1 };
const DEFAULT_LENGTH_CM = HST_DEFAULT_AFMETINGEN.lengteCm;
const DEFAULT_WEIGHT_KG = HST_DEFAULT_AFMETINGEN.gewichtKg;

// Korte zijde van het tapijt = de lengte van de opgerolde colli: de kleinste
// van lengte/breedte (cm). Valt terug op de default als geen maat bekend is.
function korteZijdeCm(
  lengte: number | null | undefined,
  breedte: number | null | undefined,
): number {
  const maten = [lengte, breedte].filter((m): m is number => typeof m === 'number' && m > 0);
  return maten.length > 0 ? Math.min(...maten) : DEFAULT_LENGTH_CM;
}

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
    // Geen ShippingServices: "bellen voor aflevering" (FFBL) is bewust uit
    // (besluit 2026-06-18) — een lege lijst accepteert HST (live getest). Extra
    // diensten worden hier toegevoegd zodra Karpi ze gaat gebruiken.
    ShippingServices: [],
    ToAddress: bouwAddressUitZending(zending),
    FromAddress: bouwAddressUitBedrijf(bedrijf),
  };
}

function bouwLineUitColli(c: ZendingColliInput, order: OrderInput): HstTransportOrderLine {
  return {
    Quantity: 1,
    GoodsOnPallet: 0,
    GoodsDescription: trunceerOmschrijving(
      c.omschrijving_snapshot ?? `${DEFAULT_GOODS_DESCRIPTION} (${order.order_nr})`,
    ),
    ExchangePacking: false,
    Length: korteZijdeCm(c.lengte_cm, c.breedte_cm),
    Width: ROL_BREEDTE_CM,
    Height: ROL_HOOGTE_CM,
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
    GoodsDescription: trunceerOmschrijving(`${DEFAULT_GOODS_DESCRIPTION} (${order.order_nr})`),
    ExchangePacking: false,
    // Fallback-pad (geen colli-rijen) → geen colli-maat beschikbaar: lengte op
    // de default, breedte/hoogte op de vaste rol-diameter. Sinds mig 389 is
    // zendingen.totaal_gewicht_kg een trigger-afgeleide van
    // SUM(zending_colli.gewicht_kg), dus dit totaal is consistent met het
    // per-colli-pad en met wat Rhenus/Verhoek sommeren (audit A2).
    Length: DEFAULT_LENGTH_CM,
    Width: ROL_BREEDTE_CM,
    Height: ROL_HOOGTE_CM,
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
    // Stad in hoofdletters — zoals het oude systeem die ook aanleverde.
    City: (zending.afl_plaats ?? '').toUpperCase(),
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
    City: bedrijf.plaats.toUpperCase(),
    PhoneNumber: bedrijf.telefoon,
    Email: bedrijf.email,
    Country: normalizeCountry(bedrijf.land),
  };
}

// "7122 LB" → "7122LB" (HST-voorbeeldbestand gebruikt postcode zonder spatie).
function normalizeZip(zip: string): string {
  return (zip ?? '').replace(/\s+/g, '').toUpperCase();
}
