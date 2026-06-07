// Klant-matching voor Shopify B2B orders → debiteuren.debiteur_nr.
//
// Strategie (eerste hit wint):
//   1. Expliciete debiteur_nr in order.note_attributes (naam="Debiteur" of "debiteur_nr")
//   2. Regex op order.note: "debiteur: 1234" / "deb: 1234" / "debiteurnummer 1234"
//   3. Regex op customer.note: zelfde patroon
//   4. Customer tag: "deb-1234" of "debiteur-1234"
//   5. Shopify B2B: order.company.name → debiteuren.naam (exact, dan ilike)
//   6. billing_address.company → debiteuren.naam (exact, dan ilike)
//   7. Klant-email → debiteuren.email_factuur / email_overig / email_2
//   8. Env-var SHOPIFY_FALLBACK_DEBITEUR_NR → altijd aanwezig als catch-all
//
// Geeft null terug als geen van de strategieën lukt én er geen fallback is.
//
// Gebruikt de gedeelde matcher-seam (_shared/debiteur-matcher.ts) voor
// normalisatie en het "actieve debiteur"-filter. De `zeker`-vlag op het
// resultaat is false voor fuzzy strategieën (naam-deelmatch/email) zodat een
// latere "te koppelen"-flow ze kan onderscheiden van harde treffers.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ShopifyOrderWebhook } from './shopify-types.ts'
import {
  ACTIEF_OR_FILTER,
  type DebiteurMatchBron,
  matchDebiteurViaEnv,
  normaliseerNaam,
} from './debiteur-matcher.ts'

export type { DebiteurMatchBron }

export interface DebiteurMatchResult {
  debiteur_nr: number
  bron: DebiteurMatchBron
  bedrijfsnaam?: string
  /** false = fuzzy strategie zonder uniekheids-garantie (naam/email) →
   *  handmatige bevestiging wenselijk. Expliciet nummer = altijd true. */
  zeker: boolean
}

const DEBITEUR_NR_PATROON = /(?:debiteur(?:nummer)?|deb(?:\.?nr\.?)?)[:\s#\-]*(\d{4,6})/i

function extractDebiteurNrUitTekst(tekst: string | null | undefined): number | null {
  if (!tekst) return null
  const m = tekst.match(DEBITEUR_NR_PATROON)
  return m ? parseInt(m[1], 10) : null
}

async function zoekDebiteurOpNummer(
  supabase: SupabaseClient,
  nr: number,
): Promise<boolean> {
  const { data } = await supabase
    .from('debiteuren')
    .select('debiteur_nr')
    .eq('debiteur_nr', nr)
    .or(ACTIEF_OR_FILTER)
    .limit(1)
  return (data?.length ?? 0) > 0
}

/** Bedrijfsnaam-treffer. `exact=true` bij een volledige (case-insensitive)
 *  naam-match → zeker; `exact=false` bij een unieke deelmatch → fuzzy. */
type BedrijfsnaamTreffer = { nr: number; exact: boolean }

async function zoekDebiteurOpBedrijfsnaam(
  supabase: SupabaseClient,
  naam: string,
): Promise<BedrijfsnaamTreffer | null> {
  const normNaam = normaliseerNaam(naam)
  if (!normNaam) return null

  // Exacte case-insensitive match
  const { data: exact } = await supabase
    .from('debiteuren')
    .select('debiteur_nr')
    .ilike('naam', naam)
    .or(ACTIEF_OR_FILTER)
    .limit(1)
  if (exact && exact.length === 1) return { nr: exact[0].debiteur_nr, exact: true }

  // Partial match: naam bevat bedrijfsnaam of andersom (uniekheids-gate: >1 = geen match)
  const { data: partial } = await supabase
    .from('debiteuren')
    .select('debiteur_nr, naam')
    .ilike('naam', `%${naam}%`)
    .or(ACTIEF_OR_FILTER)
    .limit(2)
  if (partial && partial.length === 1) return { nr: partial[0].debiteur_nr, exact: false }

  return null
}

async function zoekDebiteurOpEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<number | null> {
  if (!email) return null
  // debiteuren heeft drie e-mailkolommen (geen losse `email`-kolom).
  const { data } = await supabase
    .from('debiteuren')
    .select('debiteur_nr')
    .or(`email_factuur.ilike.${email},email_overig.ilike.${email},email_2.ilike.${email}`)
    .or(ACTIEF_OR_FILTER)
    .limit(1)
  return data && data.length === 1 ? data[0].debiteur_nr : null
}

export async function matchDebiteur(
  supabase: SupabaseClient,
  order: ShopifyOrderWebhook,
): Promise<DebiteurMatchResult | null> {

  // 1. note_attributes (meest expliciet — operator heeft dit ingevuld)
  for (const attr of order.note_attributes ?? []) {
    if (/debiteur|deb[_\s]?nr/i.test(attr.name)) {
      const nr = parseInt(attr.value, 10)
      if (!isNaN(nr) && nr > 0) {
        const bestaat = await zoekDebiteurOpNummer(supabase, nr)
        if (bestaat) return { debiteur_nr: nr, bron: 'note_attribute', zeker: true }
      }
    }
  }

  // 2. order.note
  const nrUitNote = extractDebiteurNrUitTekst(order.note)
  if (nrUitNote) {
    const bestaat = await zoekDebiteurOpNummer(supabase, nrUitNote)
    if (bestaat) return { debiteur_nr: nrUitNote, bron: 'order_note', zeker: true }
  }

  // 3. customer.note
  const nrUitKlantNote = extractDebiteurNrUitTekst(order.customer?.note)
  if (nrUitKlantNote) {
    const bestaat = await zoekDebiteurOpNummer(supabase, nrUitKlantNote)
    if (bestaat) return { debiteur_nr: nrUitKlantNote, bron: 'customer_note', zeker: true }
  }

  // 4. customer tags ("deb-1234", "debiteur-1234", "deb:1234", "customer_ID: 1234")
  const tags = (order.customer?.tags ?? '').split(',').map(t => t.trim())
  for (const tag of tags) {
    const m =
      tag.match(/^(?:deb|debiteur)[:\-](\d{4,6})$/i) ??
      tag.match(/^customer_id[:\s]+(\d{4,6})$/i)
    if (m) {
      const nr = parseInt(m[1], 10)
      const bestaat = await zoekDebiteurOpNummer(supabase, nr)
      if (bestaat) return { debiteur_nr: nr, bron: 'customer_tag', zeker: true }
    }
  }

  // 5. Shopify B2B company name (exact = zeker; deelmatch = fuzzy)
  const companyNaam = order.company?.name
  if (companyNaam) {
    const treffer = await zoekDebiteurOpBedrijfsnaam(supabase, companyNaam)
    if (treffer) {
      return {
        debiteur_nr: treffer.nr,
        bron: treffer.exact ? 'company_name_exact' : 'company_name_ilike',
        bedrijfsnaam: companyNaam,
        zeker: treffer.exact,
      }
    }
  }

  // 6. billing_address.company (exact = zeker; deelmatch = fuzzy)
  const billingBedrijf = order.billing_address?.company
  if (billingBedrijf) {
    const treffer = await zoekDebiteurOpBedrijfsnaam(supabase, billingBedrijf)
    if (treffer) {
      return {
        debiteur_nr: treffer.nr,
        bron: treffer.exact ? 'billing_company_exact' : 'billing_company_ilike',
        bedrijfsnaam: billingBedrijf,
        zeker: treffer.exact,
      }
    }
  }

  // 7. Email (fuzzy → niet zeker)
  const email = order.email ?? order.customer?.email ?? null
  if (email) {
    const nr = await zoekDebiteurOpEmail(supabase, email)
    if (nr) return { debiteur_nr: nr, bron: 'email', zeker: false }
  }

  // 8. Fallback debiteur (catch-all voor onbekende klanten) — via gedeelde env-ladder
  const fallback = matchDebiteurViaEnv('SHOPIFY_FALLBACK_DEBITEUR_NR')
  if (fallback) {
    return { debiteur_nr: fallback.debiteur_nr!, bron: fallback.bron, zeker: fallback.zeker }
  }

  return null
}
