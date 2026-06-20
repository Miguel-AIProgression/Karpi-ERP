import { describe, it, expect } from 'vitest'
import { groepeerStukkenPerRol } from './snijplan-mapping'
import type { SnijplanRow } from '@/lib/types/productie'

// Karakterisering: gebruikte/resterende lengte komt uit de werkelijke 2D-
// positionering (positie_y_cm + Y-extent, rotatie-bewust), niet een platte
// m²-som — dit is exact de inconsistentie die op de Tekort-tab is gevonden
// (2026-06-19): de berekening bestond al (mapSnijplannenToStukken) maar werd
// niet op RolGroep gezet voor de Te-snijden-tab.
function maakStuk(o: Partial<SnijplanRow> & Pick<SnijplanRow, 'id' | 'positie_x_cm' | 'positie_y_cm' | 'geroteerd' | 'snij_lengte_cm' | 'snij_breedte_cm'>): SnijplanRow {
  return {
    snijplan_nr: `SNIJ-${o.id}`,
    scancode: `SC${o.id}`,
    status: 'Gepland',
    prioriteit: 5,
    planning_week: null,
    planning_jaar: null,
    afleverdatum: null,
    gesneden_datum: null,
    gesneden_op: null,
    gesneden_door: null,
    rol_id: 1,
    rolnummer: 'R-1',
    kwaliteit_code: 'TEST',
    kleur_code: '1',
    rol_lengte_cm: 1500,
    rol_breedte_cm: 400,
    rol_oppervlak_m2: 60,
    rol_status: 'in_snijplan',
    locatie: null,
    maatwerk_vorm: 'rechthoek',
    maatwerk_lengte_cm: null,
    maatwerk_breedte_cm: null,
    maatwerk_afwerking: null,
    maatwerk_band_kleur: null,
    maatwerk_instructies: null,
    marge_cm: 0,
    order_regel_id: o.id,
    artikelnr: null,
    product_omschrijving: null,
    orderaantal: 1,
    order_id: o.id,
    order_nr: `ORD-${o.id}`,
    debiteur_nr: 1,
    klant_naam: 'Test Klant',
    is_handmatig_toegewezen: false,
    ...o,
  }
}

describe('groepeerStukkenPerRol: gebruikte/resterende lengte', () => {
  it('niet-geroteerd stuk: Y-extent = snij_breedte_cm', () => {
    const stukken = [
      maakStuk({ id: 1, positie_x_cm: 0, positie_y_cm: 0, geroteerd: false, snij_lengte_cm: 300, snij_breedte_cm: 200 }),
    ]
    const [groep] = groepeerStukkenPerRol(stukken)
    expect(groep.gebruikteLengteCm).toBe(200) // y=0 + breedte_cm=200
    expect(groep.restLengteCm).toBe(1500 - 200)
  })

  it('geroteerd stuk: Y-extent = snij_lengte_cm (afmetingen wisselen)', () => {
    const stukken = [
      maakStuk({ id: 1, positie_x_cm: 0, positie_y_cm: 0, geroteerd: true, snij_lengte_cm: 300, snij_breedte_cm: 200 }),
    ]
    const [groep] = groepeerStukkenPerRol(stukken)
    expect(groep.gebruikteLengteCm).toBe(300) // geroteerd: Y-extent = lengte_cm
  })

  it('twee stukken op dezelfde shelf (naast elkaar): lengte = max, niet de som', () => {
    const stukken = [
      maakStuk({ id: 1, positie_x_cm: 0, positie_y_cm: 0, geroteerd: false, snij_lengte_cm: 200, snij_breedte_cm: 240 }),
      maakStuk({ id: 2, positie_x_cm: 200, positie_y_cm: 0, geroteerd: false, snij_lengte_cm: 200, snij_breedte_cm: 240 }),
    ]
    const [groep] = groepeerStukkenPerRol(stukken)
    // Beide stukken delen y=0..240 (naast elkaar in X) — dit is precies het
    // punt van de feature: 79,4 m² simpelweg optellen zou hier 2×240=480cm
    // suggereren, maar er is maar 240cm rol-lengte nodig.
    expect(groep.gebruikteLengteCm).toBe(240)
  })

  it('twee stukken na elkaar (verschillende shelf): lengte = som van beide', () => {
    const stukken = [
      maakStuk({ id: 1, positie_x_cm: 0, positie_y_cm: 0, geroteerd: false, snij_lengte_cm: 300, snij_breedte_cm: 200 }),
      maakStuk({ id: 2, positie_x_cm: 0, positie_y_cm: 200, geroteerd: false, snij_lengte_cm: 300, snij_breedte_cm: 150 }),
    ]
    const [groep] = groepeerStukkenPerRol(stukken)
    expect(groep.gebruikteLengteCm).toBe(350) // 200 + 150
    expect(groep.restLengteCm).toBe(1500 - 350)
  })

  it('rol zonder geplaatste stukken (geen positie_x/y_cm): 0 gebruikt', () => {
    const stukken = [
      maakStuk({ id: 1, positie_x_cm: null, positie_y_cm: null, geroteerd: false, snij_lengte_cm: 300, snij_breedte_cm: 200 }),
    ]
    const [groep] = groepeerStukkenPerRol(stukken)
    expect(groep.gebruikteLengteCm).toBe(0)
    expect(groep.restLengteCm).toBe(1500)
  })
})
