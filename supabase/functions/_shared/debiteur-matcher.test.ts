// Deno unit tests voor debiteur-matcher.ts (gedeelde debiteur-matching-seam).

import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  normaliseerNaam,
  glnVarianten,
  isActieveDebiteur,
  ACTIEF_OR_FILTER,
  matchDebiteurOpGln,
  matchDebiteurViaEnv,
} from './debiteur-matcher.ts'

// ---------------------------------------------------------------------------
// Mini chainable mock voor de PostgREST query-builder. Registreert alle
// .from()/.select()/.eq()/... aanroepen zodat tests kunnen asserten WELKE
// kolommen/filters bevraagd zijn, en levert per tabel rijen terug.
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

function opArgs(calls: Calls, table: string, op: string): unknown[] {
  for (const c of calls) {
    if (c.table !== table) continue
    const found = c.ops.find((o) => o.op === op)
    if (found) return found.args
  }
  return []
}

// ===========================================================================
// normaliseerNaam
// ===========================================================================
Deno.test('normaliseerNaam: strip diacritics + lowercase + trim', () => {
  assertEquals(normaliseerNaam('Brüssel'), 'brussel')
  assertEquals(normaliseerNaam('  ABC Tapijt  '), 'abc tapijt')
  assertEquals(normaliseerNaam('Café'), 'cafe')
  assertEquals(normaliseerNaam(''), '')
})

// ===========================================================================
// glnVarianten — .0-tolerantie
// ===========================================================================
Deno.test('glnVarianten: voegt .0-variant toe', () => {
  assertEquals(glnVarianten('8715954999998'), ['8715954999998', '8715954999998.0'])
})

Deno.test('glnVarianten: leeg/null → lege lijst (stap wordt overgeslagen)', () => {
  assertEquals(glnVarianten(null), [])
  assertEquals(glnVarianten(undefined), [])
  assertEquals(glnVarianten(''), [])
})

// ===========================================================================
// isActieveDebiteur — NULL doet mee, alleen 'Inactief' valt af
// ===========================================================================
Deno.test('isActieveDebiteur: alleen Inactief is false, NULL doet mee', () => {
  assertEquals(isActieveDebiteur('Inactief'), false)
  assertEquals(isActieveDebiteur('Actief'), true)
  assertEquals(isActieveDebiteur(null), true)
  assertEquals(isActieveDebiteur(undefined), true)
  assertEquals(isActieveDebiteur(''), true)
})

Deno.test('ACTIEF_OR_FILTER: bevat NULL-clausule (NULL-status doet mee)', () => {
  assert(ACTIEF_OR_FILTER.includes('status.is.null'))
  assert(ACTIEF_OR_FILTER.includes('status.neq.Inactief'))
})

// ===========================================================================
// matchDebiteurOpGln — GLN-ladder
// ===========================================================================
Deno.test('matchDebiteurOpGln: aflever-GLN → afleveradres, zeker:true', async () => {
  const { client } = mockSupabase(({ table }) =>
    table === 'afleveradressen' ? [{ debiteur_nr: 361208 }] : []
  )
  const m = await matchDebiteurOpGln(client as never, {
    aflever: '8715954000001',
    besteller: null,
    gefactureerd: null,
  })
  assertEquals(m, { debiteur_nr: 361208, bron: 'gln_afleveradres', zeker: true })
})

Deno.test('matchDebiteurOpGln: geen afleveradres → valt door naar gln_bedrijf', async () => {
  const { client, calls } = mockSupabase(({ table }) =>
    table === 'debiteuren' ? [{ debiteur_nr: 361208 }] : []
  )
  const m = await matchDebiteurOpGln(client as never, {
    aflever: null,
    besteller: null,
    gefactureerd: '9007019015989',
  })
  assertEquals(m?.bron, 'gln_bedrijf')
  assertEquals(m?.debiteur_nr, 361208)
  assertEquals(m?.zeker, true)
  // gebruikt het ACTIEF_OR_FILTER (NULL-status doet mee), NIET .neq
  assertEquals(opArgs(calls, 'debiteuren', 'or'), [ACTIEF_OR_FILTER])
  // .0-tolerantie: beide varianten in de .in()-lijst
  assertEquals(opArgs(calls, 'debiteuren', 'in'), [
    'gln_bedrijf',
    ['9007019015989', '9007019015989.0'],
  ])
})

Deno.test('matchDebiteurOpGln: valt door naar debiteur-alias (BDSK-patroon)', async () => {
  const { client } = mockSupabase(({ table }) =>
    table === 'debiteur_gln_aliassen' ? [{ debiteur_nr: 600556 }] : []
  )
  const m = await matchDebiteurOpGln(client as never, {
    aflever: null,
    besteller: '9007019010007',
    gefactureerd: null,
  })
  assertEquals(m, { debiteur_nr: 600556, bron: 'gln_alias', zeker: true })
})

Deno.test('matchDebiteurOpGln: niets gevonden → null', async () => {
  const { client } = mockSupabase(() => [])
  const m = await matchDebiteurOpGln(client as never, {
    aflever: 'X',
    besteller: 'Y',
    gefactureerd: 'Z',
  })
  assertEquals(m, null)
})

// ===========================================================================
// matchDebiteurViaEnv — env-ladder voor vaste (verzamel)debiteur-kanalen
// ===========================================================================
Deno.test('matchDebiteurViaEnv: geldige env → env_fallback, zeker:false', () => {
  Deno.env.set('TEST_DEBITEUR_NR', '91000')
  try {
    assertEquals(matchDebiteurViaEnv('TEST_DEBITEUR_NR'), {
      debiteur_nr: 91000,
      bron: 'env_fallback',
      zeker: false,
    })
  } finally {
    Deno.env.delete('TEST_DEBITEUR_NR')
  }
})

Deno.test('matchDebiteurViaEnv: ontbrekend/ongeldig → null', () => {
  Deno.env.delete('TEST_DEBITEUR_NR')
  assertEquals(matchDebiteurViaEnv('TEST_DEBITEUR_NR'), null)
  Deno.env.set('TEST_DEBITEUR_NR', '0')
  try {
    assertEquals(matchDebiteurViaEnv('TEST_DEBITEUR_NR'), null)
    Deno.env.set('TEST_DEBITEUR_NR', 'abc')
    assertEquals(matchDebiteurViaEnv('TEST_DEBITEUR_NR'), null)
  } finally {
    Deno.env.delete('TEST_DEBITEUR_NR')
  }
})

Deno.test('matchDebiteurOpGln: aflever wint van gefactureerd (volgorde)', async () => {
  // Zowel afleveradres als debiteur matchen — afleveradres (stap 1) moet winnen.
  const { client } = mockSupabase(({ table }) => {
    if (table === 'afleveradressen') return [{ debiteur_nr: 111 }]
    if (table === 'debiteuren') return [{ debiteur_nr: 999 }]
    return []
  })
  const m = await matchDebiteurOpGln(client as never, {
    aflever: 'AFL',
    besteller: null,
    gefactureerd: 'GEF',
  })
  assertEquals(m?.debiteur_nr, 111)
  assertEquals(m?.bron, 'gln_afleveradres')
})
