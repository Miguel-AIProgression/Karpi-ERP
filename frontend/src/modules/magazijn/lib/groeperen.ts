// Pure helpers voor de pick-week-sectie: orders binnen één pick-week clusteren
// op klant en (optioneel) eerst splitsen op land. Geen rendering-logica hier —
// dat hoort in de PickWeekSectie-component thuis.
import { iso2NaarVlag, landNaarIso2 } from '@/lib/utils/land-vlag'
import type { PickShipOrder } from './types'

export interface KlantCluster {
  debiteur_nr: number
  klant_naam: string
  orders: PickShipOrder[]
}

export interface LandGroep {
  /** ISO-2 of null als het land onbekend is. */
  iso2: string | null
  /** Vlag-emoji (null bij onbekend land). */
  vlag: string | null
  /** Klant-clusters binnen dit land, gesorteerd. */
  clusters: KlantCluster[]
}

/**
 * Sorteert orders op `(klant_naam, order_nr)` en bundelt aaneengesloten
 * dezelfde-debiteur-orders in één cluster. Resultaat: orders naar dezelfde
 * klant staan altijd bij elkaar — gewoon door de sortering, geen extra UX-
 * koppeling nodig. Een cluster met één order is gewoon één order; de UI
 * mag besluiten of er een wrapper omheen moet.
 */
export function clusterOrdersOpKlant(orders: PickShipOrder[]): KlantCluster[] {
  const gesort = [...orders].sort((a, b) => {
    const k = a.klant_naam.localeCompare(b.klant_naam)
    if (k !== 0) return k
    return a.order_nr.localeCompare(b.order_nr)
  })
  const clusters: KlantCluster[] = []
  for (const o of gesort) {
    const laatste = clusters[clusters.length - 1]
    if (laatste && laatste.debiteur_nr === o.debiteur_nr) {
      laatste.orders.push(o)
    } else {
      clusters.push({
        debiteur_nr: o.debiteur_nr,
        klant_naam: o.klant_naam,
        orders: [o],
      })
    }
  }
  return clusters
}

/**
 * Splitst orders eerst per land (genormaliseerd via `landNaarIso2`), en
 * clustert binnen elk land op klant. Onbekende landen vallen onder iso2=null
 * en sorteren achteraan. ISO-2-codes alfabetisch — geen NL-eerst-bias, want
 * de magazijnier kan ook 100% NL-dag hebben en dan is het overbodig.
 */
export function groepeerOrdersOpLand(orders: PickShipOrder[]): LandGroep[] {
  const map = new Map<string, PickShipOrder[]>()
  const ONBEKEND_KEY = '￿XX' // Sleutel die altijd achteraan sorteert.
  for (const o of orders) {
    const iso = landNaarIso2(o.afl_land)
    const key = iso ?? ONBEKEND_KEY
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(o)
  }
  return Array.from(map.keys())
    .sort((a, b) => a.localeCompare(b))
    .map((key) => {
      const iso2 = key === ONBEKEND_KEY ? null : key
      return {
        iso2,
        vlag: iso2 ? iso2NaarVlag(iso2) : null,
        clusters: clusterOrdersOpKlant(map.get(key)!),
      }
    })
}
