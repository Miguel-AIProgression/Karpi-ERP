// Pure data-helpers voor het verzendlabel — gedeeld door het compacte
// (liggende) en het staande 3×6-ontwerp zodat beide exact dezelfde
// product-/referentie-logica tonen.
import type { ZendingPrintRegel } from '@/modules/logistiek/queries/zendingen'
// kwaliteitNaamUitVervolg/leverancierskleurcodeUitVervolg leven sinds
// 2026-06-18 (resp. 2026-07-01) in _shared/ (ADR-0033): één bron voor het
// label én de factuur-PDF. Cross-root re-export houdt de bestaande import
// `from './shipping-label-data'` (o.a. de test) ongewijzigd.
import {
  kwaliteitNaamUitVervolg,
  leverancierskleurcodeUitVervolg,
} from '../../../../../supabase/functions/_shared/kwaliteit-naam'
export {
  kwaliteitNaamUitVervolg,
  leverancierskleurcodeUitVervolg,
} from '../../../../../supabase/functions/_shared/kwaliteit-naam'
// Pakbon-naam-resolutie leeft sinds 2026-06-19 als single source in
// _shared/pakbon (ADR-0033, Pakbondocument-consolidatie). Cross-root re-export
// houdt de bestaande imports `from './shipping-label-data'` (label + pakbon)
// ongewijzigd; productNamen accepteert ZendingPrintRegel structureel als
// PakbonRegelInput.
import { productNamen } from '../../../../../supabase/functions/_shared/pakbon/aggregatie'
export {
  productNamen,
  klantNaamWijktAf,
} from '../../../../../supabase/functions/_shared/pakbon/aggregatie'
export type { RegelNamen } from '../../../../../supabase/functions/_shared/pakbon/aggregatie'
import type { OmschrijvingSnapshot } from '../../../../../supabase/functions/_shared/pakbon/types'
export type { OmschrijvingSnapshot } from '../../../../../supabase/functions/_shared/pakbon/types'

function heeftSnapshot(s?: OmschrijvingSnapshot | null): s is OmschrijvingSnapshot {
  return !!s && (s.omschrijvingSnapshot != null || s.klantOmschrijvingSnapshot != null)
}

/** De twee productregels zoals ze op het verzendlabel verschijnen. */
export interface LabelProductRegels {
  /** Grote (vette) productregel. */
  groot: string
  /** Kleinere regel eronder; `null` = niet tonen. */
  klein: string | null
}

/**
 * Bepaalt de twee productregels op het verzendlabel.
 *
 * VASTE-MAAT producten (besluit 2026-06-18): grote regel = kwaliteitsnaam +
 * maten met de KLEINSTE maat eerst ("Galaxy 200x290 cm"), kleine regel = de
 * Karpi-code (`producten.karpi_code`). Live afgeleid uit orderregel + product;
 * de vervoerder-omschrijving (`omschrijving_snapshot`) verandert hier NIET mee.
 *
 * Maatwerk en alle gevallen met onvoldoende data (geen product, geen kwaliteit
 * of geen maat) vallen terug op het bestaande gedrag (klant-omschrijving groot,
 * Karpi-snapshot-omschrijving klein) — pakbon en carrier-payload blijven gelijk.
 */
export function labelProductRegels(
  regel: ZendingPrintRegel | null,
  snapshot?: OmschrijvingSnapshot | null,
  omstickerCode?: string | null,
): LabelProductRegels {
  const basis = basisProductRegels(regel, snapshot)

  // Omsticker (mig 436): de allocator pakte een equivalent product. De grote
  // regel toont al de bestelde kwaliteit + maat; vervang de kleine Karpi-code-
  // regel door "OMB: <karpi_code fysiek artikel>" zodat de picker ziet wat hij
  // fysiek omsticker. Leeg/afwezig → ongewijzigd.
  const omsticker = (omstickerCode ?? '').trim()
  if (omsticker) return { groot: basis.groot, klein: `OMB: ${omsticker}` }
  return basis
}

function basisProductRegels(
  regel: ZendingPrintRegel | null,
  snapshot?: OmschrijvingSnapshot | null,
): LabelProductRegels {
  const vast = vasteMaatRegels(regel)
  if (vast) return vast

  const namen = productNamen(regel, snapshot)
  const maat = productMaat(regel, snapshot)
  const groot = `${namen.klantNaam}${maat ? ` - ${maat}` : ''}`
  const klein =
    namen.karpiNaam && namen.karpiNaam !== namen.klantNaam ? namen.karpiNaam : null
  return { groot, klein }
}

/**
 * Vaste-maat-formaat, of `null` als het niet van toepassing is — dan valt de
 * caller terug op het oude gedrag.
 *
 * Grote regel (besluit 2026-06-18, verzoek Thom): kwaliteitsnaam, kleurnummer
 * tussen haakjes, maat en — als de uitvoering afwijkt — de vorm. Voorbeeld:
 * "GALAXY (10) 200x290 cm Organisch". Ronde karpetten tonen de diameter:
 * "PLUSH (11) Ø120 cm Rond". Zo ziet de picker kleur én uitvoering. Kleine
 * regel = de Karpi-code.
 *
 * Kleurnummer en vorm zijn beide optioneel: ontbreekt het kleurnummer of is de
 * uitvoering gewoon rechthoekig (geen vorm-token), dan valt dat deel weg.
 *
 * Leveranciers-kleurcode (2026-07-01, mail Pick & Ship): bij 18 kwaliteiten
 * (bv. Sofia) draagt de fysieke rol een sticker van de leverancier met een
 * eigen kleurcode die afwijkt van Karpi's interne kleurnummer — Sofia kleur
 * "13" is bij de leverancier "G305". Die code zit verstopt in
 * `vervolgomschrijving` (`leverancierskleurcodeUitVervolg`) en wordt, als hij
 * bestaat, achter het kleurnummer getoond: "SOFIA (13 – G305) 080x150 cm". De
 * overige ~99% van de producten (geen match) blijft ongewijzigd.
 */
function vasteMaatRegels(regel: ZendingPrintRegel | null): LabelProductRegels | null {
  const orderRegel = regel?.order_regels
  if (!orderRegel || orderRegel.is_maatwerk) return null
  const product = orderRegel.producten
  if (!product) return null
  const kwaliteit = kwaliteitNaamUitVervolg(product.vervolgomschrijving)
  const lengte = product.lengte_cm
  if (!kwaliteit || !lengte) return null
  const kleur = (product.kleur_code ?? '').trim()
  const leverancierskleurcode = leverancierskleurcodeUitVervolg(product.vervolgomschrijving)
  const kleurWeergave = [kleur, leverancierskleurcode].filter(Boolean).join(' – ')
  const vorm = vormUitOmschrijving(product.vervolgomschrijving ?? product.omschrijving)
  const maat = maatWeergave(lengte, product.breedte_cm, vorm)
  if (!maat) return null
  const klein = (product.karpi_code ?? regel?.artikelnr ?? '').trim() || null
  const groot = [kwaliteit, kleurWeergave ? `(${kleurWeergave})` : '', maat, vorm ?? '']
    .filter(Boolean)
    .join(' ')
  return { groot, klein }
}

/**
 * Maat-tekst voor de grote label-regel.
 *
 * RONDE karpetten meet je in diameter, niet als L×B — toon "Ø240 cm". De
 * diameter = de grootste van de twee maten: ronde producten dragen de diameter
 * vaak op `lengte_cm` met `breedte_cm = 0` (1506 stuks), de overige op een
 * gelijke L=B (1508). Beide → één consistente Ø-notatie.
 *
 * Rechthoekig/ovaal/organisch: "kleinstexgrootste cm" (kleinste eerst).
 * `null` = onvoldoende maat-data (geen breedte én niet rond) → de caller valt
 * terug op het oude gedrag.
 */
function maatWeergave(lengte: number, breedte: number | null, vorm: string | null): string | null {
  if (vorm === 'Rond') {
    const diameter = Math.max(lengte, breedte ?? 0)
    return diameter > 0 ? `Ø${diameter} cm` : null
  }
  if (!breedte) return null
  return `${Math.min(lengte, breedte)}x${Math.max(lengte, breedte)} cm`
}

/**
 * Karpet-vorm/uitvoering uit de productomschrijving, genormaliseerd naar één
 * Nederlandse term, of `null` voor een standaard (rechthoekig) karpet.
 *
 * WAAROM PARSEN: er is geen schone bron. `producten.vorm` bevat alleen
 * "rechthoek"/"rond" (en is fout — RADIUS "ROND" staat als rechthoek), en
 * `maatwerk_vorm_code` is leeg voor vaste producten. De uitvoering staat enkel
 * als suffix in de omschrijving ("…290x200 cm ORGA"), tússen ruis als
 * kleurnamen (SILVER/GREY/TAUPE) en dessins (SPLASH/ROMANCE). Daarom een
 * WHITELIST van echte vorm-woorden i.p.v. het kale staart-fragment tonen —
 * zo lift geen kleur-/dessinnaam mee.
 *
 * Word-boundary-match (JS `\b`), volgorde = specifiek-eerst zodat "halfrond"
 * niet als "rond" en "special shape" niet als losse "shape" leest.
 */
const VORM_PATRONEN: ReadonlyArray<{ re: RegExp; naam: string }> = [
  { re: /\bhalfrond\b/i, naam: 'Halfrond' },
  { re: /\bspecial\s+shape\b/i, naam: 'Special shape' },
  { re: /\b(?:organisch|organic|orga)\b/i, naam: 'Organisch' },
  { re: /\b(?:ovaal|oval)\b/i, naam: 'Ovaal' },
  { re: /\bcontour\b/i, naam: 'Contour' },
  { re: /\bpebble\b/i, naam: 'Pebble' },
  { re: /\b(?:rond|rund|rnd)\b/i, naam: 'Rond' },
]

export function vormUitOmschrijving(tekst: string | null | undefined): string | null {
  if (!tekst) return null
  for (const { re, naam } of VORM_PATRONEN) {
    if (re.test(tekst)) return naam
  }
  return null
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
 * `zending_colli.klanteigen_naam_snapshot` (mig 419). Leeg/whitespace → null
 * zodat de "Uw referentie"-regel alleen verschijnt bij een echte afwijkende
 * naam. Eén plek voor de niet-leeg-check, gedeeld door de drie labelvarianten.
 */
export function klanteigenReferentie(snapshot: string | null | undefined): string | null {
  const v = (snapshot ?? '').trim()
  return v === '' ? null : v
}
