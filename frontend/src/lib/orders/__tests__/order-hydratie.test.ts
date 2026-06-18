import { describe, it, expect } from 'vitest'
import { hydrateerOrderRegels, metProductVelden, type OrderHydratieKeuze } from '../order-hydratie'
// Diep pad (zoals order-commit.test): houdt React/Supabase uit de test-graph.
import { berekenRegelDekking } from '@/modules/reserveringen/lib/dekking-preview'
import type { OrderRegel } from '@/lib/supabase/queries/orders'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

/** Volledige OrderRegel (fetchOrderRegels-output) met overschrijfbare velden. */
function orderRegel(overrides: Partial<OrderRegel> = {}): OrderRegel {
  return {
    id: 1,
    regelnummer: 1,
    artikelnr: 'ART',
    karpi_code: null,
    omschrijving: 'Test',
    omschrijving_2: null,
    orderaantal: 1,
    te_leveren: 1,
    backorder: 0,
    prijs: 100,
    korting_pct: 0,
    bedrag: 100,
    gewicht_kg: 1,
    vrije_voorraad: 0,
    besteld_inkoop: 0,
    is_pseudo: false,
    is_dropship: false,
    is_maatwerk: false,
    ...overrides,
  }
}

describe('metProductVelden — het regel-input-contract', () => {
  const basis: OrderRegelFormData = { omschrijving: 'x', orderaantal: 1, te_leveren: 1, korting_pct: 0 }

  it('zet de vier display-only producten-velden op de regel', () => {
    const r = metProductVelden(basis, { vrije_voorraad: 38, besteld_inkoop: 10, is_pseudo: false, is_dropship: false })
    expect(r.vrije_voorraad).toBe(38)
    expect(r.besteld_inkoop).toBe(10)
    expect(r.is_pseudo).toBe(false)
    expect(r.is_dropship).toBe(false)
  })

  it('normaliseert null → undefined (optionele velden dragen geen expliciet null)', () => {
    const r = metProductVelden(basis, { vrije_voorraad: null, besteld_inkoop: null, is_pseudo: null, is_dropship: null })
    expect(r.vrije_voorraad).toBeUndefined()
    expect(r.besteld_inkoop).toBeUndefined()
    expect(r.is_pseudo).toBeUndefined()
    expect(r.is_dropship).toBeUndefined()
  })

  it('laat de overige regel-velden ongemoeid', () => {
    const r = metProductVelden(basis, { vrije_voorraad: 5 })
    expect(r.omschrijving).toBe('x')
    expect(r.te_leveren).toBe(1)
  })
})

describe('hydrateerOrderRegels — Order → form-state', () => {
  it('draagt de regel-velden én de producten-display-velden over', () => {
    const [r] = hydrateerOrderRegels(
      [orderRegel({ id: 42, artikelnr: '328210010', te_leveren: 2, vrije_voorraad: 38, besteld_inkoop: 0, is_pseudo: false, is_dropship: false })],
      [],
    )
    expect(r.id).toBe(42)
    expect(r.artikelnr).toBe('328210010')
    expect(r.te_leveren).toBe(2)
    expect(r.vrije_voorraad).toBe(38) // ← de gap die ORD-2026-0614 veroorzaakte
    expect(r.besteld_inkoop).toBe(0)
    expect(r.uitwisselbaar_keuzes).toEqual([])
  })

  it('rehydrateert handmatige uitwisselbaar-keuzes (omstickeren) per regel', () => {
    const keuzes: OrderHydratieKeuze[] = [
      { order_regel_id: 7, artikelnr: '771110001', aantal: 1, omschrijving: 'VELVET TOUCH' },
    ]
    const [r] = hydrateerOrderRegels([orderRegel({ id: 7, artikelnr: '771110005' })], keuzes)
    expect(r.uitwisselbaar_keuzes).toEqual([{ artikelnr: '771110001', aantal: 1, omschrijving: 'VELVET TOUCH' }])
  })
})

describe('ORD-2026-0614 regressie — geen vals IO-tekort na hydratie', () => {
  // De gemelde order: regel 1 = voorradige Loranda zónder omsticker-keuze,
  // regel 2 = CISCO gedekt via een handmatige omsticker-claim. Vóór de fix gaf
  // de Loranda ioTekort=1 (vrije_voorraad ontbrak → 0) terwijl de omgestickerde
  // CISCO toevallig ontsnapte — vandaar de "vreemde" LeverModusDialog.
  const regels = hydrateerOrderRegels(
    [
      orderRegel({ id: 6206, regelnummer: 1, artikelnr: '328210010', te_leveren: 1, vrije_voorraad: 38 }),
      orderRegel({ id: 6207, regelnummer: 2, artikelnr: '771110005', te_leveren: 1, vrije_voorraad: 0 }),
    ],
    [{ order_regel_id: 6207, artikelnr: '771110001', aantal: 1, omschrijving: 'VELVET TOUCH' }],
  )

  it('Loranda (eigen voorraad) heeft geen IO-tekort', () => {
    expect(berekenRegelDekking(regels[0]).ioTekort).toBe(0)
  })

  it('CISCO (omsticker, geen eigen voorraad) heeft geen IO-tekort', () => {
    expect(berekenRegelDekking(regels[1]).ioTekort).toBe(0)
  })

  it('geen enkele regel triggert een tekort → LeverModusDialog blijft dicht', () => {
    const tekorten = regels.filter(r => berekenRegelDekking(r).ioTekort > 0)
    expect(tekorten).toHaveLength(0)
  })
})

describe('de bug zónder hydratie — ontbrekend vrije_voorraad meldt vals tekort', () => {
  it('een voorradige regel met vrije_voorraad=undefined geeft ioTekort = te_leveren', () => {
    // Dit is precies wat order-edit vóór de fix produceerde: vrije_voorraad nooit
    // gevuld → berekenRegelDekking ziet vrij=0 → vals IO-tekort.
    const ongehydrateerd: OrderRegelFormData = {
      artikelnr: '328210010', omschrijving: 'Loranda', orderaantal: 1, te_leveren: 1, korting_pct: 0,
      // vrije_voorraad: bewust afwezig
    }
    expect(berekenRegelDekking(ongehydrateerd).ioTekort).toBe(1)
  })
})
