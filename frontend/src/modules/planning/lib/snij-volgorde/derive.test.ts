// Tests voor SnijVolgorde-transformer.
//
// Fixtures:
//   * LORA 13 (I26080LO13C) — echte data uit DB op 2026-04-29 (snijplan_id
//     30, 32, 848, 248, 235). Verifieert: round-marge gap, overgenomen-detectie,
//     incremental lengte-mes.
//   * Multi-lane (synthetisch) — twee pieces in dezelfde Y-range met
//     verschillende X-lanes.
//   * Geroteerd (synthetisch) — geroteerd rectangle, snij-orientatie verschilt
//     van bestelde-orientatie.
//   * ZO-marge (synthetisch) — rechthoek met ZO-afwerking, +6 cm marge.

import { describe, it, expect } from 'vitest'
import { buildSnijVolgorde, type PlacementInput } from './derive'

const EMPTY_REST = {
  reststukken: [],
  aangebrokenEnd: null,
  afval: [],
}

describe('buildSnijVolgorde — LORA 13 (echte data)', () => {
  // Rol I26080LO13C, 400 × 1800. Operator-feedback:
  //   Rij 1: 320×320 rond → mes 325 breed, lengte 325 (snij vierkant, dan rond met hand)
  //   Rij 2: 325×275 rechthoek → mes 325 (overgenomen), lengte 275
  //   Rij 3: 250×250 → mes 250, lengte 250
  //   Rij 4: 250×250 → mes 250 (overgenomen), lengte 250
  //   Rij 5: 220×220 → mes 220, lengte 220
  const lora13: PlacementInput[] = [
    {
      id: 30, snijplan_nr: 'SNIJ-2026-2522',
      positie_x_cm: 0, positie_y_cm: 0,
      snij_lengte_cm: 320, snij_breedte_cm: 320,
      geroteerd: false, marge_cm: 5,
      maatwerk_vorm: 'rond', maatwerk_afwerking: null,
      order_id: 1001, order_nr: 'IMP-26483700', klant_naam: 'DERSIMO',
      artikelnr: '328139998', afleverdatum: '2026-04-20',
    },
    {
      id: 32, snijplan_nr: 'SNIJ-2026-2524',
      positie_x_cm: 0, positie_y_cm: 325,
      snij_lengte_cm: 325, snij_breedte_cm: 275,
      geroteerd: false, marge_cm: 0,
      maatwerk_vorm: 'rechthoek', maatwerk_afwerking: null,
      order_id: 1002, order_nr: 'IMP-26483950', klant_naam: 'SCHIE WONEN',
      artikelnr: '328139998', afleverdatum: '2026-04-20',
    },
    {
      id: 848, snijplan_nr: 'SNIJ-2026-3340',
      positie_x_cm: 0, positie_y_cm: 600,
      snij_lengte_cm: 250, snij_breedte_cm: 250,
      geroteerd: false, marge_cm: 0,
      maatwerk_vorm: null, maatwerk_afwerking: null,
      order_id: 1003, order_nr: 'ORD-2026-1769', klant_naam: 'FLOORPASSION',
      artikelnr: '328139998', afleverdatum: '2026-04-24',
    },
    {
      id: 248, snijplan_nr: 'SNIJ-2026-2740',
      positie_x_cm: 0, positie_y_cm: 850,
      snij_lengte_cm: 250, snij_breedte_cm: 250,
      geroteerd: false, marge_cm: 0,
      maatwerk_vorm: 'rechthoek', maatwerk_afwerking: null,
      order_id: 1004, order_nr: 'IMP-26527230', klant_naam: 'DERSIMO',
      artikelnr: '328139998', afleverdatum: '2026-05-11',
    },
    {
      id: 235, snijplan_nr: 'SNIJ-2026-2727',
      positie_x_cm: 0, positie_y_cm: 1100,
      snij_lengte_cm: 220, snij_breedte_cm: 220,
      geroteerd: false, marge_cm: 0,
      maatwerk_vorm: 'rechthoek', maatwerk_afwerking: null,
      order_id: 1005, order_nr: 'IMP-26526100', klant_naam: 'DEKOWE SCHURHOLZ GMBH',
      artikelnr: '328139998', afleverdatum: '2026-05-04',
    },
  ]

  const sv = buildSnijVolgorde({
    rolnummer: 'I26080LO13C',
    rol_breedte_cm: 400,
    rol_lengte_cm: 1800,
    placements: lora13,
    ...EMPTY_REST,
  })

  it('produceert 5 aparte rijen — geen merge ondanks aansluitende y-positions', () => {
    expect(sv.rijen).toHaveLength(5)
    expect(sv.rijen.map((r) => r.rij_nummer)).toEqual([1, 2, 3, 4, 5])
  })

  it('Rij 1 (rond 320): mes op 325 breed, lengte 325 (marge toegepast)', () => {
    const rij = sv.rijen[0]
    expect(rij.breedte_messen_cm).toEqual([325])
    expect(rij.lengte_mes_cm).toBe(325)
    expect(rij.is_breedte_mes_overgenomen).toBe(false)
    expect(rij.pieces).toHaveLength(1)
    expect(rij.pieces[0].handeling.kind).toBe('rond_uitsnijden')
    expect(rij.pieces[0].snij_maat_x_cm).toBe(325)
    expect(rij.pieces[0].snij_maat_y_cm).toBe(325)
    expect(rij.pieces[0].bestelde_x_cm).toBe(320)
    expect(rij.pieces[0].bestelde_y_cm).toBe(320)
  })

  it('Rij 2 (325×275): mes 325 OVERGENOMEN, lengte 275', () => {
    const rij = sv.rijen[1]
    expect(rij.breedte_messen_cm).toEqual([325])
    expect(rij.lengte_mes_cm).toBe(275)
    expect(rij.is_breedte_mes_overgenomen).toBe(true)
    expect(rij.pieces[0].handeling.kind).toBe('geen')
  })

  it('Rij 3 (250×250): mes 250, NIET overgenomen (vorige was 325)', () => {
    const rij = sv.rijen[2]
    expect(rij.breedte_messen_cm).toEqual([250])
    expect(rij.lengte_mes_cm).toBe(250)
    expect(rij.is_breedte_mes_overgenomen).toBe(false)
  })

  it('Rij 4 (250×250): mes 250 OVERGENOMEN', () => {
    const rij = sv.rijen[3]
    expect(rij.breedte_messen_cm).toEqual([250])
    expect(rij.is_breedte_mes_overgenomen).toBe(true)
  })

  it('Rij 5 (220×220): mes 220, NIET overgenomen', () => {
    const rij = sv.rijen[4]
    expect(rij.breedte_messen_cm).toEqual([220])
    expect(rij.is_breedte_mes_overgenomen).toBe(false)
  })
})

describe('buildSnijVolgorde — multi-lane (VERR130 C-stijl)', () => {
  // Twee stukken in dezelfde Y-range, verschillende X-lanes:
  // 220×220 rond (lane 1, x=0..225 met +5 marge) en 160×160 rechthoek
  // (lane 2, x=225..385). Beide y=540..540+(225 of 160).
  // Lengte-mes = max(225, 160) = 225.
  // Breedte-messen: 225 (rechterkant lane 1), 385 (rechterkant lane 2).
  const placements: PlacementInput[] = [
    {
      id: 100, snijplan_nr: 'SNIJ-100',
      positie_x_cm: 0, positie_y_cm: 540,
      snij_lengte_cm: 220, snij_breedte_cm: 220,
      geroteerd: false, marge_cm: 5,
      maatwerk_vorm: 'rond', maatwerk_afwerking: null,
      order_id: 2001, order_nr: 'IMP-A', klant_naam: 'KLANT-A',
      artikelnr: 'X', afleverdatum: null,
    },
    {
      id: 101, snijplan_nr: 'SNIJ-101',
      positie_x_cm: 225, positie_y_cm: 540,
      snij_lengte_cm: 160, snij_breedte_cm: 160,
      geroteerd: false, marge_cm: 0,
      maatwerk_vorm: 'rechthoek', maatwerk_afwerking: null,
      order_id: 2002, order_nr: 'IMP-B', klant_naam: 'KLANT-B',
      artikelnr: 'X', afleverdatum: null,
    },
  ]

  const sv = buildSnijVolgorde({
    rolnummer: 'TEST-MULTILANE',
    rol_breedte_cm: 400,
    rol_lengte_cm: 1500,
    placements,
    ...EMPTY_REST,
  })

  it('clustert beide stukken in 1 Rij wegens Y-overlap', () => {
    expect(sv.rijen).toHaveLength(1)
  })

  it('exposeert twee breedte-messen op lane-grenzen', () => {
    expect(sv.rijen[0].breedte_messen_cm).toEqual([225, 385])
  })

  it('lengte-mes = max Y-extent (225 voor rond)', () => {
    expect(sv.rijen[0].lengte_mes_cm).toBe(225)
  })

  it('pieces zijn x-gesorteerd', () => {
    expect(sv.rijen[0].pieces.map((p) => p.x_start_cm)).toEqual([0, 225])
  })
})

describe('buildSnijVolgorde — geroteerd rechthoek', () => {
  // Klant bestelt 257 lengte × 315 breedte (X × Y in originele orientatie).
  // Packer plaatst geroteerd: placed_X=315, placed_Y=257.
  // snij_lengte_cm=257 (originele X), snij_breedte_cm=315 (originele Y).
  const placements: PlacementInput[] = [
    {
      id: 200, snijplan_nr: 'SNIJ-200',
      positie_x_cm: 0, positie_y_cm: 0,
      snij_lengte_cm: 257, snij_breedte_cm: 315,
      geroteerd: true, marge_cm: 0,
      maatwerk_vorm: 'rechthoek', maatwerk_afwerking: null,
      order_id: 3001, order_nr: 'ORD-X', klant_naam: 'X',
      artikelnr: 'X', afleverdatum: null,
    },
  ]

  const sv = buildSnijVolgorde({
    rolnummer: 'TEST-ROT',
    rol_breedte_cm: 400,
    rol_lengte_cm: 1500,
    placements,
    ...EMPTY_REST,
  })

  it('snij-maat is 315×257 (geswapt door geroteerd)', () => {
    const piece = sv.rijen[0].pieces[0]
    expect(piece.snij_maat_x_cm).toBe(315)
    expect(piece.snij_maat_y_cm).toBe(257)
  })

  it('bestelde maat blijft origineel 257×315', () => {
    const piece = sv.rijen[0].pieces[0]
    expect(piece.bestelde_x_cm).toBe(257)
    expect(piece.bestelde_y_cm).toBe(315)
  })

  it('handeling = orientatie_swap', () => {
    expect(sv.rijen[0].pieces[0].handeling.kind).toBe('orientatie_swap')
  })

  it('breedte-mes op 315 (placed X-extent)', () => {
    expect(sv.rijen[0].breedte_messen_cm).toEqual([315])
  })
})

describe('buildSnijVolgorde — ZO-marge (rechthoek met +6 cm)', () => {
  const placements: PlacementInput[] = [
    {
      id: 300, snijplan_nr: 'SNIJ-300',
      positie_x_cm: 0, positie_y_cm: 0,
      snij_lengte_cm: 200, snij_breedte_cm: 290,
      geroteerd: false, marge_cm: 6,
      maatwerk_vorm: 'rechthoek', maatwerk_afwerking: 'ZO',
      order_id: 4001, order_nr: 'ORD-Y', klant_naam: 'Y',
      artikelnr: 'X', afleverdatum: null,
    },
  ]

  const sv = buildSnijVolgorde({
    rolnummer: 'TEST-ZO',
    rol_breedte_cm: 400,
    rol_lengte_cm: 1500,
    placements,
    ...EMPTY_REST,
  })

  it('snij-maat is bestelde + 6 cm', () => {
    const piece = sv.rijen[0].pieces[0]
    expect(piece.snij_maat_x_cm).toBe(206)
    expect(piece.snij_maat_y_cm).toBe(296)
    expect(piece.bestelde_x_cm).toBe(200)
    expect(piece.bestelde_y_cm).toBe(290)
  })

  it('handeling = zo_marge_extra met marge 6', () => {
    const h = sv.rijen[0].pieces[0].handeling
    expect(h.kind).toBe('zo_marge_extra')
    if (h.kind === 'zo_marge_extra') expect(h.marge_cm).toBe(6)
  })
})

describe('buildSnijVolgorde — reststuk en aangebroken markers', () => {
  const sv = buildSnijVolgorde({
    rolnummer: 'TEST-REST',
    rol_breedte_cm: 400,
    rol_lengte_cm: 1500,
    placements: [],
    reststukken: [
      { x_cm: 200, y_cm: 0, breedte_cm: 200, lengte_cm: 150 },
      { x_cm: 0, y_cm: 200, breedte_cm: 100, lengte_cm: 300 },
    ],
    aangebrokenEnd: { y_cm: 500, breedte_cm: 400, lengte_cm: 1000 },
    afval: [{ x_cm: 100, y_cm: 200, breedte_cm: 50, lengte_cm: 80 }],
  })

  it('reststukken krijgen R1, R2 letters in y/x sortvolgorde', () => {
    expect(sv.reststukken).toHaveLength(2)
    expect(sv.reststukken[0].letter).toBe('R1')
    expect(sv.reststukken[0].rolnummer_volledig).toBe('TEST-REST-R1')
    expect(sv.reststukken[1].letter).toBe('R2')
  })

  it('aangebroken-rest exposeert resterende rol-lengte', () => {
    expect(sv.aangebroken_rest).not.toBeNull()
    expect(sv.aangebroken_rest!.lengte_cm).toBe(1000)
    expect(sv.aangebroken_rest!.breedte_cm).toBe(400)
  })

  it('afval staat in eigen array, niet bij reststukken', () => {
    expect(sv.afval).toHaveLength(1)
  })
})
