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
export function bouwPakbonRegels(zending: PakbonZendingInput): PakbonRegel[] {
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
      }
    })
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
