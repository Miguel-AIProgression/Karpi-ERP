// Pure pakbon-aggregatie + naam-resolutie. Spiegelt de frontend-logica
// (`printset.ts` → `pakbonRegels` en `shipping-label-data.ts` → `productNamen`/
// `productMaat`) zodat de server-pakbon-PDF byte-identieke regelinhoud levert.
// In de eindstaat (na verwijderen van de React-pakbon, Slice 2) is dit de enige
// pakbon-aggregatie — single source.

import type {
  OmschrijvingSnapshot,
  PakbonColliInput,
  PakbonRegel,
  PakbonRegelInput,
  PakbonRegelsInput,
  PakbonZendingInput,
} from './types.ts'

/** Verzendkosten-artikel — factuurregel, geen fysiek collo (mirror SHIPPING_PRODUCT_ID). */
export const VERZEND_ARTIKELNR = 'VERZEND'

/** Is dit een verzendkosten-regel die op de pakbon overgeslagen moet worden? */
export function isShippingRegel(regel: PakbonRegelInput): boolean {
  if (regel.artikelnr === VERZEND_ARTIKELNR) return true
  if (regel.order_regels?.artikelnr === VERZEND_ARTIKELNR) return true
  return false
}

/** Geleverd-aantal in deze zending — identiek aan de historische pakbon-ladder. */
function geleverdAantal(regel: PakbonRegelInput): number {
  return Number(
    regel.aantal ?? regel.order_regels?.te_leveren ?? regel.order_regels?.orderaantal ?? 1,
  )
}

/** Regelgewicht (kg) — `order_regels.gewicht_kg` met product-fallback. */
function regelGewichtKg(regel: PakbonRegelInput): number {
  const r = regel.order_regels
  if (!r) return 0
  return Number(r.gewicht_kg ?? r.producten?.gewicht_kg ?? 0)
}

/**
 * Eén pakbonregel per fysieke orderregel, gesorteerd op regelnummer. Gelijk aan
 * de `pakbonRegels`-tak van `bouwVerzenddocument` (frontend), maar zonder de
 * label/colli-expansie (die blijft frontend, registry-afhankelijk).
 */
export function bouwPakbonRegels(zending: PakbonRegelsInput): PakbonRegel[] {
  const fysiekeRegels = zending.zending_regels.filter((r) => !isShippingRegel(r))
  const primaireOrderId = zending.orders.id

  // Snapshot-omschrijving per orderregel (eerste colli — compose is in V1
  // regel-deterministisch, dus alle colli van een regel zijn identiek).
  const snapshotPerOrderRegel = new Map<number, OmschrijvingSnapshot>()
  for (const c of (zending.zending_colli ?? []) as PakbonColliInput[]) {
    if (c.order_regel_id != null && !snapshotPerOrderRegel.has(c.order_regel_id)) {
      snapshotPerOrderRegel.set(c.order_regel_id, {
        omschrijvingSnapshot: c.omschrijving_snapshot,
        klantOmschrijvingSnapshot: c.klant_omschrijving_snapshot,
      })
    }
  }

  // Mig 436: unieke omsticker-codes per orderregel (over álle colli van de regel
  // — een regel kan multi-source gedekt zijn). Gelijk aan de frontend-expansie.
  const omstickerPerOrderRegel = new Map<number, string[]>()
  for (const c of (zending.zending_colli ?? []) as PakbonColliInput[]) {
    if (c.order_regel_id == null) continue
    const code = (c.omsticker_snapshot ?? '').trim()
    if (!code) continue
    const lijst = omstickerPerOrderRegel.get(c.order_regel_id) ?? []
    if (!lijst.includes(code)) lijst.push(code)
    omstickerPerOrderRegel.set(c.order_regel_id, lijst)
  }

  const orderIdVoor = (regel: PakbonRegelInput): number =>
    regel.order_regels?.order_id ?? primaireOrderId

  return [...fysiekeRegels]
    .sort((a, b) => (a.order_regels?.regelnummer ?? 0) - (b.order_regels?.regelnummer ?? 0))
    .map((regel) => {
      const geleverd = geleverdAantal(regel)
      const snapshot =
        (regel.order_regel_id != null
          ? snapshotPerOrderRegel.get(regel.order_regel_id)
          : undefined) ?? null
      return {
        regel,
        orderRegelId: regel.order_regel_id,
        orderId: orderIdVoor(regel),
        besteld: Number(regel.order_regels?.orderaantal ?? geleverd),
        geleverd,
        gewichtKg: regelGewichtKg(regel) * geleverd,
        snapshot,
        omstickerCodes:
          regel.order_regel_id != null
            ? omstickerPerOrderRegel.get(regel.order_regel_id) ?? []
            : [],
      }
    })
}

/**
 * Aantal fysieke colli — gelijk aan `colliRijen.length` van de frontend
 * `bouwVerzenddocument`: bij colli-registratie het aantal colli-rijen, anders het
 * legacy-pad (som van fysieke-regel-aantallen, minimaal 1).
 */
export function telColli(zending: PakbonZendingInput): number {
  const colli = zending.zending_colli ?? []
  if (colli.length > 0) return colli.length
  const fysiekeRegels = zending.zending_regels.filter((r) => !isShippingRegel(r))
  let som = 0
  for (const regel of fysiekeRegels) som += Math.max(0, Math.trunc(Number(regel.aantal ?? 1)))
  return Math.max(som, 1)
}

export interface RegelNamen {
  klantNaam: string
  karpiNaam: string | null
}

function heeftSnapshot(s?: OmschrijvingSnapshot | null): s is OmschrijvingSnapshot {
  return !!s && (s.omschrijvingSnapshot != null || s.klantOmschrijvingSnapshot != null)
}

/**
 * Productnaam-paar voor de pakbon. SINGLE SOURCE (mig 388): bij een colli-
 * geregistreerde zending komen beide namen uit de BEVROREN snapshot; de live
 * order_regels-afleiding (mét ontdubbeling) is alleen de legacy-fallback.
 * Spiegelt `productNamen` uit `shipping-label-data.ts`.
 */
export function productNamen(
  regel: PakbonRegelInput | null,
  snapshot?: OmschrijvingSnapshot | null,
): RegelNamen {
  if (heeftSnapshot(snapshot)) {
    return {
      klantNaam: snapshot.klantOmschrijvingSnapshot ?? regel?.artikelnr ?? 'Artikel',
      karpiNaam: snapshot.omschrijvingSnapshot,
    }
  }
  const orderRegel = regel?.order_regels
  if (!orderRegel) {
    return { klantNaam: regel?.artikelnr ?? 'Artikel', karpiNaam: null }
  }
  const o1 = (orderRegel.omschrijving ?? '').trim()
  const o2 = (orderRegel.omschrijving_2 ?? '').trim()
  const o2IsDubbel = o2 !== '' && o1.toLowerCase().includes(o2.toLowerCase())
  const klantNaam = [o1, o2IsDubbel ? '' : o2].filter(Boolean).join(' ')
  const karpiNaam = orderRegel.producten?.omschrijving ?? null
  return { klantNaam: klantNaam || (regel?.artikelnr ?? 'Artikel'), karpiNaam }
}

function normaliseerNaam(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Of de klant-eigen omschrijving (pakbon-subregel "Uw naam: …") zinvol afwijkt
 * van de hoofdregel die er al boven staat. Single source — gespiegeld door de
 * frontend via cross-root re-export (`shipping-label-data.ts`, ADR-0033).
 *
 * De hoofdregel komt uit `omschrijving_snapshot` (Karpi-omschrijving **+ maat**),
 * "Uw naam" uit `klant_omschrijving_snapshot` (zónder maat). Een kale string-
 * ongelijkheid is dus altijd waar door de maat-suffix → "Uw naam" verscheen
 * overal. Toon "Uw naam" daarom alleen als de klant-naam niet leeg is, niet
 * simpelweg het artikelnummer is, en (genormaliseerd) niet al volledig in de
 * hoofdregel zit.
 */
export function klantNaamWijktAf(
  hoofdNaam: string | null,
  klantNaam: string | null,
  artikelnr: string | null,
): boolean {
  const klant = normaliseerNaam(klantNaam ?? '')
  if (!klant) return false
  if (artikelnr && klant === normaliseerNaam(artikelnr)) return false
  const hoofd = normaliseerNaam(hoofdNaam ?? '')
  if (hoofd.includes(klant)) return false
  return true
}
