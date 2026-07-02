import { describe, it, expect } from 'vitest'
import { combiWachtReden, combiWachtRedenVoorOrder } from './combi-levering-badge'
import type { CombiWachtRedenVelden } from './combi-levering-badge'
import { formatCurrency } from '@/lib/utils/formatters'

// Mig 576: pure wacht-reden-helper achter CombiWachtRedenLine. Getest zonder
// component-rendering — puur de tekst-afleiding uit (subtotaal, drempel,
// alle_leden_pickbaar), spiegelt combi_levering_status z'n SQL-logica.
// Verwachte teksten worden via formatCurrency zelf opgebouwd (i.p.v. de
// bedragen letterlijk uit te schrijven) omdat Intl.NumberFormat een
// non-breaking space (U+00A0) na het €-teken zet — een letterlijke spatie in
// de test zou stil mismatchen.
describe('combiWachtReden', () => {
  it('onder de drempel: toont subtotaal, drempel en het exacte tekort', () => {
    expect(combiWachtReden(250.68, 300, true)).toBe(
      `${formatCurrency(250.68)} van ${formatCurrency(300)} — nog ${formatCurrency(49.32)} nodig`
    )
  })

  it('drempel gehaald maar niet alle leden pickbaar: toont subtotaal + wacht-op-groep-tekst', () => {
    expect(combiWachtReden(525.26, 500, false)).toBe(
      `Drempel gehaald (${formatCurrency(525.26)}) — wacht tot alle orders van de groep leverbaar zijn`
    )
  })

  it('beide condities falen (onder drempel én niet alle leden pickbaar): de drempel-tekst wint (primaire reden)', () => {
    expect(combiWachtReden(120, 300, false)).toBe(
      `${formatCurrency(120)} van ${formatCurrency(300)} — nog ${formatCurrency(180)} nodig`
    )
  })

  it('geen drempel op de debiteur → valt terug op € 500 (mirrort combi_levering_status COALESCE)', () => {
    expect(combiWachtReden(250, null, true)).toBe(
      `${formatCurrency(250)} van ${formatCurrency(500)} — nog ${formatCurrency(250)} nodig`
    )
  })

  it('drempel gehaald én alle leden pickbaar: niets te melden (null) — groep is leverbaar', () => {
    expect(combiWachtReden(525.26, 500, true)).toBeNull()
  })

  it('geen subtotaal (order niet in een groep): null', () => {
    expect(combiWachtReden(null, 500, true)).toBeNull()
  })
})

// De order-niveau gate: wacht_op_combi_levering (alleen gevuld bij groepen
// ≥ 2, pre-576-semantiek) ÓF status 'Wacht op combi-levering' — de laatste
// dekt de solo wachtende order (aantal_orders=1, geen badge, geen wacht-vlag
// in de view, wél reden-velden sinds mig 576).
function orderVelden(over: Partial<CombiWachtRedenVelden> = {}): CombiWachtRedenVelden {
  return {
    status: 'Nieuw',
    wacht_op_combi_levering: null,
    combi_levering_groep_subtotaal: null,
    combi_levering_drempel: null,
    combi_levering_alle_leden_pickbaar: null,
    ...over,
  }
}

describe('combiWachtRedenVoorOrder', () => {
  it('solo wachtende order (aantal=1: geen wacht-vlag, wél status + reden-velden) → reden-regel zichtbaar', () => {
    expect(
      combiWachtRedenVoorOrder(
        orderVelden({
          status: 'Wacht op combi-levering',
          wacht_op_combi_levering: null, // view vult de vlag pas bij ≥ 2 leden
          combi_levering_groep_subtotaal: 103.97,
          combi_levering_drempel: 300,
          combi_levering_alle_leden_pickbaar: true,
        })
      )
    ).toBe(`${formatCurrency(103.97)} van ${formatCurrency(300)} — nog ${formatCurrency(196.03)} nodig`)
  })

  it('groep ≥ 2 met wacht-vlag maar afwijkende status (bv. Wacht op inkoop wint in de status-afleiding) → reden-regel zichtbaar', () => {
    expect(
      combiWachtRedenVoorOrder(
        orderVelden({
          status: 'Wacht op inkoop',
          wacht_op_combi_levering: true,
          combi_levering_groep_subtotaal: 525.26,
          combi_levering_drempel: 500,
          combi_levering_alle_leden_pickbaar: false,
        })
      )
    ).toBe(
      `Drempel gehaald (${formatCurrency(525.26)}) — wacht tot alle orders van de groep leverbaar zijn`
    )
  })

  it('niet wachtend (geen vlag, andere status): null — ook al zijn de reden-velden gevuld', () => {
    expect(
      combiWachtRedenVoorOrder(
        orderVelden({
          status: 'Nieuw',
          combi_levering_groep_subtotaal: 103.97,
          combi_levering_drempel: 300,
        })
      )
    ).toBeNull()
  })
})
