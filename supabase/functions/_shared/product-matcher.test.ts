// Deno unit tests voor product-matcher.ts (maatwerk-artikelnr-koppeling).
// Run: deno test supabase/functions/_shared/product-matcher.test.ts --no-check
//
// Dekt de fix-package "maatwerk-artikel-koppeling" (2026-06-10):
//   1. vorm-pad koppelt nu het generieke {KWAL}{KLEUR}MAATWERK-artikel
//      (ORD-2026-0118 regel 1+2 landde met artikelnr NULL);
//   2. samengeplakte kwaliteit-kandidaten ("LUXR17") worden gesplitst in
//      kwaliteit + kleur vóór gebruik (ORD-2026-0098 regel 1);
//   3. unsplit-first: de ONgesplitste kwaliteit wordt altijd eerst geprobeerd
//      zodat een legitieme cijfer-eindigende kwaliteit_code (mig 098: WLP1/
//      WLP4) nooit kapotgesplitst wordt — split alleen bij miss.

import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { matchProduct, splitsKwaliteitKleur } from './product-matcher.ts'

// ---------------------------------------------------------------------------
// Mini chainable mock voor de PostgREST query-builder — zelfde patroon als
// debiteur-matcher.test.ts. Registreert alle .from()/.eq()/.ilike()-aanroepen
// zodat tests kunnen asserten WELKE lookups gedaan zijn.
// ---------------------------------------------------------------------------
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

function ilikeArgs(calls: Calls, table: string): unknown[][] {
  const out: unknown[][] = []
  for (const c of calls) {
    if (c.table !== table) continue
    for (const o of c.ops) if (o.op === 'ilike') out.push(o.args)
  }
  return out
}

// Minimale LightspeedOrderRow-fabriek (Shopify-regels lopen via
// shopifyLineItemToMatcherRow door dezelfde shape).
function row(overrides: Record<string, unknown>) {
  return {
    id: 1,
    productTitle: '',
    variantTitle: null,
    articleCode: null,
    sku: null,
    ean: null,
    quantityOrdered: 1,
    priceExcl: 0,
    priceIncl: 0,
    ...overrides,
    // deno-lint-ignore no-explicit-any
  } as any
}

// ===========================================================================
// splitsKwaliteitKleur — pure helper
// ===========================================================================
Deno.test('splitsKwaliteitKleur: plakte code wordt gesplitst, kleur als fallback', () => {
  assertEquals(splitsKwaliteitKleur('LUXR17', null), { kwaliteit: 'LUXR', kleur: '17' })
  // Al bekende kleur wint van de afgesplitste staart
  assertEquals(splitsKwaliteitKleur('LUXR17', '13'), { kwaliteit: 'LUXR', kleur: '13' })
})

Deno.test('splitsKwaliteitKleur: schone codes passeren ongewijzigd', () => {
  assertEquals(splitsKwaliteitKleur('LAGO', '13'), { kwaliteit: 'LAGO', kleur: '13' })
  assertEquals(splitsKwaliteitKleur('LAGO', null), { kwaliteit: 'LAGO', kleur: null })
  assertEquals(splitsKwaliteitKleur(null, '13'), { kwaliteit: null, kleur: '13' })
  // Geen volledige LETTERS+CIJFERS-match → niet aankomen
  assertEquals(splitsKwaliteitKleur('LUXR17XX160230', null), {
    kwaliteit: 'LUXR17XX160230',
    kleur: null,
  })
})

// ===========================================================================
// Vorm-pad — koppelt generiek {KWAL}{KLEUR}MAATWERK-artikel (ORD-2026-0118)
// ===========================================================================
Deno.test('vorm-pad: bestaand maatwerk-artikel → artikelnr gevuld, vorm behouden', async () => {
  const { client, calls } = mockSupabase(({ table, ops }) => {
    if (table === 'klanteigen_namen') return [{ benaming: 'LAGO', kwaliteit_code: 'LAGO' }]
    if (table === 'producten') {
      const il = ops.find((o) => o.op === 'ilike')
      if (il && il.args[1] === 'LAGO13MAATWERK') return [{ artikelnr: '553139998' }]
    }
    return []
  })
  const m = await matchProduct(client as never, row({
    productTitle: 'Lago 13 - Organische vorm',
    variantTitle: '200 x 290 cm',
  }), 260000)

  assertEquals(m.artikelnr, '553139998')
  assertEquals(m.matchedOn, 'maatwerk')
  assertEquals(m.is_maatwerk, true)
  assertEquals(m.maatwerk_kwaliteit_code, 'LAGO')
  assertEquals(m.maatwerk_kleur_code, '13')
  assertEquals(m.maatwerk_vorm, 'organisch_a')
  // De resolver is daadwerkelijk op het generieke artikel uitgevraagd
  assert(ilikeArgs(calls, 'producten').some((a) => a[1] === 'LAGO13MAATWERK'))
})

Deno.test('vorm-pad: geen maatwerk-artikel → artikelnr null (oud gedrag)', async () => {
  const { client } = mockSupabase(({ table }) =>
    table === 'klanteigen_namen' ? [{ benaming: 'LAGO', kwaliteit_code: 'LAGO' }] : []
  )
  const m = await matchProduct(client as never, row({
    productTitle: 'Lago 13 - Organische vorm',
    variantTitle: '200 x 290 cm',
  }), 260000)

  assertEquals(m.artikelnr, null)
  assertEquals(m.matchedOn, 'maatwerk')
  assertEquals(m.is_maatwerk, true)
  assertEquals(m.maatwerk_kwaliteit_code, 'LAGO')
  assertEquals(m.maatwerk_kleur_code, '13')
  assertEquals(m.maatwerk_vorm, 'organisch_a')
})

// ===========================================================================
// LUXR17-case — samengeplakte alias-kwaliteit gesplitst (ORD-2026-0098)
// ===========================================================================
Deno.test('LUXR17: alias-kwaliteit met kleur-staart → LUXR + 17 + resolver-lookup', async () => {
  // Reconstructie van ORD-2026-0098 regel 1: titel zonder bruikbare kleur,
  // alias-tabel levert een samengeplakte code 'LUXR17'. Vóór de fix landde dat
  // record met kwaliteit 'LUXR17' / kleur NULL / artikelnr NULL.
  const { client, calls } = mockSupabase(({ table, ops }) => {
    if (table === 'klanteigen_namen') return [{ benaming: 'Luxury', kwaliteit_code: 'LUXR17' }]
    if (table === 'producten') {
      const il = ops.find((o) => o.op === 'ilike')
      if (il && il.args[1] === 'LUXR17MAATWERK') return [{ artikelnr: '490179999' }]
    }
    return []
  })
  const m = await matchProduct(client as never, row({
    productTitle: 'Luxury taupe',
    variantTitle: 'Wunschgröße',
  }), 661007)

  assertEquals(m.maatwerk_kwaliteit_code, 'LUXR')
  assertEquals(m.maatwerk_kleur_code, '17')
  assertEquals(m.is_maatwerk, true)
  assertEquals(m.matchedOn, 'maatwerk')
  assertEquals(m.artikelnr, '490179999')
  // De resolver is met de GESPLITSTE waarden aangeroepen ({KWAL}{KLEUR}MAATWERK)
  assert(ilikeArgs(calls, 'producten').some((a) => a[1] === 'LUXR17MAATWERK'))
})

Deno.test('LUXR17 zonder bestaand maatwerk-artikel: split blijft, artikelnr null', async () => {
  const { client } = mockSupabase(({ table }) =>
    table === 'klanteigen_namen' ? [{ benaming: 'Luxury', kwaliteit_code: 'LUXR17' }] : []
  )
  const m = await matchProduct(client as never, row({
    productTitle: 'Luxury taupe',
    variantTitle: 'Wunschgröße',
  }), 661007)

  assertEquals(m.maatwerk_kwaliteit_code, 'LUXR')
  assertEquals(m.maatwerk_kleur_code, '17')
  assertEquals(m.artikelnr, null)
})

// ===========================================================================
// Unsplit-first (Fix 4): ongesplitste kwaliteit wint van de split
// ===========================================================================
Deno.test('unsplit-first: WLP1-hit wint — kwaliteit blijft ongesplitst', async () => {
  // Legitieme cijfer-eindigende kwaliteit_code (mig 098 anticipeert WLP1/WLP4):
  // de ongesplitste lookup WLP113MAATWERK moet hitten en de split (WLP + 1 →
  // WLP13MAATWERK) mag dan NIET meer geprobeerd worden.
  const { client, calls } = mockSupabase(({ table, ops }) => {
    if (table === 'klanteigen_namen') return [{ benaming: 'Wool Line', kwaliteit_code: 'WLP1' }]
    if (table === 'producten') {
      const il = ops.find((o) => o.op === 'ilike')
      if (il && il.args[1] === 'WLP113MAATWERK') return [{ artikelnr: '888139998' }]
    }
    return []
  })
  const m = await matchProduct(client as never, row({
    productTitle: 'Wool Line 13',
    variantTitle: 'Op maat',
  }), 260000)

  assertEquals(m.artikelnr, '888139998')
  assertEquals(m.is_maatwerk, true)
  // Kwaliteit blijft de ongesplitste code — split mag een unsplit-hit nooit overschrijven
  assertEquals(m.maatwerk_kwaliteit_code, 'WLP1')
  assertEquals(m.maatwerk_kleur_code, '13')
  const patterns = ilikeArgs(calls, 'producten').map((a) => a[1])
  assert(patterns.includes('WLP113MAATWERK'))
  assert(!patterns.includes('WLP13MAATWERK'), 'split-lookup mag niet draaien na unsplit-hit')
})

Deno.test('unsplit-first: unsplit miss + split hit → gesplitste waarden gebruikt', async () => {
  // Vervuilde alias-code 'LUXR17' met bekende kleur '13' uit de titel:
  // eerst LUXR1713MAATWERK (miss), dan split LUXR + 13 → LUXR13MAATWERK (hit).
  const { client, calls } = mockSupabase(({ table, ops }) => {
    if (table === 'klanteigen_namen') return [{ benaming: 'Luxury', kwaliteit_code: 'LUXR17' }]
    if (table === 'producten') {
      const il = ops.find((o) => o.op === 'ilike')
      if (il && il.args[1] === 'LUXR13MAATWERK') return [{ artikelnr: '490139998' }]
    }
    return []
  })
  const m = await matchProduct(client as never, row({
    productTitle: 'Luxury 13',
    variantTitle: 'Op maat',
  }), 661007)

  assertEquals(m.artikelnr, '490139998')
  assertEquals(m.maatwerk_kwaliteit_code, 'LUXR')
  assertEquals(m.maatwerk_kleur_code, '13')
  const patterns = ilikeArgs(calls, 'producten').map((a) => a[1])
  // Beide lookups gedaan, ongesplitst eerst
  assertEquals(patterns.indexOf('LUXR1713MAATWERK') >= 0, true)
  assertEquals(patterns.indexOf('LUXR13MAATWERK') >= 0, true)
  assert(
    patterns.indexOf('LUXR1713MAATWERK') < patterns.indexOf('LUXR13MAATWERK'),
    'ongesplitste lookup moet vóór de gesplitste draaien',
  )
})

// ===========================================================================
// Contour-vorm (Floorpassion "in Contour Vorm") — ORD-2026-0383
// ===========================================================================
Deno.test('contour-pad: "Contour" in variant → maatwerk-artikel + vorm contour', async () => {
  // Reconstructie ORD-2026-0383 regel 1: "Vernon 13 - Linnen Grey" met variant
  // "Contour / 240 x 340 cm". Vóór de fix → kale [UNMATCHED] (geen vorm bekend,
  // geen alias). Met alias Vernon→VERR moet dit maatwerk VERR/13 worden, vorm
  // 'contour', gekoppeld aan VERR13MAATWERK.
  const { client, calls } = mockSupabase(({ table, ops }) => {
    if (table === 'klanteigen_namen') return [{ benaming: 'Vernon', kwaliteit_code: 'VERR' }]
    if (table === 'producten') {
      const il = ops.find((o) => o.op === 'ilike')
      if (il && il.args[1] === 'VERR13MAATWERK') return [{ artikelnr: '490139999' }]
    }
    return []
  })
  const m = await matchProduct(client as never, row({
    productTitle: 'Vernon 13 - Linnen Grey',
    variantTitle: 'Contour / 240 x 340 cm',
  }), 102019)

  assertEquals(m.artikelnr, '490139999')
  assertEquals(m.matchedOn, 'maatwerk')
  assertEquals(m.is_maatwerk, true)
  assertEquals(m.maatwerk_kwaliteit_code, 'VERR')
  assertEquals(m.maatwerk_kleur_code, '13')
  assertEquals(m.maatwerk_vorm, 'contour')
  // Standaard rechthoek-artikel mag NIET gekozen zijn ondanks passende maat
  assert(ilikeArgs(calls, 'producten').some((a) => a[1] === 'VERR13MAATWERK'))
})

Deno.test('contour-pad: expliciet maatwerk (MAATWERK-sku) behoudt vorm contour', async () => {
  // Een Contour-order die óók een MAATWERK-sku draagt mag de vorm niet verliezen.
  const { client } = mockSupabase(({ table, ops }) => {
    if (table === 'klanteigen_namen') return [{ benaming: 'Vernon', kwaliteit_code: 'VERR' }]
    if (table === 'producten') {
      const il = ops.find((o) => o.op === 'ilike')
      if (il && il.args[1] === 'VERR13MAATWERK') return [{ artikelnr: '490139999' }]
    }
    return []
  })
  const m = await matchProduct(client as never, row({
    productTitle: 'Vernon 13 - Linnen Grey',
    variantTitle: 'Contour / 240 x 340 cm',
    articleCode: 'VERR13MAATWERK',
    sku: 'VERR13MAATWERK',
  }), 102019)

  assertEquals(m.is_maatwerk, true)
  assertEquals(m.maatwerk_vorm, 'contour')
  assertEquals(m.maatwerk_kwaliteit_code, 'VERR')
  assertEquals(m.maatwerk_kleur_code, '13')
})

// ===========================================================================
// Regressie: schoon explicit-maatwerk-pad blijft identiek
// ===========================================================================
Deno.test('explicit maatwerk (Op maat) met schone alias: gedrag ongewijzigd', async () => {
  const { client } = mockSupabase(({ table, ops }) => {
    if (table === 'klanteigen_namen') return [{ benaming: 'LAGO', kwaliteit_code: 'LAGO' }]
    if (table === 'producten') {
      const il = ops.find((o) => o.op === 'ilike')
      if (il && il.args[1] === 'LAGO13MAATWERK') return [{ artikelnr: '553139998' }]
    }
    return []
  })
  const m = await matchProduct(client as never, row({
    productTitle: 'Lago 13',
    variantTitle: 'Op maat',
    articleCode: 'LAGO13MAATWERK',
    sku: 'LAGO13MAATWERK',
  }), 260000)

  assertEquals(m.artikelnr, '553139998')
  assertEquals(m.matchedOn, 'maatwerk')
  assertEquals(m.is_maatwerk, true)
  assertEquals(m.maatwerk_kwaliteit_code, 'LAGO')
  assertEquals(m.maatwerk_kleur_code, '13')
  assertEquals(m.unmatchedReden, 'wunschgrosse')
})
