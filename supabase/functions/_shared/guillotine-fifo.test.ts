// Deno test: `deno test supabase/functions/_shared/guillotine-fifo.test.ts`
// FIFO-magazijnleeftijd-gedrag van packAcrossRolls (ADR-0021).
import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { packAcrossRolls } from './guillotine-packing.ts'
import type { Roll, SnijplanPiece, FifoOptions } from './ffdh-packing.ts'

const VANDAAG = '2026-05-15'

function dagenGeleden(n: number): string {
  const d = new Date(`${VANDAAG}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

function piece(id: number, l: number, b: number, afleverdatum: string | null = null): SnijplanPiece {
  return {
    id, lengte_cm: l, breedte_cm: b, maatwerk_vorm: null,
    order_nr: null, klant_naam: null, afleverdatum, area_cm2: l * b,
    express: false,
  }
}

function roll(id: number, l: number, b: number, leeftijdDagen: number | null, opts: Partial<Roll> = {}): Roll {
  return {
    id, rolnummer: `R${id}`, lengte_cm: l, breedte_cm: b,
    status: 'beschikbaar', oppervlak_m2: (l * b) / 10000,
    sort_priority: 2, is_exact: true,
    in_magazijn_sinds: leeftijdDagen == null ? null : dagenGeleden(leeftijdDagen),
    ...opts,
  }
}

function fifoOpts(over: Partial<FifoOptions> = {}): FifoOptions {
  return {
    modus: 'geavanceerd',
    drempelDagen: 90,
    hardeBovengrensDagen: 180,
    alpha: 0.05,
    vandaag: VANDAAG,
    badgeGeelM2: 5,
    badgeGeelPct: 25,
    badgeRoodM2: 10,
    badgeRoodPct: 50,
    ...over,
  }
}

const vorm = () => new Map<number, string | null>()

// ---------------------------------------------------------------------------
// 1. Short-circuit: alle voorraad vers → grijze badge, 0 extra afval
// ---------------------------------------------------------------------------
Deno.test('FIFO short-circuit: verse voorraad → badge grijs, geen extra afval', () => {
  const pieces = [piece(1, 100, 100)]
  const rollen = [roll(10, 200, 200, 5), roll(11, 400, 400, 30)]

  const res = packAcrossRolls(pieces, rollen, vorm(), { fifo: fifoOpts() })

  assert(res.fifoMetrics, 'fifoMetrics moet gezet zijn')
  assertEquals(res.fifoMetrics!.badge, 'grijs')
  assertEquals(res.fifoMetrics!.extra_afval_m2, 0)
  assertEquals(res.samenvatting.niet_geplaatst, 0)
})

// ---------------------------------------------------------------------------
// 2. Leeftijd-voorrang: oude rol boven harde bovengrens wint van verse
//    perfecte rol, ondanks fors meer snijafval.
// ---------------------------------------------------------------------------
Deno.test('FIFO: rol > harde bovengrens krijgt absolute voorrang', () => {
  const pieces = [piece(1, 100, 100)]
  const vers = roll(10, 100, 100, 2)        // perfecte fit, ~0 afval
  const oud = roll(11, 400, 400, 220)       // 220 dgn > 180 → absolute voorrang
  const rollen = [vers, oud]

  const res = packAcrossRolls(pieces, rollen, vorm(), { fifo: fifoOpts() })

  assertEquals(res.samenvatting.niet_geplaatst, 0)
  assertEquals(res.rollResults.length, 1)
  assertEquals(res.rollResults[0].rol_id, 11, 'de oude rol moet gekozen zijn')
  assert(res.fifoMetrics!.extra_afval_m2 > 0, 'er is extra afval geofferd voor FIFO')
  assertEquals(res.fifoMetrics!.oudste_rol_dagen, 220)
  assert(
    res.fifoMetrics!.rationale.some((r) => r.rol_id === 11),
    'oude rol staat in de rationale',
  )
})

// ---------------------------------------------------------------------------
// 3. C1: een gereserveerde oude rol wordt NIET door FIFO naar voren gehaald.
// ---------------------------------------------------------------------------
Deno.test('FIFO C1: gereserveerde oude rol wordt niet verdrongen', () => {
  const pieces = [piece(1, 100, 100)]
  const vers = roll(10, 120, 120, 1)         // klein, vers
  const oudGereserveerd = roll(11, 400, 400, 220) // oud maar gereserveerd
  const rollen = [vers, oudGereserveerd]

  const res = packAcrossRolls(pieces, rollen, vorm(), {
    fifo: fifoOpts({ gereserveerdeRolIds: new Set([11]) }),
  })

  assertEquals(res.samenvatting.niet_geplaatst, 0)
  // Niet-promotabel → short-circuit (geen promotabele rol > drempel) → grijs
  assertEquals(res.fifoMetrics!.badge, 'grijs')
  assertEquals(res.rollResults[0].rol_id, 10, 'verse rol gekozen, gereserveerde niet verdrongen')
})

// ---------------------------------------------------------------------------
// 4. Regressie: zonder fifo-optie is het gedrag ongewijzigd (geen fifoMetrics).
// ---------------------------------------------------------------------------
Deno.test('FIFO: zonder options.fifo geen gedragsverandering', () => {
  const pieces = [piece(1, 100, 100), piece(2, 150, 120)]
  const rollen = [roll(10, 400, 400, 220), roll(11, 400, 400, 2)]

  const metFifoUit = packAcrossRolls(pieces, rollen, vorm())
  assertEquals(metFifoUit.fifoMetrics, undefined)
  assertEquals(metFifoUit.samenvatting.niet_geplaatst, 0)
})

// ---------------------------------------------------------------------------
// 4b. Modus 'simpel': strikt oudste-eerst, GEEN fifoMetrics (geparkeerd).
// ---------------------------------------------------------------------------
Deno.test("FIFO modus 'simpel': oudste rol eerst, geen badge/metrics", () => {
  const pieces = [piece(1, 100, 100)]
  const vers = roll(10, 400, 400, 5)
  const oud = roll(11, 400, 400, 200)
  // bewust verse rol eerst in de input — simpel moet toch de oude pakken
  const res = packAcrossRolls(pieces, [vers, oud], vorm(), {
    fifo: fifoOpts({ modus: 'simpel' }),
  })

  assertEquals(res.fifoMetrics, undefined, 'simpel schrijft geen fifoMetrics')
  assertEquals(res.samenvatting.niet_geplaatst, 0)
  assertEquals(res.rollResults[0].rol_id, 11, 'oudst-binnengekomen rol eerst')
})

// ---------------------------------------------------------------------------
// 5. NULL in_magazijn_sinds telt als heel oud → krijgt FIFO-voorrang.
// ---------------------------------------------------------------------------
Deno.test('FIFO: NULL in_magazijn_sinds = heel oud (voorrang)', () => {
  const pieces = [piece(1, 100, 100)]
  const vers = roll(10, 100, 100, 2)
  const onbekend = roll(11, 400, 400, null) // NULL → 99999 dgn > bovengrens
  const res = packAcrossRolls(pieces, [vers, onbekend], vorm(), { fifo: fifoOpts() })

  assertEquals(res.rollResults[0].rol_id, 11, 'onbekende (heel oude) rol krijgt voorrang')
})
