// Klant-matching voor Shopify B2B orders → debiteuren.debiteur_nr.
//
// Strategie (eerste hit wint):
//   1. Expliciete debiteur_nr in order.note_attributes (naam="Debiteur" of "debiteur_nr")
//   2. Regex op order.note: "debiteur: 1234" / "deb: 1234" / "debiteurnummer 1234"
//   3. Regex op customer.note: zelfde patroon
//   4. Customer tag: "deb-1234" of "debiteur-1234"
//   5. Shopify B2B: order.company.name → debiteuren.naam (exact, dan ilike)
//   6. billing_address.company → debiteuren.naam (exact, dan ilike)
//   7. Klant-email → debiteuren.email_factuur of debiteuren.email
//   8. Env-var SHOPIFY_FALLBACK_DEBITEUR_NR → altijd aanwezig als catch-all
//
// Geeft null terug als geen van de strategieën lukt én er geen fallback is.

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { ShopifyOrderWebhook } from './shopify-types.ts'

export interface DebiteurMatchResult {
  debiteur_nr: number
  bron: DebiteurMatchBron
  bedrijfsnaam?: string
}

export type DebiteurMatchBron =
  | 'note_attribute'
  | 'order_note'
  | 'customer_note'
  | 'customer_tag'
  | 'company_name_exact'
  | 'company_name_ilike'
  | 'billing_company_exact'
  | 'billing_company_ilike'
  | 'email'
  | 'fallback'

const DEBITEUR_NR_PATROON = /(?:debiteur(?:nummer)?|deb(?:\.?nr\.?)?)[:\s#\-]*(\d{4,6})/i

function extractDebiteurNrUitTekst(tekst: string | null | undefined): number | null {
  if (!tekst) return null
  const m = tekst.match(DEBITEUR_NR_PATROON)
  return m ? parseInt(m[1], 10) : null
}

function normaliseerNaam(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

async function zoekDebiteurOpNummer(
  supabase: SupabaseClient,
  nr: number,
): Promise<boolean> {
  const { data } = await supabase
    .from('debiteuren')
    .select('debiteur_nr')
    .eq('debiteur_nr', nr)
    .eq('actief', true)
    .limit(1)
  return (data?.length ?? 0) > 0
}

async function zoekDebiteurOpBedrijfsnaam(
  supabase: SupabaseClient,
  naam: string,
): Promise<number | null> {
  const normNaam = normaliseerNaam(naam)
  if (!normNaam) return null

  // Exacte case-insensitive match
  const { data: exact } = await supabase
    .from('debiteuren')
    .select('debiteur_nr')
    .ilike('naam', naam)
    .eq('actief', true)
    .limit(1)
  if (exact && exact.length === 1) return exact[0].debiteur_nr

  // Partial match: naam bevat bedrijfsnaam of andersom
  const { data: partial } = await supabase
    .from('debiteuren')
    .select('debiteur_nr, naam')
    .ilike('naam', `%${naam}%`)
    .eq('actief', true)
    .limit(2)
  if (partial && partial.length === 1) return partial[0].debiteur_nr

  return null
}

async function zoekDebiteurOpEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<number | null> {
  if (!email) return null
  const { data } = await supabase
    .from('debiteuren')
    .select('debiteur_nr')
    .or(`email_factuur.ilike.${email},email.ilike.${email}`)
    .eq('actief', true)
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
        if (bestaat) return { debiteur_nr: nr, bron: 'note_attribute' }
      }
    }
  }

  // 2. order.note
  const nrUitNote = extractDebiteurNrUitTekst(order.note)
  if (nrUitNote) {
    const bestaat = await zoekDebiteurOpNummer(supabase, nrUitNote)
    if (bestaat) return { debiteur_nr: nrUitNote, bron: 'order_note' }
  }

  // 3. customer.note
  const nrUitKlantNote = extractDebiteurNrUitTekst(order.customer?.note)
  if (nrUitKlantNote) {
    const bestaat = await zoekDebiteurOpNummer(supabase, nrUitKlantNote)
    if (bestaat) return { debiteur_nr: nrUitKlantNote, bron: 'customer_note' }
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
      if (bestaat) return { debiteur_nr: nr, bron: 'customer_tag' }
    }
  }

  // 5. Shopify B2B company name
  const companyNaam = order.company?.name
  if (companyNaam) {
    const nr = await zoekDebiteurOpBedrijfsnaam(supabase, companyNaam)
    if (nr) {
      return {
        debiteur_nr: nr,
        bron: 'company_name_exact',
        bedrijfsnaam: companyNaam,
      }
    }
  }

  // 6. billing_address.company
  const billingBedrijf = order.billing_address?.company
  if (billingBedrijf) {
    const nr = await zoekDebiteurOpBedrijfsnaam(supabase, billingBedrijf)
    if (nr) {
      return {
        debiteur_nr: nr,
        bron: 'billing_company_exact',
        bedrijfsnaam: billingBedrijf,
      }
    }
  }

  // 7. Email
  const email = order.email ?? order.customer?.email ?? null
  if (email) {
    const nr = await zoekDebiteurOpEmail(supabase, email)
    if (nr) return { debiteur_nr: nr, bron: 'email' }
  }

  // 8. Fallback debiteur (catch-all voor onbekende klanten)
  const fallback = parseInt(Deno.env.get('SHOPIFY_FALLBACK_DEBITEUR_NR') ?? '', 10)
  if (!isNaN(fallback) && fallback > 0) {
    return { debiteur_nr: fallback, bron: 'fallback' }
  }

  return null
}
