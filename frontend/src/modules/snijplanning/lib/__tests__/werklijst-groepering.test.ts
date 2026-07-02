// Fase (b) — groepeerWerklijst unit tests.
// Controleert de groepeerlogica voor de snijderij werklijst:
//   - partitionering per (kwaliteit, kleur)
//   - shelf-detectie: stukken met zelfde positie_y_cm → naast-elkaar
//   - materiaalstatus: rol_id / verwacht_io / tekort
//   - sorting: express → verzendweek → klant
//   - restlengte per rol

import { describe, it, expect } from 'vitest'
import { groepeerWerklijst } from '../werklijst-groepering'
import type { WerklijstRow } from '../../queries/werklijst'
import type { Werktijden } from '@/lib/utils/bereken-agenda'
import type { SnijDeadlineConfig } from '@/lib/orders/snij-haalbaarheid'

// ─── Test-configuratie ────────────────────────────────────────────────────────

// Eenvoudige werktijden zonder feestdagen — voldoende voor tests
// die afleverdatum=null gebruiken (haalbaarheid wordt dan niet berekend).
const WERKTIJDEN: Werktijden = {
  werkdagen: [1, 2, 3, 4, 5],
  start: '08:00',
  eind: '17:00',
  pauzes: [],
  vrij: [],
}

const CONFIG: SnijDeadlineConfig = {
  logistieke_buffer_dagen: 2,
  dag_order_snij_buffer_werkdagen: 2,
}

const VANDAAG = '2026-06-29'

// ─── Factory ──────────────────────────────────────────────────────────────────

let _id = 1
function volgendeId() { return _id++ }

function rij(overrides: Partial<WerklijstRow> & { order_regel_id: number }): WerklijstRow {
  const id = volgendeId()
  return {
    id,
    snijplan_nr: `SP-2026-${id}`,
    status: 'Gepland',
    kwaliteit_code: 'TEST',
    kleur_code: '01',
    karpi_code: null,
    maatwerk_lengte_cm: 200,
    maatwerk_breedte_cm: 150,
    maatwerk_vorm: null,
    maatwerk_afwerking: null,
    maatwerk_band_kleur: null,
    orderaantal: 1,
    order_id: overrides.order_regel_id,
    order_nr: `ORD-2026-${overrides.order_regel_id}`,
    klant_naam: 'Testklant',
    debiteur_nr: 1,
    orderdatum: null,
    afleverdatum: null,  // null → haalbaarheid=null (geen werkagenda-berekening nodig)
    lever_type: 'week',
    verzendweek: null,
    snij_lengte_cm: 200,
    snij_breedte_cm: 150,
    marge_cm: 0,
    placed_lengte_cm: 200, // X-as (breedte-richting rol)
    placed_breedte_cm: 150, // Y-as (lengterichting rol)
    positie_x_cm: 0,
    positie_y_cm: 0,
    geroteerd: false,
    rol_id: 1,
    rolnummer: 'ROL-001',
    rol_breedte_cm: 400,
    rol_lengte_cm: 2000,
    verwacht_inkooporder_regel_id: null,
    is_handmatig_toegewezen: false,
    express: false,
    ...overrides,
  }
}

function input(stukken: WerklijstRow[]) {
  return { stukken, vandaag: VANDAAG, werktijden: WERKTIJDEN, snijDeadlineConfig: CONFIG }
}

// ─── Partitionering per kwaliteit/kleur ──────────────────────────────────────

describe('groepeerWerklijst — partitionering', () => {
  it('stukken van dezelfde kwaliteit+kleur landen in één groep', () => {
    const stukken = [
      rij({ order_regel_id: 1, kwaliteit_code: 'LAGO', kleur_code: '21' }),
      rij({ order_regel_id: 2, kwaliteit_code: 'LAGO', kleur_code: '21' }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    expect(groepen).toHaveLength(1)
    expect(groepen[0].kwaliteit_code).toBe('LAGO')
    expect(groepen[0].kleur_code).toBe('21')
    expect(groepen[0].productNaam).toBe('LAGO 21')
  })

  it('stukken van verschillende kwaliteiten komen in aparte groepen', () => {
    const stukken = [
      rij({ order_regel_id: 10, kwaliteit_code: 'LAGO', kleur_code: '21' }),
      rij({ order_regel_id: 11, kwaliteit_code: 'SPLE', kleur_code: '12' }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    expect(groepen).toHaveLength(2)
    const codes = groepen.map((g) => g.kwaliteit_code).sort()
    expect(codes).toEqual(['LAGO', 'SPLE'])
  })

  it('dezelfde kwaliteit met verschillende kleuren = twee groepen', () => {
    const stukken = [
      rij({ order_regel_id: 20, kwaliteit_code: 'LAGO', kleur_code: '21' }),
      rij({ order_regel_id: 21, kwaliteit_code: 'LAGO', kleur_code: '48' }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    expect(groepen).toHaveLength(2)
  })
})

// ─── Materiaalstatus ──────────────────────────────────────────────────────────

describe('groepeerWerklijst — materiaalstatus', () => {
  it('stuk met rol_id → materiaalStatus = op_rol', () => {
    const stukken = [rij({ order_regel_id: 100, rol_id: 42, verwacht_inkooporder_regel_id: null })]
    const groepen = groepeerWerklijst(input(stukken))
    expect(groepen[0].rollen).toHaveLength(1)
    expect(groepen[0].wachtOpInkoop).toHaveLength(0)
    expect(groepen[0].tekort).toHaveLength(0)
    expect(groepen[0].rollen[0].orderregels[0].materiaalStatus).toBe('op_rol')
  })

  it('stuk zonder rol maar met IO-claim → materiaalStatus = wacht_op_inkoop', () => {
    const stukken = [
      rij({
        order_regel_id: 101,
        rol_id: null,
        rolnummer: null,
        verwacht_inkooporder_regel_id: 99,
        status: 'Wacht op inkoop',
      }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    expect(groepen[0].wachtOpInkoop).toHaveLength(1)
    expect(groepen[0].rollen).toHaveLength(0)
    expect(groepen[0].wachtOpInkoop[0].materiaalStatus).toBe('wacht_op_inkoop')
  })

  it('stuk zonder rol en zonder IO → materiaalStatus = tekort', () => {
    const stukken = [
      rij({
        order_regel_id: 102,
        rol_id: null,
        rolnummer: null,
        verwacht_inkooporder_regel_id: null,
        status: 'Wacht',
      }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    expect(groepen[0].tekort).toHaveLength(1)
    expect(groepen[0].tekort[0].materiaalStatus).toBe('tekort')
  })

  it('aantalOpRol / aantalWachtOpInkoop / aantalTekort kloppen', () => {
    const stukken = [
      rij({ order_regel_id: 200, rol_id: 1, verwacht_inkooporder_regel_id: null }),
      rij({ order_regel_id: 201, rol_id: 1, verwacht_inkooporder_regel_id: null }),
      rij({ order_regel_id: 300, rol_id: null, rolnummer: null, verwacht_inkooporder_regel_id: 5 }),
      rij({ order_regel_id: 400, rol_id: null, rolnummer: null, verwacht_inkooporder_regel_id: null }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const groep = groepen[0]
    expect(groep.aantalOpRol).toBe(2)
    expect(groep.aantalWachtOpInkoop).toBe(1)
    expect(groep.aantalTekort).toBe(1)
  })
})

// ─── Shelf-detectie: naast-elkaar ────────────────────────────────────────────

describe('groepeerWerklijst — shelf-detectie (naast-elkaar)', () => {
  it('twee stukken met dezelfde positie_y_cm komen in dezelfde shelf', () => {
    // Simuleer een gepakte rol: stuk A en B liggen naast-elkaar op y=0.
    const stukken = [
      rij({
        order_regel_id: 500,
        rol_id: 10,
        positie_x_cm: 0,
        positie_y_cm: 0,
        placed_lengte_cm: 200,
        placed_breedte_cm: 300,
      }),
      rij({
        order_regel_id: 501,
        rol_id: 10,
        positie_x_cm: 200,
        positie_y_cm: 0,
        placed_lengte_cm: 180,
        placed_breedte_cm: 290,
      }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const rol = groepen[0].rollen[0]
    expect(rol.shelves).toHaveLength(1)
    expect(rol.shelves[0].positieYCm).toBe(0)
    expect(rol.shelves[0].stukken).toHaveLength(2)
  })

  it('stukken op verschillende positie_y komen in aparte shelves', () => {
    const stukken = [
      rij({
        order_regel_id: 600,
        rol_id: 10,
        positie_x_cm: 0,
        positie_y_cm: 0,
        placed_lengte_cm: 200,
        placed_breedte_cm: 300,
      }),
      rij({
        order_regel_id: 601,
        rol_id: 10,
        positie_x_cm: 0,
        positie_y_cm: 300,
        placed_lengte_cm: 200,
        placed_breedte_cm: 200,
      }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const rol = groepen[0].rollen[0]
    expect(rol.shelves).toHaveLength(2)
    const yPosities = rol.shelves.map((s) => s.positieYCm).sort((a, b) => a - b)
    expect(yPosities).toEqual([0, 300])
  })

  it('gebruikteBreedteCm = som van placed_lengte_cm per shelf', () => {
    const stukken = [
      rij({
        order_regel_id: 700,
        rol_id: 20,
        positie_x_cm: 0,
        positie_y_cm: 0,
        placed_lengte_cm: 156,
        placed_breedte_cm: 406,
      }),
      rij({
        order_regel_id: 701,
        rol_id: 20,
        positie_x_cm: 156,
        positie_y_cm: 0,
        placed_lengte_cm: 200,
        placed_breedte_cm: 300,
      }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const shelf = groepen[0].rollen[0].shelves[0]
    expect(shelf.gebruikteBreedteCm).toBe(356) // 156 + 200
  })

  it('eindYCm = positieY + max(placed_breedte_cm) op de shelf', () => {
    // ZO (breedte=406) + rect (breedte=300) op shelf y=0: eindY = 0 + 406 = 406
    const stukken = [
      rij({
        order_regel_id: 800,
        rol_id: 30,
        positie_x_cm: 0,
        positie_y_cm: 0,
        placed_lengte_cm: 156,
        placed_breedte_cm: 406,
      }),
      rij({
        order_regel_id: 801,
        rol_id: 30,
        positie_x_cm: 156,
        positie_y_cm: 0,
        placed_lengte_cm: 200,
        placed_breedte_cm: 300,
      }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const shelf = groepen[0].rollen[0].shelves[0]
    expect(shelf.eindYCm).toBe(406) // max(406, 300)
  })
})

// ─── Restlengte per rol ───────────────────────────────────────────────────────

describe('groepeerWerklijst — restlengte rol', () => {
  it('restLengteCm = rolLengteCm − gebruikteLengteCm', () => {
    // Drie-stukken-scenario (zie packing-test):
    //   shelf y=0: ZO + rect → eindY = 0+406 = 406
    //   shelf y=406: rond → eindY = 406+202.5 = 608.5
    //   gebruikteLengte = max(406, 608.5) = 608.5
    //   rol_lengte = 1000 → restLengte = 1000 − 608.5 = 391.5
    const stukken = [
      rij({ order_regel_id: 900, rol_id: 40, positie_x_cm: 0, positie_y_cm: 0, placed_lengte_cm: 156, placed_breedte_cm: 406, rol_lengte_cm: 1000 }),
      rij({ order_regel_id: 901, rol_id: 40, positie_x_cm: 156, positie_y_cm: 0, placed_lengte_cm: 200, placed_breedte_cm: 300, rol_lengte_cm: 1000 }),
      rij({ order_regel_id: 902, rol_id: 40, positie_x_cm: 0, positie_y_cm: 406, placed_lengte_cm: 202.5, placed_breedte_cm: 202.5, rol_lengte_cm: 1000 }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const rol = groepen[0].rollen[0]
    expect(rol.gebruikteLengteCm).toBe(608.5)
    expect(rol.restLengteCm).toBe(391.5)
    expect(rol.rolLengteCm).toBe(1000)
  })
})

// ─── Aggregatie per orderregel ─────────────────────────────────────────────────

describe('groepeerWerklijst — aggregatie per orderregel', () => {
  it('meerdere stukken van dezelfde orderregel worden samengevoegd tot één WerklijstOrderregel', () => {
    // Orderregel 1000 heeft 3 stuks (bijv. 3× snijplan-stuk op dezelfde rol)
    const stukken = [
      rij({ order_regel_id: 1000, rol_id: 50, positie_x_cm: 0, positie_y_cm: 0 }),
      rij({ order_regel_id: 1000, rol_id: 50, positie_x_cm: 200, positie_y_cm: 0 }),
      rij({ order_regel_id: 1000, rol_id: 50, positie_x_cm: 0, positie_y_cm: 150 }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const rol = groepen[0].rollen[0]
    expect(rol.orderregels).toHaveLength(1)
    expect(rol.orderregels[0].aantalStuks).toBe(3)
    expect(rol.orderregels[0].orderRegelId).toBe(1000)
  })
})

// ─── Sorting ──────────────────────────────────────────────────────────────────

describe('groepeerWerklijst — sortering orderregels', () => {
  it('express-orderregel staat vóór niet-express bij gelijke verzendweek', () => {
    const stukken = [
      rij({ order_regel_id: 1100, rol_id: 60, klant_naam: 'B-klant', express: false, verzendweek: '2026-W28' }),
      rij({ order_regel_id: 1101, rol_id: 60, klant_naam: 'A-klant', express: true,  verzendweek: '2026-W28' }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const orderregels = groepen[0].rollen[0].orderregels
    expect(orderregels[0].express).toBe(true)
    expect(orderregels[1].express).toBe(false)
  })

  it('lagere verzendweek staat vóór hogere (numeriek: jaar×100+week)', () => {
    const stukken = [
      rij({ order_regel_id: 1200, rol_id: 70, klant_naam: 'Klant', express: false, verzendweek: '2026-W30' }),
      rij({ order_regel_id: 1201, rol_id: 70, klant_naam: 'Klant', express: false, verzendweek: '2026-W28' }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const orderregels = groepen[0].rollen[0].orderregels
    expect(orderregels[0].verzendweek).toBe('2026-W28') // lagere week eerst
    expect(orderregels[1].verzendweek).toBe('2026-W30')
  })

  it('jaar-overgang: 2026-W52 vóór 2027-W01 (2026×100+52=202652 < 2027×100+1=202701)', () => {
    const stukken = [
      rij({ order_regel_id: 1300, rol_id: 80, klant_naam: 'Klant', express: false, verzendweek: '2027-W01' }),
      rij({ order_regel_id: 1301, rol_id: 80, klant_naam: 'Klant', express: false, verzendweek: '2026-W52' }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const orderregels = groepen[0].rollen[0].orderregels
    expect(orderregels[0].verzendweek).toBe('2026-W52') // 2026 vóór 2027
    expect(orderregels[1].verzendweek).toBe('2027-W01')
  })

  it('bij gelijke verzendweek: alphabetische sortering op klant', () => {
    const stukken = [
      rij({ order_regel_id: 1400, rol_id: 90, klant_naam: 'Zending BV',   express: false, verzendweek: '2026-W28' }),
      rij({ order_regel_id: 1401, rol_id: 90, klant_naam: 'Alfa Tapijt',  express: false, verzendweek: '2026-W28' }),
      rij({ order_regel_id: 1402, rol_id: 90, klant_naam: 'Midden Decor', express: false, verzendweek: '2026-W28' }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    const namen = groepen[0].rollen[0].orderregels.map((r) => r.klantNaam)
    expect(namen).toEqual(['Alfa Tapijt', 'Midden Decor', 'Zending BV'])
  })
})

// ─── Vroegste verzendweek per groep ───────────────────────────────────────────

describe('groepeerWerklijst — vroegsteVerzendweek per groep', () => {
  it('vroegsteVerzendweek is de laagste numerieke verzendweek over alle orderregels', () => {
    const stukken = [
      rij({ order_regel_id: 1500, rol_id: 100, verzendweek: '2026-W30' }),
      rij({ order_regel_id: 1501, rol_id: 100, verzendweek: '2026-W28' }),
      rij({ order_regel_id: 1502, rol_id: null, rolnummer: null, verwacht_inkooporder_regel_id: null, verzendweek: '2026-W35' }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    expect(groepen[0].vroegsteVerzendweek).toBe('2026-W28')
  })

  it('groepen gesorteerd op vroegsteVerzendweek (vroegste eerst)', () => {
    // Groep A: LAGO 21 met verzendweek W35
    // Groep B: SPLE 12 met verzendweek W28
    // Resultaat: SPLE vóór LAGO
    const stukken = [
      rij({ order_regel_id: 1600, kwaliteit_code: 'LAGO', kleur_code: '21', rol_id: 200, verzendweek: '2026-W35' }),
      rij({ order_regel_id: 1601, kwaliteit_code: 'SPLE', kleur_code: '12', rol_id: 201, verzendweek: '2026-W28' }),
    ]
    const groepen = groepeerWerklijst(input(stukken))
    expect(groepen[0].kwaliteit_code).toBe('SPLE') // W28 vóór W35
    expect(groepen[1].kwaliteit_code).toBe('LAGO')
  })
})
