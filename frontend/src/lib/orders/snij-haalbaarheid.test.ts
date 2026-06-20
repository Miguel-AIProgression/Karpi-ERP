import { describe, it, expect } from 'vitest'
import { bepaalSnijDeadline, bepaalHaalbaarheidStatus, berekenHaalbaarheid } from './snij-haalbaarheid'
import { STANDAARD_WERKTIJDEN } from '@/lib/utils/bereken-agenda'

// 16 april 2026 = donderdag (zelfde ankerdatum als werkagenda.test.ts).
const PLANNING_CFG = { logistieke_buffer_dagen: 2, dag_order_snij_buffer_werkdagen: 2 }

describe('bepaalSnijDeadline', () => {
  it('week-order: trekt logistieke_buffer_dagen af', () => {
    // do 23 april − 2 werkdagen = di 21 april.
    expect(bepaalSnijDeadline('2026-04-23', 'week', PLANNING_CFG, STANDAARD_WERKTIJDEN)).toBe('2026-04-21')
  })

  it('dag-order: trekt dag_order_snij_buffer_werkdagen af', () => {
    expect(bepaalSnijDeadline('2026-04-23', 'datum', PLANNING_CFG, STANDAARD_WERKTIJDEN)).toBe('2026-04-21')
  })

  it('verschillende buffers per lever_type geven verschillende deadlines', () => {
    const cfg = { logistieke_buffer_dagen: 5, dag_order_snij_buffer_werkdagen: 2 }
    const weekDeadline = bepaalSnijDeadline('2026-04-23', 'week', cfg, STANDAARD_WERKTIJDEN)
    const dagDeadline = bepaalSnijDeadline('2026-04-23', 'datum', cfg, STANDAARD_WERKTIJDEN)
    expect(weekDeadline).not.toBe(dagDeadline)
  })
})

describe('bepaalHaalbaarheidStatus', () => {
  it('vandaag voorbij de deadline → rood', () => {
    expect(bepaalHaalbaarheidStatus('2026-04-16', '2026-04-17', STANDAARD_WERKTIJDEN)).toBe('rood')
  })

  it('vandaag = deadline → oranje (marge 0, niet rood: nog niet voorbij)', () => {
    expect(bepaalHaalbaarheidStatus('2026-04-16', '2026-04-16', STANDAARD_WERKTIJDEN)).toBe('oranje')
  })

  it('binnen de risico-marge (≤3 werkdagen) → oranje', () => {
    // do 16 → ma 20 = 2 werkdagen marge (17,20; weekend overgeslagen).
    expect(bepaalHaalbaarheidStatus('2026-04-20', '2026-04-16', STANDAARD_WERKTIJDEN)).toBe('oranje')
  })

  it('ruim boven de risico-marge → groen', () => {
    // do 16 → do 23 = 5 werkdagen marge.
    expect(bepaalHaalbaarheidStatus('2026-04-23', '2026-04-16', STANDAARD_WERKTIJDEN)).toBe('groen')
  })

  it('grens: exact 3 werkdagen marge → nog oranje (niet groen)', () => {
    // do 16 → di 21 = 3 werkdagen marge (17,20,21; weekend overgeslagen).
    expect(bepaalHaalbaarheidStatus('2026-04-21', '2026-04-16', STANDAARD_WERKTIJDEN)).toBe('oranje')
  })

  it('grens: 4 werkdagen marge → groen', () => {
    // do 16 → wo 22 = 4 werkdagen marge (17,20,21,22).
    expect(bepaalHaalbaarheidStatus('2026-04-22', '2026-04-16', STANDAARD_WERKTIJDEN, 3)).toBe('groen')
  })
})

describe('berekenHaalbaarheid (samengesteld)', () => {
  it('week-order met ruime marge → groen, met juiste snijDeadline + marge', () => {
    // afleverdatum do 30 april, deadline = -2 werkdagen = wo 28 april.
    // vandaag do 16 april → ruim op tijd.
    const r = berekenHaalbaarheid('2026-04-30', 'week', PLANNING_CFG, STANDAARD_WERKTIJDEN, '2026-04-16')
    expect(r.snijDeadline).toBe('2026-04-28')
    expect(r.status).toBe('groen')
    expect(r.margeWerkdagen).toBeGreaterThan(3)
  })

  it('dag-order die net te laat is → rood', () => {
    const r = berekenHaalbaarheid('2026-04-17', 'datum', PLANNING_CFG, STANDAARD_WERKTIJDEN, '2026-04-20')
    expect(r.status).toBe('rood')
  })
})
