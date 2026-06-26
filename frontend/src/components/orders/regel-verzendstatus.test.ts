import { describe, it, expect, vi } from 'vitest'
// De pure helper deelt zijn bestand met de query-hook (supabase-client). Mock de
// client zodat de env-var-check bij module-load de test niet blokkeert.
vi.mock('@/lib/supabase/client', () => ({ supabase: {} }))
import { bepaalRegelVerzendStatus } from './regel-verzendstatus'
import type { OrderRegel } from '@/lib/supabase/queries/orders'

// Minimale orderregel; alleen de velden die de status-helper leest.
function regel(over: Partial<OrderRegel> = {}): OrderRegel {
  return { id: 1, regelnummer: 1, artikelnr: 'P-1', karpi_code: null, omschrijving: 'x',
    omschrijving_2: null, orderaantal: 2, te_leveren: 2, backorder: 0, prijs: 0,
    korting_pct: 0, bedrag: 0, gewicht_kg: 0, vrije_voorraad: 0, ...over }
}

describe('bepaalRegelVerzendStatus', () => {
  it('open manco wint van alles (ook van een verzonden aantal)', () => {
    expect(bepaalRegelVerzendStatus(regel({ pick_backorder_sinds: '2026-06-26' }), 2, true)).toBe('manco')
  })

  it('afgesloten manco (geannuleerd) → niet_leverbaar', () => {
    expect(bepaalRegelVerzendStatus(
      regel({ pick_backorder_sinds: '2026-06-26', pick_backorder_geannuleerd_op: '2026-06-26' }), 0, true,
    )).toBe('niet_leverbaar')
  })

  it('volledig verzonden → verzonden', () => {
    expect(bepaalRegelVerzendStatus(regel({ orderaantal: 2 }), 2, true)).toBe('verzonden')
  })

  it('deels verzonden → deels_verzonden', () => {
    expect(bepaalRegelVerzendStatus(regel({ orderaantal: 3 }), 1, true)).toBe('deels_verzonden')
  })

  it('niets verzonden + order al deels de deur uit → nog_te_verzenden', () => {
    expect(bepaalRegelVerzendStatus(regel(), 0, true)).toBe('nog_te_verzenden')
  })

  it('niets verzonden + gewone open order → geen badge (null)', () => {
    expect(bepaalRegelVerzendStatus(regel(), 0, false)).toBeNull()
  })
})
