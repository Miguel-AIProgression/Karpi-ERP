import { describe, it, expect } from 'vitest'
import { groepeerPerLaneEnWeek, bezettingPerWeek } from '../confectie-forward-planner'
import type { ConfectiePlanningForwardRow } from '@/lib/supabase/queries/confectie-planning'

const basisRow: ConfectiePlanningForwardRow = {
  snijplan_id: 1,
  snijplan_nr: 'SNIJ-2026-0001',
  scancode: null,
  snijplan_status: 'Gepland',
  confectie_id: 1,
  confectie_nr: 'SNIJ-2026-0001',
  status: 'Gepland',
  snij_lengte_cm: 300,
  snij_breedte_cm: 200,
  maatwerk_vorm: 'rechthoek',
  type_bewerking: 'breedband',
  order_regel_id: 1,
  order_id: 1,
  order_nr: 'ORD-2026-0001',
  klant_naam: 'TESTKLANT',
  maatwerk_afwerking: 'B',
  maatwerk_band_kleur: null,
  maatwerk_instructies: null,
  vorm: 'rechthoek',
  lengte_cm: 300,
  breedte_cm: 200,
  strekkende_meter_cm: 1000, // 10 m
  rol_id: null,
  rolnummer: null,
  kwaliteit_code: 'MIRA',
  kleur_code: '12',
  afleverdatum: null,
  confectie_afgerond_op: null,
  ingepakt_op: null,
  locatie: null,
  confectie_klaar_op: null,
  confectie_startdatum: '2026-04-20', // maandag week 17
  opmerkingen: null,
}

describe('groepeerPerLaneEnWeek', () => {
  it('groepeert één item op juiste lane + isoweek', () => {
    const map = groepeerPerLaneEnWeek([basisRow])
    expect(map.get('breedband')?.get('2026-W17')).toHaveLength(1)
  })

  it('stopt rijen zonder type_bewerking in de "geen-lane" bucket', () => {
    const zonder = { ...basisRow, type_bewerking: null, maatwerk_afwerking: 'ON' }
    const map = groepeerPerLaneEnWeek([zonder])
    expect(map.get('__geen_lane__')?.get('2026-W17')).toHaveLength(1)
  })
})

describe('bezettingPerWeek', () => {
  it('rekent benodigde minuten = (meters × minuten_per_meter) + wisseltijd per stuk', () => {
    const rows = [basisRow] // 10 m
    const werktijden = { minuten_per_meter: 3, wisseltijd_minuten: 5, parallelle_werkplekken: 1 }
    const beschikbaar = 2400 // 5 werkdagen × 480 min
    const bez = bezettingPerWeek(rows, werktijden, beschikbaar)
    expect(bez.nodigMin).toBe(35) // 10*3 + 5
    expect(bez.beschikbaarMin).toBe(2400)
    expect(bez.overload).toBe(false)
  })

  it('signaleert overload wanneer nodig > beschikbaar × werkplekken', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...basisRow, snijplan_id: i, confectie_id: i }))
    const werktijden = { minuten_per_meter: 10, wisseltijd_minuten: 5, parallelle_werkplekken: 1 }
    const beschikbaar = 1000
    const bez = bezettingPerWeek(rows, werktijden, beschikbaar)
    expect(bez.overload).toBe(true)
  })

  it('schaalt beschikbare tijd met parallelle_werkplekken', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...basisRow, snijplan_id: i, confectie_id: i }))
    const werktijden = { minuten_per_meter: 10, wisseltijd_minuten: 5, parallelle_werkplekken: 2 }
    const beschikbaar = 1000
    // nodig: 10 × (10×10 + 5) = 1050 ; beschikbaar × 2 = 2000 → past
    const bez = bezettingPerWeek(rows, werktijden, beschikbaar)
    expect(bez.nodigMin).toBe(1050)
    expect(bez.beschikbaarMin).toBe(2000)
    expect(bez.overload).toBe(false)
  })
})
