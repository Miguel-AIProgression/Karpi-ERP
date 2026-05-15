import type { OrderFormData, OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { verzendWeekStringToDatum } from '@/lib/orders/verzendweek'

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

/**
 * Leverweek uit vrije tekst. Voorkeur: expliciete week-context ("wk 29",
 * "week 29", "leverweek 29 2026") — hoogste zekerheid. Daarna de kale
 * "NN-YYYY"/"YYYY-NN"-vorm (scheiding `-` of `/`). Geen match -> null
 * (conform "alleen zeker voorvullen": liever leeg dan een foute week).
 * ISO 8601 lange jaren hebben max week 53.
 *
 * Returns { week, jaar } where jaar is null when no 4-digit year was found.
 */
function geldigeWeekNr(n: number): number | null {
  return Number.isInteger(n) && n >= 1 && n <= 53 ? n : null
}
function parseWeek(tekst: string | null): { week: number; jaar: number | null } | null {
  if (!tekst) return null
  const t = tekst.toLowerCase()
  // 1. Expliciete week-context ("wk"/"week"/"leverweek", optioneel punt).
  const ctx = t.match(/\b(?:lever)?w(?:ee)?k\.?\s*(\d{1,2})\b/)
  if (ctx) {
    const week = geldigeWeekNr(Number(ctx[1]))
    if (week === null) return null
    // Capture a 4-digit year 20xx if present anywhere in the string.
    const jaarMatch = t.match(/\b(20\d{2})\b/)
    const jaar = jaarMatch ? Number(jaarMatch[1]) : null
    return { week, jaar }
  }
  // 2. Kale NN-YYYY / YYYY-NN (separator - of /).
  const m =
    t.match(/\b(\d{1,2})\s*[-/]\s*(20\d{2})\b/) ||
    t.match(/\b(20\d{2})\s*[-/]\s*(\d{1,2})\b/)
  if (!m) return null
  const rawWeek = m[2].length === 4 ? m[1] : m[2]
  const rawJaar = m[2].length === 4 ? m[2] : m[1]
  const week = geldigeWeekNr(Number(rawWeek))
  if (week === null) return null
  return { week, jaar: Number(rawJaar) }
}

export function mapMatchNaarPrefill(match: PoMatchResultaat): PoPrefill {
  const header: Partial<OrderFormData> = {}

  if (match.klant_referentie) header.klant_referentie = match.klant_referentie

  const wk = parseWeek(match.leverdatum_tekst)
  let afleverdatumSet = false
  if (wk && wk.jaar != null) {
    const isoWeek = `${wk.jaar}-W${String(wk.week).padStart(2, '0')}`
    const afleverdatum = verzendWeekStringToDatum(isoWeek)
    if (afleverdatum != null) {
      header.afleverdatum = afleverdatum
      header.week = String(wk.week)
      afleverdatumSet = true
    }
  }
  // If wk exists but jaar is null, or verzendWeekStringToDatum returned null:
  // set neither header.week nor header.afleverdatum (can't produce a trustworthy date).

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
      // `vorm_tekst` ("Rechthoekig"/"Rond") is bewust NIET voorgevuld: de
      // ruwe tekst is niet zeker te mappen op een maatwerk-vorm-code en de
      // form defaultt naar rechthoek — operator kiest vorm zelf.
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
      weekBekend: afleverdatumSet,
      spoed: match.spoed,
    },
  }
}
