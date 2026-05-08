// Cluster pickbare orders binnen één klant op (genormaliseerd afleveradres,
// vervoerder). Orders met identieke combinatie eindigen in één bundel; de
// rest blijft solo. De backend-RPC `start_pickronde_bundel` verwacht exact
// deze garanties: zelfde debiteur (door de klant-cluster heen), zelfde
// adres-match-key, zelfde vervoerder, zelfde verzendweek (mig 230).
//
// Adres-normalisatie loopt via `normaliseerAdresKey` (gedeelde util,
// 1-op-1 spiegel van SQL `_normaliseer_afleveradres`). Verzendweek is hier
// impliciet (de UI-pagina groepeert al per week-sectie); voor de explicit
// 4D-bundel-sleutel gebruik je `bundelSleutel` uit `lib/orders/bundel-sleutel`.
import type { PickShipOrder } from './types'
import { normaliseerAdresKey } from '@/lib/orders/normaliseer-adres'

/** Minimale vervoerder-resolutie per order voor cluster-doeleinden. */
export interface ResolvedVervoerder {
  /** Effectieve vervoerder-code, of `null` als geen (incl. afhalen). */
  code: string | null
  /** TRUE als order op afhalen staat — geen vervoerder maar wel een filter-keuze. */
  afhalen: boolean
}

export interface BundelCluster {
  /** Match-sleutel voor groepering: `${vervoerder}::${adres-key}`. */
  sleutel: string
  /** ≥2 orders → bundelen wordt geactiveerd; bij 1 order valt RPC terug op solo. */
  isBundel: boolean
  /** Gemeenschappelijk vervoerder-label voor UI/tooltip ('AFHAAL' / code / 'GEEN'). */
  vervoerderLabel: string
  /** Normalised adres-snippet voor tooltip. */
  adresLabel: string
  orders: PickShipOrder[]
}

function vervoerderSleutel(v: ResolvedVervoerder | undefined): string {
  if (!v) return 'GEEN'
  if (v.afhalen) return 'AFHAAL'
  return v.code ?? 'GEEN'
}

/**
 * Groepeer orders op (vervoerder × afleveradres). Bedoeld voor binnen één
 * klant-cluster; de caller is verantwoordelijk voor de debiteur-grens. Bundels
 * (≥2 orders) komen eerst in de output zodat de UI ze visueel kan markeren
 * vóór solo-orders.
 */
export function clusterOpAdresEnVervoerder(
  orders: PickShipOrder[],
  vervoerderMap: Map<number, ResolvedVervoerder>,
): BundelCluster[] {
  const map = new Map<string, BundelCluster>()
  for (const o of orders) {
    const v = vervoerderMap.get(o.order_id)
    const vSleutel = vervoerderSleutel(v)
    const adresKey = normaliseerAdresKey(o)
    const sleutel = `${vSleutel}::${adresKey}`
    let cl = map.get(sleutel)
    if (!cl) {
      cl = {
        sleutel,
        isBundel: false,
        vervoerderLabel: vSleutel,
        adresLabel: [o.afl_postcode, o.afl_plaats].filter(Boolean).join(' ') || '—',
        orders: [],
      }
      map.set(sleutel, cl)
    }
    cl.orders.push(o)
  }
  for (const cl of map.values()) cl.isBundel = cl.orders.length > 1
  return Array.from(map.values()).sort((a, b) => {
    if (a.isBundel !== b.isBundel) return a.isBundel ? -1 : 1
    return a.sleutel.localeCompare(b.sleutel)
  })
}
