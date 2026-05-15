import type { OrderFormData, OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

/** Eén regel zoals match_klant_po die teruggeeft. */
export interface PoMatchRegel {
  aantal: number | null
  ruwe_omschrijving: string | null
  artikelnr: string | null
  is_maatwerk: boolean
  maatwerk_kwaliteit_code: string | null
  maatwerk_kleur_code: string | null
  lengte_cm: number | null
  breedte_cm: number | null
  vorm_tekst: string | null
  prijs: number | null
  korting_pct: number | null
  zeker: boolean
}

export interface PoMatchAdres {
  naam: string | null
  adres: string | null
  postcode: string | null
  plaats: string | null
  land: string | null
}

export interface PoMatchResultaat {
  debiteur: { debiteur_nr: number | null; zeker: boolean }
  klant_referentie: string | null
  leverdatum_tekst: string | null
  spoed: boolean
  afleveradres: PoMatchAdres | null
  factuuradres: PoMatchAdres | null
  regels: PoMatchRegel[]
}

export interface PoPrefillSamenvatting {
  debiteurZeker: boolean
  debiteurNr: number | null
  regelsGematcht: number
  regelsConcept: number
  weekBekend: boolean
  spoed: boolean
}

export interface PoPrefill {
  header: Partial<OrderFormData>
  regels: OrderRegelFormData[]
  samenvatting: PoPrefillSamenvatting
}

/** "29-2026" of "2026-29" -> "29". Anders null. */
function parseWeek(tekst: string | null): string | null {
  if (!tekst) return null
  const m = tekst.match(/\b(\d{1,2})\s*-\s*(20\d{2})\b/) || tekst.match(/\b(20\d{2})\s*-\s*(\d{1,2})\b/)
  if (!m) return null
  const week = m[2].length === 4 ? m[1] : m[2]
  const n = Number(week)
  return n >= 1 && n <= 53 ? String(n) : null
}

export function mapMatchNaarPrefill(match: PoMatchResultaat): PoPrefill {
  const header: Partial<OrderFormData> = {}

  if (match.klant_referentie) header.klant_referentie = match.klant_referentie

  const week = parseWeek(match.leverdatum_tekst)
  if (week) header.week = week

  // Afleveradres is altijd vrije tekst -> als concept voorvullen.
  if (match.afleveradres) {
    if (match.afleveradres.naam) header.afl_naam = match.afleveradres.naam
    if (match.afleveradres.adres) header.afl_adres = match.afleveradres.adres
    if (match.afleveradres.postcode) header.afl_postcode = match.afleveradres.postcode
    if (match.afleveradres.plaats) header.afl_plaats = match.afleveradres.plaats
    if (match.afleveradres.land) header.afl_land = match.afleveradres.land
  }
  if (match.factuuradres) {
    if (match.factuuradres.naam) header.fact_naam = match.factuuradres.naam
    if (match.factuuradres.adres) header.fact_adres = match.factuuradres.adres
    if (match.factuuradres.postcode) header.fact_postcode = match.factuuradres.postcode
    if (match.factuuradres.plaats) header.fact_plaats = match.factuuradres.plaats
    if (match.factuuradres.land) header.fact_land = match.factuuradres.land
  }

  let gematcht = 0
  let concept = 0
  const regels: OrderRegelFormData[] = match.regels.map((r) => {
    const aantal = r.aantal ?? 1
    const basis: OrderRegelFormData = {
      omschrijving: r.ruwe_omschrijving ?? '',
      orderaantal: aantal,
      te_leveren: aantal,
      korting_pct: r.korting_pct ?? 0,
    }
    if (r.prijs != null) basis.prijs = r.prijs

    if (r.zeker && r.artikelnr) {
      gematcht++
      return { ...basis, artikelnr: r.artikelnr }
    }
    if (r.zeker && r.is_maatwerk) {
      gematcht++
      return {
        ...basis,
        is_maatwerk: true,
        maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code ?? undefined,
        maatwerk_kleur_code: r.maatwerk_kleur_code ?? undefined,
        maatwerk_lengte_cm: r.lengte_cm ?? undefined,
        maatwerk_breedte_cm: r.breedte_cm ?? undefined,
      }
    }
    // Niet-gematcht: concept-regel (aantal + omschrijving), geen artikelnr.
    concept++
    return basis
  })

  return {
    header,
    regels,
    samenvatting: {
      debiteurZeker: match.debiteur.zeker,
      debiteurNr: match.debiteur.debiteur_nr,
      regelsGematcht: gematcht,
      regelsConcept: concept,
      weekBekend: !!week,
      spoed: match.spoed,
    },
  }
}
