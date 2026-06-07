// Deno unit tests voor shopify-debiteur-matcher.ts.
// Lockt Bevinding C-fix vast: de matcher bevraagt nu de bestaande kolommen
// (status via ACTIEF_OR_FILTER, email_factuur/_overig/_2) i.p.v. de
// niet-bestaande `actief`/`email`-kolommen die stil faalden.

import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { matchDebiteur } from './shopify-debiteur-matcher.ts'
import { ACTIEF_OR_FILTER } from './debiteur-matcher.ts'
import type { ShopifyOrderWebhook } from './shopify-types.ts'

type Op = { op: string; args: unknown[] }
type Calls = { table: string; ops: Op[] }[]

// deno-lint-ignore no-explicit-any
function mockSupabase(rowsFor: (c: { table: string; ops: Op[] }) => any[]) {
  const calls: Calls = []
  function builder(table: string) {
    const ops: Op[] = []
    calls.push({ table, ops })
    // deno-lint-ignore no-explicit-any
    const b: any = {}
    const chain = (op: string) => (...args: unknown[]) => {
      ops.push({ op, args })
      return b
    }
    for (const m of ['select', 'eq', 'neq', 'in', 'or', 'ilike', 'order', 'limit']) b[m] = chain(m)
    const rows = () => rowsFor({ table, ops })
    b.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
    b.then = (resolve: (v: unknown) => void) => resolve({ data: rows(), error: null })
    return b
  }
  return { client: { from: (table: string) => builder(table) }, calls }
}

/** Verzamel alle .or()-argumenten over alle debiteuren-queries. */
function alleOrArgs(calls: Calls): string[] {
  const out: string[] = []
  for (const c of calls) {
    for (const o of c.ops) {
      if (o.op === 'or') out.push(String(o.args[0]))
    }
  }
  return out
}

function order(partial: Partial<ShopifyOrderWebhook>): ShopifyOrderWebhook {
  return partial as ShopifyOrderWebhook
}

// ===========================================================================
Deno.test('Shopify: expliciet debiteur_nr in note_attribute → zeker:true + ACTIEF_OR_FILTER', async () => {
  const { client, calls } = mockSupabase(({ table, ops }) => {
    // zoekDebiteurOpNummer: .eq('debiteur_nr', 1234)
    const eq = ops.find((o) => o.op === 'eq' && o.args[0] === 'debiteur_nr')
    if (table === 'debiteuren' && eq) return [{ debiteur_nr: 1234 }]
    return []
  })

  const m = await matchDebiteur(
    client as never,
    order({ note_attributes: [{ name: 'Debiteur', value: '1234' }] }),
  )
  assertEquals(m, { debiteur_nr: 1234, bron: 'note_attribute', zeker: true })
  // Bevinding C: filtert op status (ACTIEF_OR_FILTER), NIET op de niet-bestaande
  // `actief`-kolom.
  assert(alleOrArgs(calls).includes(ACTIEF_OR_FILTER), 'verwacht ACTIEF_OR_FILTER op debiteuren-query')
})

// ===========================================================================
Deno.test('Shopify: email-match bevraagt email_factuur/_overig/_2 (geen `email`-kolom)', async () => {
  const { client, calls } = mockSupabase(({ table, ops }) => {
    const orEmail = ops.find((o) => o.op === 'or' && String(o.args[0]).includes('email_factuur'))
    if (table === 'debiteuren' && orEmail) return [{ debiteur_nr: 555 }]
    return []
  })

  const m = await matchDebiteur(client as never, order({ email: 'klant@voorbeeld.nl' }))
  assertEquals(m?.debiteur_nr, 555)
  assertEquals(m?.bron, 'email')
  assertEquals(m?.zeker, false) // fuzzy → niet zeker

  const emailOr = alleOrArgs(calls).find((a) => a.includes('email_factuur'))
  assert(emailOr, 'verwacht een email-or-filter')
  assert(emailOr!.includes('email_factuur.ilike'))
  assert(emailOr!.includes('email_overig.ilike'))
  assert(emailOr!.includes('email_2.ilike'))
  // mag NIET de losse niet-bestaande `email`-kolom bevatten
  assert(!/(^|,)email\.ilike/.test(emailOr!), '`email`-kolom (zonder suffix) mag niet bevraagd worden')
})

// ===========================================================================
Deno.test('Shopify: exacte bedrijfsnaam → company_name_exact, zeker:true', async () => {
  const { client } = mockSupabase(({ table, ops }) => {
    if (table !== 'debiteuren') return []
    const ilike = ops.find((o) => o.op === 'ilike')
    // exacte query gebruikt naam zonder %-wildcards
    if (ilike && ilike.args[0] === 'naam' && ilike.args[1] === 'ACME TAPIJT') {
      return [{ debiteur_nr: 700 }]
    }
    return []
  })

  const m = await matchDebiteur(client as never, order({ company: { name: 'ACME TAPIJT' } }))
  assertEquals(m, { debiteur_nr: 700, bron: 'company_name_exact', bedrijfsnaam: 'ACME TAPIJT', zeker: true })
})

// ===========================================================================
Deno.test('Shopify: unieke deelmatch bedrijfsnaam → company_name_ilike, zeker:false', async () => {
  const { client } = mockSupabase(({ table, ops }) => {
    if (table !== 'debiteuren') return []
    const ilike = ops.find((o) => o.op === 'ilike')
    // alleen de partial query (%...%) levert één hit, de exacte niet
    if (ilike && ilike.args[0] === 'naam' && String(ilike.args[1]).startsWith('%')) {
      return [{ debiteur_nr: 800, naam: 'ACME TAPIJT GROOTHANDEL' }]
    }
    return []
  })

  const m = await matchDebiteur(client as never, order({ company: { name: 'ACME' } }))
  assertEquals(m?.debiteur_nr, 800)
  assertEquals(m?.bron, 'company_name_ilike')
  assertEquals(m?.zeker, false)
})

// ===========================================================================
Deno.test('Shopify: geen match + env-fallback → env_fallback, zeker:false', async () => {
  Deno.env.set('SHOPIFY_FALLBACK_DEBITEUR_NR', '99999')
  const { client } = mockSupabase(() => [])
  const m = await matchDebiteur(client as never, order({ email: 'onbekend@x.nl' }))
  assertEquals(m, { debiteur_nr: 99999, bron: 'env_fallback', zeker: false })
  Deno.env.delete('SHOPIFY_FALLBACK_DEBITEUR_NR')
})

// ===========================================================================
Deno.test('Shopify: geen match + geen fallback → null', async () => {
  Deno.env.delete('SHOPIFY_FALLBACK_DEBITEUR_NR')
  const { client } = mockSupabase(() => [])
  const m = await matchDebiteur(client as never, order({ email: 'onbekend@x.nl' }))
  assertEquals(m, null)
})
