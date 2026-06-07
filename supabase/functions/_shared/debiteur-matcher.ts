// Gedeelde debiteur-matching-seam over alle inbound-kanalen (EDI, Shopify,
// e-mail, webshop/Lightspeed). Vervangt vijf losse, ongedeelde implementaties
// met één gedeelde set bouwstenen + één uitkomst-semantiek. Spiegelt het
// patroon van product-matcher.ts (MatchBron-enum + result-interface).
//
// Beslissingen (2026-06-07 — zie
// docs/superpowers/plans/2026-06-07-gedeelde-debiteur-matcher-seam.md):
//   1. isActieveDebiteur = status <> 'Inactief'  → NULL-status doet WÉL mee.
//      Bewust niet .neq('status','Inactief'): dat sluit NULL-rijen uit.
//   2. Uniekheids-gate (zeker:false) alleen op fuzzy strategieën (naam/email).
//      GLN / expliciet debiteur_nr / BTW zijn per definitie uniek → zeker:true.
//   3. TS-module als seam; payload-parsing (GLN-velden, Shopify-webhook) blijft
//      per kanaal in de eigen edge function — alleen bouwstenen + uitkomst delen.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type DebiteurMatchBron =
  // EDI (GLN-ladder)
  | 'gln_afleveradres'
  | 'gln_bedrijf'
  | 'gln_alias'
  // Shopify expliciet (operator/klant heeft debiteur_nr ingevuld)
  | 'note_attribute'
  | 'order_note'
  | 'customer_note'
  | 'customer_tag'
  // Generiek B2B (fuzzy → uniekheids-gate)
  | 'company_name_exact'
  | 'company_name_ilike'
  | 'billing_company_exact'
  | 'billing_company_ilike'
  | 'bedrijfsnaam'
  | 'email'
  | 'btw_nummer'
  // Vangnet
  | 'env_fallback'
  | 'geen'

export interface DebiteurMatch {
  debiteur_nr: number | null
  bron: DebiteurMatchBron
  /**
   * false = de uniekheids-gate is niet gehaald (>1 kandidaat) óf het is een
   * fuzzy strategie zonder harde garantie → handmatige bevestiging gewenst.
   * GLN / expliciet nummer / BTW geven altijd zeker:true.
   */
  zeker: boolean
}

// ===========================================================================
// Gedeelde bouwstenen — één implementatie, getest. Hergebruikt door alle ladders.
// ===========================================================================

/** Strip diacritics, lowercase, trim. "Brüssel" → "brussel". Identiek aan de
 *  versie in product-matcher.ts (die importeert deze nu). */
export function normaliseerNaam(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** GLN-varianten die het ".0"-Excel-import-artefact tolereren (matcht `gln` én
 *  `gln.0`). Lege/ontbrekende GLN → lege lijst (caller slaat de stap over). */
export function glnVarianten(gln: string | null | undefined): string[] {
  if (!gln) return []
  return [gln, `${gln}.0`]
}

/** Eén definitie van "actieve debiteur": alles behalve expliciet 'Inactief'
 *  (NULL doet mee). In-memory variant van ACTIEF_OR_FILTER. */
export function isActieveDebiteur(status: string | null | undefined): boolean {
  return status !== 'Inactief'
}

/**
 * PostgREST .or()-argument equivalent van isActieveDebiteur:
 * `status <> 'Inactief'  OR  status IS NULL`.
 * Gebruik als `.or(ACTIEF_OR_FILTER)` op een debiteuren-query. Bewust niet
 * `.neq('status','Inactief')` — dat sluit NULL-status-rijen uit, wat hier
 * juist niet gewenst is. Twee `.or()`-calls op één query worden door PostgREST
 * geAND, dus combineren met een ander `.or()` (bv. email) blijft correct.
 */
export const ACTIEF_OR_FILTER = 'status.is.null,status.neq.Inactief'

/**
 * Triviale env-ladder: lees een vaste debiteur uit een env-var. Bedient de
 * kanalen die (nog) geen echte matching doen maar altijd op één vaste
 * (verzamel)debiteur landen — Floorpassion-webshop/Lightspeed via
 * FLOORPASSION_DEBITEUR_NR, Shopify-catch-all via SHOPIFY_FALLBACK_DEBITEUR_NR.
 *
 * Geeft `bron:'env_fallback', zeker:false` terug: het is een bewuste
 * eindbestemming, geen harde klant-treffer. `zeker:false` markeert dat er geen
 * échte identificatie plaatsvond — maar voor consumenten-webshops (wisselend
 * afleveradres, vaste verzameldebiteur) is dit het verwáchte resultaat, dus de
 * "debiteur te bevestigen"-flow (mig 322) sluit `env_fallback` bewust uit.
 *
 * Returnt `null` als de env-var ontbreekt/ongeldig is, zodat de caller zelf kan
 * beslissen of dat een harde configuratiefout is (HTTP 500) of een doorval.
 *
 * Géén gedragswijziging t.o.v. de oude inline `parseInt(Deno.env.get(...))` —
 * alleen het contract uniformeren zodat een toekomstige échte Floorpassion-B2B-
 * matching achter dezelfde DebiteurMatch-ladder kan zonder nieuw code-pad.
 */
export function matchDebiteurViaEnv(envKey: string): DebiteurMatch | null {
  const nr = parseInt(Deno.env.get(envKey) ?? '', 10)
  if (isNaN(nr) || nr <= 0) return null
  return { debiteur_nr: nr, bron: 'env_fallback', zeker: false }
}

// ===========================================================================
// Gedeelde strategie-primitieven (kanaal-overstijgend)
// ===========================================================================

/**
 * EDI GLN-ladder (meest-specifiek eerst). Eén plek bepaalt hoe een GLN naar een
 * debiteur leidt; GLN-hits zijn per definitie uniek → zeker:true.
 *   1+2. aflever- & besteller-GLN → afleveradressen.gln_afleveradres
 *   3+4. besteller- & gefactureerd-GLN → debiteuren.gln_bedrijf (inactieve overslaan)
 *   5.   besteller/gefactureerd-GLN → debiteur_gln_aliassen.gln (centrale facturatie)
 *
 * De inactieve-skip (stap 3+4) bedient o.a. Hornbach: de inactieve hoofd-AG
 * (361214) wordt overgeslagen zodat de order op de actieve NL-debiteur (361208)
 * landt. NULL-status-debiteuren matchen sinds 2026-06-07 wél mee (beslissing 1).
 */
export async function matchDebiteurOpGln(
  supabase: SupabaseClient,
  glns: { aflever: string | null; besteller: string | null; gefactureerd: string | null },
): Promise<DebiteurMatch | null> {
  const { aflever, besteller, gefactureerd } = glns

  // 1+2: aflever- en besteller-GLN → specifiek afleveradres (vestiging)
  for (const gln of [aflever, besteller]) {
    const vs = glnVarianten(gln)
    if (vs.length === 0) continue
    const { data } = await supabase
      .from('afleveradressen')
      .select('debiteur_nr')
      .in('gln_afleveradres', vs)
      .order('debiteur_nr')
      .limit(1)
      .maybeSingle()
    if (data?.debiteur_nr) {
      return { debiteur_nr: data.debiteur_nr, bron: 'gln_afleveradres', zeker: true }
    }
  }

  // 3+4: besteller- en gefactureerd-GLN → debiteur zelf (inactieve overslaan)
  for (const gln of [besteller, gefactureerd]) {
    const vs = glnVarianten(gln)
    if (vs.length === 0) continue
    const { data } = await supabase
      .from('debiteuren')
      .select('debiteur_nr')
      .in('gln_bedrijf', vs)
      .or(ACTIEF_OR_FILTER)
      .order('debiteur_nr')
      .limit(1)
      .maybeSingle()
    if (data?.debiteur_nr) {
      return { debiteur_nr: data.debiteur_nr, bron: 'gln_bedrijf', zeker: true }
    }
  }

  // 5: besteller/gefactureerd-GLN → debiteur-alias (extra factuur-entiteiten)
  for (const gln of [besteller, gefactureerd]) {
    const vs = glnVarianten(gln)
    if (vs.length === 0) continue
    const { data } = await supabase
      .from('debiteur_gln_aliassen')
      .select('debiteur_nr')
      .in('gln', vs)
      .order('debiteur_nr')
      .limit(1)
      .maybeSingle()
    if (data?.debiteur_nr) {
      return { debiteur_nr: data.debiteur_nr, bron: 'gln_alias', zeker: true }
    }
  }

  return null
}
