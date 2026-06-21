// supabase/functions/_shared/btw.ts
// Eén bron-van-waarheid voor het effectieve BTW-percentage van een debiteur.
// Spiegelt de SQL-helper `effectief_btw_pct` (mig 371) — seam-patroon zoals
// _shared/debiteur-matcher.ts. De verlegd-vlag (intracommunautaire B2B-levering)
// wint altijd van het per-debiteur percentage; `btw_percentage` blijft het
// NL-tarief en wordt bij verlegd genegeerd.

export interface BtwDebiteur {
  btw_verlegd_intracom?: boolean | null
  btw_percentage?: number | string | null
}

export function isBtwVerlegd(deb: BtwDebiteur | null | undefined): boolean {
  return deb?.btw_verlegd_intracom === true
}

export function effectiefBtwPct(deb: BtwDebiteur | null | undefined): number {
  if (isBtwVerlegd(deb)) return 0
  if (deb?.btw_percentage == null) return 21
  // Number('') is 0, niet NaN — lege string mag nooit stil 0% opleveren.
  if (typeof deb.btw_percentage === 'string' && deb.btw_percentage.trim() === '') return 21
  const pct = Number(deb.btw_percentage)
  return Number.isFinite(pct) ? pct : 21
}

// ============================================================================
// Mig 454/455/456: BTW-regeling per order — land + verlegd-vlag + btw-nummer.
// Spiegelt is_eu_land + bepaal_btw_regeling (SQL). Seam-patroon zoals
// _shared/debiteur-matcher.ts. Input-land moet al genormaliseerd zijn naar
// ISO-2 (normalizeCountry/landNaarIso2Strikt uit adres-split.ts) — deze module
// importeert die zelf niet (geen cross-afhankelijkheid binnen _shared nodig;
// callers normaliseren vóór aanroep, zelfde patroon als de SQL-kant die
// normaliseer_land los aanroept vóór is_eu_land).
// ============================================================================

const EU_LIDSTATEN = new Set([
  'NL', 'BE', 'DE', 'FR', 'LU', 'AT', 'IT', 'ES', 'PL', 'CZ', 'DK', 'SE', 'FI',
  'IE', 'PT', 'SK', 'HU', 'GR', 'SI', 'EE', 'LV', 'LT', 'BG', 'RO', 'HR', 'CY', 'MT',
])

/** Spiegelt is_eu_land (mig 454). Input moet al ISO-2 zijn. CH/NO/GB bewust non-EU. */
export function isEuLand(iso2: string | null | undefined): boolean {
  if (!iso2) return false
  return EU_LIDSTATEN.has(iso2.toUpperCase())
}

export type BtwRegeling =
  | 'nl_binnenland'
  | 'eu_b2b_icl'
  | 'eu_b2b_binnenland_afwijking'
  | 'export_buiten_eu'

export interface BtwRegelingResultaat {
  regeling: BtwRegeling
  effectiefPct: number
  controleNodig: boolean
  controleReden: string | null
  landIso2: string | null
}

export interface BtwRegelingInput {
  /** orders.afl_land, al genormaliseerd naar ISO-2 (of null/leeg). */
  aflLandIso2?: string | null
  /** debiteuren.land, al genormaliseerd naar ISO-2 (of null/leeg) — fallback. */
  debiteurLandIso2?: string | null
  afhalen?: boolean | null
  verlegdVlag?: boolean | null
  btwNummer?: string | null
  btwPercentage?: number | string | null
}

/**
 * Spiegelt bepaal_btw_regeling (mig 455) één-op-één. Gebruikt voor live
 * UI-feedback (bv. een "verwachte regeling"-indicatie) zonder DB-round-trip —
 * de SQL-functie blijft de bron van waarheid voor de daadwerkelijke
 * factuur-aanmaak (mig 456: projecteer_concept_factuur e.a.).
 *
 * KRITIEK (zie mig 455-toelichting): geen land bekend (afl_land + debiteur.land
 * beide leeg) → 'nl_binnenland', GEEN blokkade. 62% van de actieve debiteuren
 * heeft een leeg land-veld (legacy NL-klanten) — een blokkerende 'onbepaald'-
 * regeling zou de meerderheid van alle nieuwe facturen tegenhouden.
 */
export function bepaalBtwRegeling(input: BtwRegelingInput): BtwRegelingResultaat {
  const iso2raw = input.afhalen
    ? input.debiteurLandIso2
    : (input.aflLandIso2 || input.debiteurLandIso2)
  const iso2 = iso2raw && iso2raw.trim() !== '' ? iso2raw.trim().toUpperCase() : null

  const nlOfOnbekendPct = effectiefBtwPct({
    btw_verlegd_intracom: input.verlegdVlag,
    btw_percentage: input.btwPercentage,
  })

  // Geen land bekend, of land = NL: bestaand gedrag, geen controle.
  if (!iso2 || iso2 === 'NL') {
    return {
      regeling: 'nl_binnenland',
      effectiefPct: nlOfOnbekendPct,
      controleNodig: false,
      controleReden: null,
      landIso2: iso2,
    }
  }

  if (isEuLand(iso2)) {
    if (input.verlegdVlag === true) {
      const geenBtwNr = !input.btwNummer || input.btwNummer.trim() === ''
      return {
        regeling: 'eu_b2b_icl',
        effectiefPct: 0,
        controleNodig: geenBtwNr,
        controleReden: geenBtwNr
          ? 'EU-intracommunautaire levering zonder btw-nummer bij de afnemer — controleer voor de ICP-opgave.'
          : null,
        landIso2: iso2,
      }
    }
    return {
      regeling: 'eu_b2b_binnenland_afwijking',
      effectiefPct: nlOfOnbekendPct,
      controleNodig: true,
      controleReden: `Afleverland (${iso2}) is een andere EU-lidstaat dan NL, maar deze klant staat niet op "BTW verlegd". Controleer of dit een eenmalige afwijking is of dat de klant-instelling aangepast moet worden.`,
      landIso2: iso2,
    }
  }

  return {
    regeling: 'export_buiten_eu',
    effectiefPct: 0,
    controleNodig: true,
    controleReden: `Afleverland (${iso2}) ligt buiten de EU — exportlevering, in principe 0% BTW mits exportbewijs. Controleer en bevestig.`,
    landIso2: iso2,
  }
}

/** Regelingen die de factuur-RPC's hard blokkeren (mig 456). Spiegelt de SQL-conditie. */
export const HARD_BLOCK_REGELINGEN: ReadonlySet<BtwRegeling> = new Set([
  'eu_b2b_binnenland_afwijking',
  'export_buiten_eu',
])
