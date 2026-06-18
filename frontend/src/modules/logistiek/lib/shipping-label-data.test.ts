import { describe, it, expect } from 'vitest'
import { labelProductRegels } from './shipping-label-data'
import type {
  ZendingPrintOrderRegel,
  ZendingPrintRegel,
} from '../queries/zendingen'

// Verzendlabel-productregels (besluit 2026-06-18): voor VASTE-MAAT producten
// toont de grote regel de kwaliteitsnaam + maten (kleinste eerst) en de kleine
// regel de Karpi-code. Maatwerk + onvolledige data vallen terug op het oude
// gedrag (klant-omschrijving / snapshot), zodat pakbon en carrier ongemoeid
// blijven.

function maakOrderRegel(
  overrides: Partial<ZendingPrintOrderRegel> = {},
): ZendingPrintOrderRegel {
  return {
    id: 10,
    order_id: 1,
    regelnummer: 1,
    artikelnr: 'GALA10XX200290',
    omschrijving: null,
    omschrijving_2: null,
    orderaantal: 1,
    te_leveren: 1,
    gewicht_kg: null,
    is_maatwerk: false,
    maatwerk_lengte_cm: null,
    maatwerk_breedte_cm: null,
    maatwerk_afwerking: null,
    maatwerk_kwaliteit_code: null,
    maatwerk_kleur_code: null,
    maatwerk_oppervlak_m2: null,
    producten: null,
    ...overrides,
  }
}

function maakRegel(orderRegel: ZendingPrintOrderRegel | null): ZendingPrintRegel {
  return {
    id: 1,
    order_regel_id: orderRegel?.id ?? null,
    artikelnr: orderRegel?.artikelnr ?? null,
    rol_id: null,
    aantal: 1,
    order_regels: orderRegel,
  }
}

const product = {
  ean_code: null,
  omschrijving: 'GALA10XX200290',
  vervolgomschrijving: null,
  gewicht_kg: null,
  lengte_cm: 200,
  breedte_cm: 290,
  vorm: 'rechthoek' as const,
  karpi_code: 'GALA10XX200290',
  kwaliteit_code: 'GALA',
  kwaliteiten: { omschrijving: 'Galaxy' },
}

describe('labelProductRegels — vaste maat', () => {
  it('toont kwaliteitsnaam + maten (kleinste eerst) groot en Karpi-code klein', () => {
    const regel = maakRegel(maakOrderRegel({ producten: { ...product } }))
    expect(labelProductRegels(regel)).toEqual({
      groot: 'Galaxy 200x290 cm',
      klein: 'GALA10XX200290',
    })
  })

  it('zet de kleinste maat altijd eerst, ongeacht lengte/breedte-volgorde', () => {
    const regel = maakRegel(
      maakOrderRegel({ producten: { ...product, lengte_cm: 290, breedte_cm: 200 } }),
    )
    expect(labelProductRegels(regel).groot).toBe('Galaxy 200x290 cm')
  })

  it('valt voor de kleine regel terug op artikelnr als karpi_code ontbreekt', () => {
    const regel = maakRegel(
      maakOrderRegel({ producten: { ...product, karpi_code: null } }),
    )
    expect(labelProductRegels(regel).klein).toBe('GALA10XX200290')
  })

  it('valt terug op het oude gedrag als de kwaliteitsnaam ontbreekt', () => {
    const regel = maakRegel(
      maakOrderRegel({
        omschrijving: 'EIGEN OMSCHRIJVING',
        producten: { ...product, kwaliteiten: null },
      }),
    )
    // Geen kwaliteit → legacy: klant-omschrijving groot, snapshot/product klein.
    expect(labelProductRegels(regel).groot).toBe('EIGEN OMSCHRIJVING')
  })

  it('valt terug op het oude gedrag als de maat ontbreekt', () => {
    const regel = maakRegel(
      maakOrderRegel({
        omschrijving: 'EIGEN OMSCHRIJVING',
        producten: { ...product, lengte_cm: null, breedte_cm: null },
      }),
    )
    expect(labelProductRegels(regel).groot).toBe('EIGEN OMSCHRIJVING')
  })
})

describe('labelProductRegels — maatwerk + legacy ongewijzigd', () => {
  it('maatwerk gebruikt de bevroren snapshot (oud gedrag)', () => {
    const regel = maakRegel(
      maakOrderRegel({
        is_maatwerk: true,
        maatwerk_kwaliteit_code: 'GALA',
        maatwerk_lengte_cm: 200,
        maatwerk_breedte_cm: 290,
      }),
    )
    const snapshot = {
      omschrijvingSnapshot: 'MAATW. GALAXY 290x200 cm, GALA',
      klantOmschrijvingSnapshot: 'Maatwerk karpet',
    }
    expect(labelProductRegels(regel, snapshot)).toEqual({
      groot: 'Maatwerk karpet',
      klein: 'MAATW. GALAXY 290x200 cm, GALA',
    })
  })

  it('zending zonder orderregel valt terug op snapshot/artikelnr', () => {
    const regel: ZendingPrintRegel = { ...maakRegel(null), artikelnr: 'GALA10XX200290' }
    const snapshot = {
      omschrijvingSnapshot: 'Egyptische Wol 240x330 cm',
      klantOmschrijvingSnapshot: null,
    }
    expect(labelProductRegels(regel, snapshot)).toEqual({
      groot: 'GALA10XX200290',
      klein: 'Egyptische Wol 240x330 cm',
    })
  })
})
