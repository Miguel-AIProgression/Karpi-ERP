// Parity-tests voor de frontend-spiegel van `compute-reststukken`. De backend-
// versie (`supabase/functions/_shared/compute-reststukken.ts`) heeft uitvoerige
// Deno-tests; deze suite verifieert dat de frontend dezelfde shape-bias hanteert
// (ADR-0025) zodat de modal-rapportage niet uit de pas loopt met de fysieke
// reststuk-aanmaak in de backend.

import { describe, it, expect } from 'vitest'
import { computeReststukken } from '../compute-reststukken'
import type { SnijvoorstelPlaatsing } from '@/lib/types/productie'

function p(
  snijplan_id: number,
  x: number,
  y: number,
  lengte: number,
  breedte: number,
): SnijvoorstelPlaatsing {
  return {
    snijplan_id,
    positie_x_cm: x,
    positie_y_cm: y,
    lengte_cm: lengte,
    breedte_cm: breedte,
    geroteerd: false,
  }
}

describe('compute-reststukken (frontend spiegel)', () => {
  it('lege rol → één groot reststuk', () => {
    const r = computeReststukken(1000, 400, [])
    expect(r).toHaveLength(1)
    expect(r[0]).toEqual({ x_cm: 0, y_cm: 0, breedte_cm: 400, lengte_cm: 1000 })
  })

  it('ADR-0025: VERR130 C-scenario — chunky 150×450 geclaimd, geen 75×905 strip', () => {
    // Real-world rapport: rol VERR130 C, 400×1500, 3 plaatsingen
    // (250×450, 325×225, 235×235). De oude pure-area greedy claimde een
    // 75×905 strip langs de rechterrand als grootste reststuk. Shape-bias
    // moet een chunky 150×450 claim opleveren als één van de reststukken,
    // en geen 75-wide strip die door alle 3 rijen heen loopt.
    const plaatsingen = [
      p(1, 0, 0, 250, 450),
      p(2, 0, 450, 325, 225),
      p(3, 0, 675, 235, 235),
    ]
    const r = computeReststukken(1500, 400, plaatsingen)

    const chunky150 = r.find(
      (x) => x.x_cm === 250 && x.y_cm === 0 && x.breedte_cm === 150 && x.lengte_cm === 450,
    )
    expect(
      chunky150,
      `verwacht 150×450 chunky claim op (250,0), kreeg ${JSON.stringify(r)}`,
    ).toBeDefined()

    // Geen enkele claim mag een 75-cm brede strip zijn die door alle 3 rijen
    // loopt (zou betekenen breedte=75 en lengte ≥ 800).
    const langSmal = r.find(
      (x) => Math.min(x.breedte_cm, x.lengte_cm) <= 75 &&
             Math.max(x.breedte_cm, x.lengte_cm) >= 800,
    )
    expect(
      langSmal,
      `er mag geen ≤75 × ≥800 strip als reststuk verschijnen, kreeg ${JSON.stringify(langSmal)}`,
    ).toBeUndefined()
  })

  it('te klein reststuk wordt uitgefilterd (< 50×100)', () => {
    // Rol 400×1000, placement 360×900 → strip 40 wide niet kwalificeren.
    const r = computeReststukken(1000, 400, [p(1, 0, 0, 360, 900)])
    const tesmal = r.find((x) => x.breedte_cm === 40)
    expect(tesmal).toBeUndefined()
  })
})
