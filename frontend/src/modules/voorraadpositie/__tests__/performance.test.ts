// Performance-baseline voor `fetchVoorraadposities({})` — Voorraadpositie-Module.
//
// Skip-by-default: deze suite vereist een live Supabase-connectie tegen een
// test-branch met realistische seed (~5000 rollen + ~200 IO-regels).
// Activeer via env-flag VITEST_INCLUDE_PERF=1.
//
// Strategie:
//   1. Seed Supabase test-branch met ~5000 `rollen`-rijen en ~200 openstaande
//      `inkooporder_regels` (representatief voor productie-volume mid-2026).
//   2. Roep `fetchVoorraadposities({})` 10× aan, meet wall-clock per run.
//   3. Asserteer p95 < 500 ms. Faal niet stilzwijgend; log alle 10 metingen
//      voor latere trend-analyse.
//
// HITL: deze test wordt door een mens gedraaid bij elke RPC-wijziging die
// invloed kan hebben op de query-plan (bv. T005 cleanup van oude RPC's).
// Resultaten en seed-script worden bewaard in
// `docs/performance/voorraadposities-baseline.md` (TODO — volgt zodra de
// test-branch met seed klaar is).

import { describe, it } from 'vitest'

const includePerf = process.env.VITEST_INCLUDE_PERF === '1'
const describeMaybe = includePerf ? describe : describe.skip

describeMaybe('voorraadposities — batch performance baseline', () => {
  it.skip('p95 < 500 ms over 10 runs (TODO: seed test-branch + meet)', async () => {
    // TODO HITL — implementeer zodra Supabase test-branch met seed staat:
    //   const runs = 10
    //   const timings: number[] = []
    //   for (let i = 0; i < runs; i++) {
    //     const t0 = performance.now()
    //     await fetchVoorraadposities({})
    //     timings.push(performance.now() - t0)
    //   }
    //   timings.sort((a, b) => a - b)
    //   const p95 = timings[Math.floor(runs * 0.95) - 1]
    //   console.info('voorraadposities p95:', p95, 'ms — runs:', timings)
    //   expect(p95).toBeLessThan(500)
  })
})
