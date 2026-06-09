import { describe, it, expect } from 'vitest'
import { wijsVerzendNaarDuurste } from '../split-order'

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
