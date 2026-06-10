// Pure orkestratie van de handmatige order-aanmaak ("Order-commit", zie
// CONTEXT.md): dekking → split-keuze → verzend-toewijzing → lever_modus →
// lijst van aan te maken orders. Geëxtraheerd uit saveMutation.mutationFn
// (order-form.tsx) met strikt gedragsbehoud — golden fixtures in
// __tests__/order-commit.fixtures.ts pinnen het gedrag, inclusief bewuste
// eigenaardigheden (IO-sub-orders krijgen 'in_een_keer'; verzend-tie → deel A).
// Geen React, geen I/O: de maatwerk-seam-datum (check-levertijd) komt als
// input mee, de caller voert het plan uit (createOrder per order).
import type { OrderFormData, OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import type { LeverModus } from '@/modules/reserveringen'
import type { AfleverdatumResult } from '@/lib/utils/afleverdatum'
// Bewust het diepe pad, niet de barrel '@/modules/reserveringen': die trekt
// React-componenten + Supabase-client de (test-)runtime-graph in.
import { berekenRegelDekking } from '@/modules/reserveringen/lib/dekking-preview'
import { wijsVerzendNaarDuurste, splitRegelOpDekking } from './split-order'
import { verzendWeekVoor } from './verzendweek'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'

export interface OrderCommitInput {
  regels: OrderRegelFormData[]
  header: Partial<OrderFormData>
  debiteurNr: number
  afhalen: boolean
  /** Stand van de "Deelleveringen"-checkbox (gemengde standaard/maatwerk-split). */
  deelleveringen: boolean
  /** Keuze uit de LeverModusDialog; wint van header.lever_modus. */
  overrideLeverModus?: LeverModus
  afleverdatumInfo: AfleverdatumResult
  /**
   * Vooraf door de caller bepaald via berekenMaatwerkAfleverdatumViaSeam
   * (issue #33) — alléén relevant (en alléén op te halen) wanneer
   * isGemengdeSplit(...) true is. null = terugvallen op header-afleverdatum.
   */
  echteMaatwerkDatum: string | null
}

export interface OrderCommitOrder {
  header: OrderFormData
  regels: OrderRegelFormData[]
  /** Moet de caller ná createOrder triggerAutoplanForMaatwerk op deze regels aanroepen? */
  triggerAutoplan: boolean
}

export interface OrderCommitPlan {
  /** 1 order (geen split) of 2 ([standaard/direct, maatwerk/IO] — die volgorde). */
  orders: OrderCommitOrder[]
  gesplitst: boolean
}

/**
 * Enige bron-van-waarheid voor de gemengde-split-beslissing — de caller
 * gebruikt dit óók om te bepalen of de maatwerk-seam-datum opgehaald moet
 * worden (I/O die buiten deze pure module blijft).
 */
export function isGemengdeSplit(deelleveringen: boolean, heeftGemengd: boolean): boolean {
  return deelleveringen && heeftGemengd
}

function getISOWeek(dateStr: string): number {
  return verzendWeekVoor(dateStr)?.week ?? 0
}

export function bouwOrderCommit(input: OrderCommitInput): OrderCommitPlan {
  const {
    regels, header, debiteurNr, afhalen, deelleveringen,
    overrideLeverModus, afleverdatumInfo, echteMaatwerkDatum,
  } = input

  const headerWithModus: Partial<OrderFormData> = overrideLeverModus
    ? { ...header, lever_modus: overrideLeverModus, afhalen }
    : { ...header, afhalen }
  const orderData: OrderFormData = { ...headerWithModus, debiteur_nr: debiteurNr }

  // Split-order flow: deelleveringen AAN + gemengde order (standaard + maatwerk)
  if (isGemengdeSplit(deelleveringen, afleverdatumInfo.heeftGemengd)) {
    const shippingRegel = regels.find(r => r.artikelnr === SHIPPING_PRODUCT_ID)
    const standaardRegels = regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID && !r.is_maatwerk)
    const maatwerkRegels = regels.filter(r => r.artikelnr !== SHIPPING_PRODUCT_ID && r.is_maatwerk)

    const standaardOrder: OrderFormData = {
      ...orderData,
      afleverdatum: afleverdatumInfo.standaardDatum ?? orderData.afleverdatum,
      week: afleverdatumInfo.standaardDatum
        ? String(getISOWeek(afleverdatumInfo.standaardDatum))
        : orderData.week,
    }
    const maatwerkOrder: OrderFormData = {
      ...orderData,
      afleverdatum: echteMaatwerkDatum ?? orderData.afleverdatum,
      week: echteMaatwerkDatum ? String(getISOWeek(echteMaatwerkDatum)) : orderData.week,
    }

    // Issue #33: verzendkosten naar de duurste sub-order (tie → deel A).
    const { deelA, deelB } = wijsVerzendNaarDuurste(standaardRegels, maatwerkRegels, shippingRegel)

    return {
      gesplitst: true,
      orders: [
        { header: standaardOrder, regels: deelA, triggerAutoplan: false },
        { header: maatwerkOrder, regels: deelB, triggerAutoplan: true },
      ],
    }
  }

  // IO-split flow: lever_modus=deelleveringen + ≥1 regel met IO-tekort.
  const effectieveModus = overrideLeverModus ?? headerWithModus.lever_modus
  const heeftIoTekort = regels.some(r => berekenRegelDekking(r).ioTekort > 0)

  if (effectieveModus === 'deelleveringen' && heeftIoTekort) {
    const directeRegels: OrderRegelFormData[] = []
    const ioRegels: OrderRegelFormData[] = []
    let shippingRegel: OrderRegelFormData | null = null

    for (const r of regels) {
      if (r.artikelnr === SHIPPING_PRODUCT_ID) {
        shippingRegel = r // pas later toewijzen aan duurste deel (issue #33)
        continue
      }
      const { directeRegel, ioRegel } = splitRegelOpDekking(r, berekenRegelDekking(r))
      if (directeRegel) directeRegels.push(directeRegel)
      if (ioRegel) ioRegels.push(ioRegel)
    }

    const verdeeld = wijsVerzendNaarDuurste(directeRegels, ioRegels, shippingRegel)

    // Sub-orders bewust op 'in_een_keer' — bestaand gedrag, gepind in fixtures.
    // De IO-order hangt aan de IO-leverdatum (mig 153 zet afleverdatum vooruit).
    return {
      gesplitst: true,
      orders: [
        { header: { ...orderData, lever_modus: 'in_een_keer' }, regels: verdeeld.deelA, triggerAutoplan: true },
        { header: { ...orderData, lever_modus: 'in_een_keer' }, regels: verdeeld.deelB, triggerAutoplan: false },
      ],
    }
  }

  return {
    gesplitst: false,
    orders: [{ header: orderData, regels, triggerAutoplan: true }],
  }
}
