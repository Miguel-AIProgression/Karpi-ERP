import { describe, it, expect } from 'vitest'
import {
  labelProductRegels,
  kwaliteitNaamUitVervolg,
  klantNaamWijktAf,
  vormUitOmschrijving,
} from './shipping-label-data'
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
    maatwerk_band_kleur: null,
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
  vervolgomschrijving: 'GALAXY Kleur 10 CA: 200x290 cm',
  gewicht_kg: null,
  lengte_cm: 200,
  breedte_cm: 290,
  vorm: 'rechthoek' as const,
  kleur_code: '10',
  karpi_code: 'GALA10XX200290',
  locatie: null,
}

describe('labelProductRegels — vaste maat', () => {
  it('toont kwaliteitsnaam + kleurnummer + maten (kleinste eerst) groot en Karpi-code klein', () => {
    const regel = maakRegel(maakOrderRegel({ producten: { ...product } }))
    expect(labelProductRegels(regel)).toEqual({
      groot: 'GALAXY (10) 200x290 cm',
      klein: 'GALA10XX200290',
    })
  })

  it('zet de kleinste maat altijd eerst, ongeacht lengte/breedte-volgorde', () => {
    const regel = maakRegel(
      maakOrderRegel({ producten: { ...product, lengte_cm: 290, breedte_cm: 200 } }),
    )
    expect(labelProductRegels(regel).groot).toBe('GALAXY (10) 200x290 cm')
  })

  it('laat het kleurnummer weg als kleur_code ontbreekt', () => {
    const regel = maakRegel(maakOrderRegel({ producten: { ...product, kleur_code: null } }))
    expect(labelProductRegels(regel).groot).toBe('GALAXY 200x290 cm')
  })

  it('omsticker (mig 436): vervangt de Karpi-code-regel door "OMB: <fysieke code>"', () => {
    const regel = maakRegel(maakOrderRegel({ producten: { ...product } }))
    // Grote regel onveranderd (bestelde kwaliteit + maat), kleine regel = OMB.
    expect(labelProductRegels(regel, null, 'TIFF13XX160230')).toEqual({
      groot: 'GALAXY (10) 200x290 cm',
      klein: 'OMB: TIFF13XX160230',
    })
  })

  it('omsticker leeg/whitespace → ongewijzigd (geen OMB-regel)', () => {
    const regel = maakRegel(maakOrderRegel({ producten: { ...product } }))
    expect(labelProductRegels(regel, null, '  ').klein).toBe('GALA10XX200290')
    expect(labelProductRegels(regel, null, null).klein).toBe('GALA10XX200290')
  })

  it('toont de vorm achteraan als de uitvoering afwijkt (organisch)', () => {
    const regel = maakRegel(
      maakOrderRegel({
        producten: { ...product, vervolgomschrijving: 'GALAXY Kleur 10 CA: 290x200 cm ORGA' },
      }),
    )
    expect(labelProductRegels(regel).groot).toBe('GALAXY (10) 200x290 cm Organisch')
  })

  // Ø (U+00D8) byte-veilig opgebouwd zodat de assert faalt als de bron-code
  // het diameter-teken als mojibake produceert (zie unicode-escape-valkuil).
  const O = String.fromCharCode(0xd8)

  it('toont een rond product met diameter (gelijke L=B) als Ø-maat', () => {
    const regel = maakRegel(
      maakOrderRegel({
        producten: {
          ...product,
          vervolgomschrijving: 'PLUSH Kleur 11 CA: 120 ROND',
          lengte_cm: 120,
          breedte_cm: 120,
          kleur_code: '11',
          karpi_code: 'PLUS11XX120RND',
        },
      }),
    )
    expect(labelProductRegels(regel)).toEqual({
      groot: `PLUSH (11) ${O}120 cm Rond`,
      klein: 'PLUS11XX120RND',
    })
  })

  it('toont een rond product met alleen diameter (breedte 0) als Ø-maat', () => {
    const regel = maakRegel(
      maakOrderRegel({
        producten: {
          ...product,
          vervolgomschrijving: 'RADIUS KLEUR 18 CA: 240 cm ROND Band: NB12',
          lengte_cm: 240,
          breedte_cm: 0,
          kleur_code: '18',
          karpi_code: 'RADI18XX240RND',
        },
      }),
    )
    // breedte 0 zou vroeger naar legacy vallen; nu diameter = grootste maat.
    expect(labelProductRegels(regel).groot).toBe(`RADIUS (18) ${O}240 cm Rond`)
  })

  it('houdt ovaal op de L×B-maat (geen diameter)', () => {
    const regel = maakRegel(
      maakOrderRegel({
        producten: {
          ...product,
          vervolgomschrijving: 'PABLO Kleur 23 CA: 200x290 cm OVAAL',
          lengte_cm: 200,
          breedte_cm: 290,
          kleur_code: '23',
        },
      }),
    )
    expect(labelProductRegels(regel).groot).toBe('PABLO (23) 200x290 cm Ovaal')
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
        producten: { ...product, vervolgomschrijving: null },
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

describe('kwaliteitNaamUitVervolg — parse van vervolgomschrijving', () => {
  // Echte formaat-varianten uit de productdata (oude-systeem-import).
  const gevallen: Array<[string | null, string | null]> = [
    ['GALAXY Kleur 10 CA: 200x290 cm', 'GALAXY'],
    ['ADIVA Kleur 23 CA: 160x230 cm', 'ADIVA'],
    ['PALACE Farbe 11 CA: 080 ROND', 'PALACE'], // Duits "Farbe"
    ['SILVER SPRING Kl.24 CA: 200x290 cm', 'SILVER SPRING'], // afkorting + 2 woorden
    ['VERNISSAGE MIX Kl.22 CA: 120x170 cm', 'VERNISSAGE MIX'],
    ['GALAXY 10 CA: 240x340 cm ORGANIC', 'GALAXY'], // los kleurnummer
    ['MANDA 3726-1V48 CA: 240x330 cm', 'MANDA'], // artikelcode na naam
    ['KARPET ASSORTI CA: 160x230cm BAND: SB', 'KARPET ASSORTI'], // direct CA:
    [null, null],
    ['', null],
    ['123 GEEN NAAM', null], // begint met cijfer → geen naam
  ]
  for (const [invoer, verwacht] of gevallen) {
    it(`"${invoer}" -> ${verwacht === null ? 'null' : `"${verwacht}"`}`, () => {
      expect(kwaliteitNaamUitVervolg(invoer)).toBe(verwacht)
    })
  }
})

describe('vormUitOmschrijving — vorm/uitvoering uit de productomschrijving', () => {
  // Echte staart-varianten uit de productdata (oude-systeem-import),
  // genormaliseerd naar één Nederlandse term.
  const gevallen: Array<[string | null, string | null]> = [
    ['GALAXY Kleur 10 CA: 290x200 cm ORGA', 'Organisch'],
    ['GALAXY 10 CA: 240x340 cm ORGANIC', 'Organisch'],
    ['SOLEIL 10 CA: 160x230 cm ORGANISCH', 'Organisch'],
    ['PLUSH Kleur 11 CA: 120 ROND', 'Rond'],
    ['GUSTAV Farbe 10 CA: 120 RUND', 'Rond'],
    // Kale Karpi-code: "RND" zit vast aan "120" (geen woordgrens) → géén valse
    // positief. In de praktijk leest de label-laag de vervolgomschrijving, niet
    // de code; de code is alleen fallback als vervolgomschrijving leeg is.
    ['PLUS11XX120RND 120x120 cm', null],
    ['PABLO Kleur 23 CA: 200x290 cm OVAAL', 'Ovaal'],
    ['DELICATE Kl.16 CA: 155x230 cm OVAL', 'Ovaal'],
    ['RUBI Kleur 35 CA: 230x160 cm SPECIAL SHAPE', 'Special shape'],
    ['IETS CA: 240 cm HALFROND', 'Halfrond'], // niet als "Rond" lezen
    // Standaard rechthoekig + ruis die GEEN vorm is → null (geen meelift).
    ['PLUSH Kleur 12 CA: 160x230 cm', null],
    ['DESSIN Kleur 8 CA: 200x290 cm SPLASH', null],
    ['KLEURIG Kleur 8 CA: 200x290 cm SILVER', null],
    [null, null],
    ['', null],
  ]
  for (const [invoer, verwacht] of gevallen) {
    it(`"${invoer}" -> ${verwacht === null ? 'null' : `"${verwacht}"`}`, () => {
      expect(vormUitOmschrijving(invoer)).toBe(verwacht)
    })
  }
})

describe('klantNaamWijktAf — pakbon "Uw naam"-zichtbaarheid', () => {
  // Echte gevallen uit de GERO-pakbon (ZR-NR 116000): de hoofdregel is de
  // Karpi-omschrijving + maat, "Uw naam" is order_regels.omschrijving zónder maat.
  it('verbergt als de klant-naam de hoofdregel mín de maat is (uitgeschreven)', () => {
    expect(
      klantNaamWijktAf(
        'GALAXY Kleur 10 CA: 290x200 cm ORGA 200x290 cm',
        'GALAXY Kleur 10 CA: 290x200 cm ORGA',
        'GALA10XX200290',
      ),
    ).toBe(false)
  })

  it('verbergt als de klant-naam de Karpi-code is (hoofdregel = code + maat)', () => {
    expect(klantNaamWijktAf('PLUS11XX120RND 120x120 cm', 'PLUS11XX120RND', 'PLUS11XX120RND')).toBe(
      false,
    )
  })

  it('verbergt als de klant-naam exact het artikelnummer is, ongeacht de hoofdregel', () => {
    expect(klantNaamWijktAf('Heel andere omschrijving', 'PLUS11XX120RND', 'PLUS11XX120RND')).toBe(
      false,
    )
  })

  it('toont als de klant een echte afwijkende eigen benaming heeft', () => {
    expect(
      klantNaamWijktAf('GALAXY Kleur 10 200x290 cm', 'BREDA HUISMERK', 'GALA10XX200290'),
    ).toBe(true)
  })

  it('verbergt bij lege/whitespace klant-naam en is whitespace-tolerant', () => {
    expect(klantNaamWijktAf('GALAXY 200x290 cm', '', 'X')).toBe(false)
    expect(klantNaamWijktAf('GALAXY 200x290 cm', '   ', 'X')).toBe(false)
    expect(klantNaamWijktAf('GALAXY   200x290 cm', 'galaxy 200x290 cm', null)).toBe(false)
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
