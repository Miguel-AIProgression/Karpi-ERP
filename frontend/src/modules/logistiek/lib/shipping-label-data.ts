// Pure data-helpers voor het verzendlabel — gedeeld door het compacte
// (liggende) en het staande 3×6-ontwerp zodat beide exact dezelfde
// product-/referentie-logica tonen.
import type { ZendingPrintRegel } from '@/modules/logistiek/queries/zendingen'

export interface RegelNamen {
  klantNaam: string
  karpiNaam: string | null
}

/**
 * De bevroren omschrijving-snapshot van een colli (`zending_colli`, mig 209/388).
 * `LabelItem` voldoet structureel aan deze vorm.
 */
export interface OmschrijvingSnapshot {
  /** Karpi-product + maat ("Egyptische Wol 240x330 cm"). */
  omschrijvingSnapshot: string | null
  /** Ontdubbelde klant-omschrijving (order_regels.omschrijving + _2). */
  klantOmschrijvingSnapshot: string | null
}

function heeftSnapshot(s?: OmschrijvingSnapshot | null): s is OmschrijvingSnapshot {
  return !!s && (s.omschrijvingSnapshot != null || s.klantOmschrijvingSnapshot != null)
}

/**
 * Productnaam-paar voor verzendlabel/pakbon.
 *
 * SINGLE SOURCE (mig 388): bij een colli-geregistreerde zending komen beide
 * namen uit de BEVROREN snapshot op `zending_colli` — exact wat de vervoerder
 * krijgt, zodat label, pakbon en vrachtbrief niet meer uiteenlopen na een
 * productnaamwijziging. De live order_regels-afleiding (mét substring-
 * ontdubbeling, nu gespiegeld in SQL `compose_klant_omschrijving`) is alleen
 * nog de legacy-fallback voor zendingen zonder colli-snapshot.
 */
export function productNamen(
  regel: ZendingPrintRegel | null,
  snapshot?: OmschrijvingSnapshot | null,
): RegelNamen {
  if (heeftSnapshot(snapshot)) {
    return {
      klantNaam: snapshot.klantOmschrijvingSnapshot ?? regel?.artikelnr ?? 'Artikel',
      karpiNaam: snapshot.omschrijvingSnapshot,
    }
  }
  // Legacy-fallback: live afleiding (zending zonder colli-snapshot).
  const orderRegel = regel?.order_regels
  if (!orderRegel) {
    return { klantNaam: regel?.artikelnr ?? 'Artikel', karpiNaam: null }
  }
  // Ontdubbel: omschrijving_2 herhaalt vaak (een deel van) omschrijving
  // (bv. "RUBI 15 — RECHTHOEK / 240 X 330 CM" + "RECHTHOEK / 240 X 330 CM").
  const o1 = (orderRegel.omschrijving ?? '').trim()
  const o2 = (orderRegel.omschrijving_2 ?? '').trim()
  const o2IsDubbel = o2 !== '' && o1.toLowerCase().includes(o2.toLowerCase())
  const klantNaam = [o1, o2IsDubbel ? '' : o2].filter(Boolean).join(' ')
  const karpiNaam = orderRegel.producten?.omschrijving ?? null
  return { klantNaam: klantNaam || (regel?.artikelnr ?? 'Artikel'), karpiNaam }
}

export function productMaat(
  regel: ZendingPrintRegel | null,
  snapshot?: OmschrijvingSnapshot | null,
): string {
  // De maat zit al ingebakken in de Karpi-omschrijving-snapshot
  // (compose_colli_omschrijving) — niet dubbel tonen.
  if (heeftSnapshot(snapshot) && snapshot.omschrijvingSnapshot) return ''
  const orderRegel = regel?.order_regels
  if (!orderRegel?.is_maatwerk) return ''
  const lengte = orderRegel.maatwerk_lengte_cm
  const breedte = orderRegel.maatwerk_breedte_cm
  if (!lengte || !breedte) return ''
  return `${breedte}x${lengte} cm`
}

/**
 * Label-datum = de BEVROREN verzenddatum van de zending (DD/MM/YY), niet de
 * datum waarop geprint wordt. Een herprint dagen later toont zo exact wat de
 * vervoerder kreeg. Fallback: created_at. Gedeeld door alle labelformaten.
 */
export function labelDatumKort(zending: {
  verzenddatum: string | null
  created_at: string
}): string {
  const iso = zending.verzenddatum ?? zending.created_at
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear() % 100).padStart(2, '0')
  return `${dd}/${mm}/${yy}`
}

/**
 * Uniforme order-referentie op het label (Basta-ordernummer of interne id),
 * 6 cijfers. Eén anker voor álle labelformaten — DPD gebruikte voorheen
 * `zending.id`, wat niet matchte met het compacte/staande label.
 */
export function labelReferentie(order: { oud_order_nr: number | null; id: number }): string {
  return String(order.oud_order_nr ?? order.id).padStart(6, '0')
}

/**
 * Klant-eigennaam voor de kwaliteit (bv. "BREDA"), bevroren in
 * `zending_colli.klanteigen_naam_snapshot` (mig 418). Leeg/whitespace → null
 * zodat de "Uw referentie"-regel alleen verschijnt bij een echte afwijkende
 * naam. Eén plek voor de niet-leeg-check, gedeeld door de drie labelvarianten.
 */
export function klanteigenReferentie(snapshot: string | null | undefined): string | null {
  const v = (snapshot ?? '').trim()
  return v === '' ? null : v
}
