import { describe, it, expect } from 'vitest'
import { wijsVerzendNaarDuurste, splitRegelOpDekking } from '../split-order'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

type R = { artikelnr: string; bedrag: number | null }

describe('wijsVerzendNaarDuurste', () => {
  const shipping: R = { artikelnr: 'VERZEND', bedrag: 10 }

  it('voegt verzend toe aan deelB als deelB duurder is', () => {
    const a: R[] = [{ artikelnr: 'A', bedrag: 100 }]
    const b: R[] = [{ artikelnr: 'B', bedrag: 200 }]
    const r = wijsVerzendNaarDuurste(a, b, shipping)
    expect(r.deelA).toEqual(a)
    expect(r.deelB).toEqual([...b, shipping])
  })

  it('voegt verzend toe aan deelA bij gelijke totalen (tie → deelA)', () => {
    const a: R[] = [{ artikelnr: 'A', bedrag: 100 }]
    const b: R[] = [{ artikelnr: 'B', bedrag: 100 }]
    const r = wijsVerzendNaarDuurste(a, b, shipping)
    expect(r.deelA).toEqual([...a, shipping])
    expect(r.deelB).toEqual(b)
  })

  it('laat beide delen ongemoeid als er geen verzendregel is', () => {
    const a: R[] = [{ artikelnr: 'A', bedrag: 100 }]
    const b: R[] = [{ artikelnr: 'B', bedrag: 200 }]
    const r = wijsVerzendNaarDuurste(a, b, null)
    expect(r.deelA).toEqual(a)
    expect(r.deelB).toEqual(b)
  })

  it('behandelt null-bedragen als 0', () => {
    const a: R[] = [{ artikelnr: 'A', bedrag: null }]
    const b: R[] = [{ artikelnr: 'B', bedrag: null }]
    const r = wijsVerzendNaarDuurste(a, b, shipping)
    expect(r.deelA).toEqual([...a, shipping]) // tie (0 == 0) → deelA
  })
})

describe('splitRegelOpDekking', () => {
  const basis: OrderRegelFormData = { artikelnr: 'A', omschrijving: 'A', prijs: 100, korting_pct: 0, orderaantal: 10, te_leveren: 10, bedrag: 1000 }

  it('volledig gedekt (ioTekort 0) → alleen directeRegel, ongewijzigd', () => {
    const r = splitRegelOpDekking(basis, { direct: 7, uitwisselbaar: 3, ioTekort: 0 })
    expect(r.directeRegel).toEqual(basis)
    expect(r.ioRegel).toBeNull()
  })

  it('volledig op IO (directDeel 0) → alleen ioRegel, keuzes geleegd', () => {
    const r = splitRegelOpDekking({ ...basis, uitwisselbaar_keuzes: [{ artikelnr: 'X', aantal: 1 }] }, { direct: 0, uitwisselbaar: 0, ioTekort: 10 })
    expect(r.directeRegel).toBeNull()
    expect(r.ioRegel?.orderaantal).toBe(10)
    expect(r.ioRegel?.uitwisselbaar_keuzes).toEqual([])
  })

  it('gemengd → splitst aantallen en herberekent bedrag proportioneel', () => {
    // direct=6 (4 voorraad + 2 uitwissel), ioTekort=4, prijs 100, 0% korting
    const r = splitRegelOpDekking(basis, { direct: 4, uitwisselbaar: 2, ioTekort: 4 })
    expect(r.directeRegel?.orderaantal).toBe(6)
    expect(r.directeRegel?.te_leveren).toBe(6)
    expect(r.directeRegel?.bedrag).toBe(600)
    expect(r.ioRegel?.orderaantal).toBe(4)
    expect(r.ioRegel?.bedrag).toBe(400)
    expect(r.ioRegel?.id).toBeUndefined()
  })

  it('past korting toe in de bedrag-herberekening', () => {
    const r = splitRegelOpDekking({ ...basis, korting_pct: 10 }, { direct: 5, uitwisselbaar: 0, ioTekort: 5 })
    expect(r.directeRegel?.bedrag).toBe(450) // 100 * 5 * 0.9
    expect(r.ioRegel?.bedrag).toBe(450)
  })
})
