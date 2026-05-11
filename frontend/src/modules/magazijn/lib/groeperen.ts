// Pure helpers voor de pick-week-sectie: orders binnen één pick-week clusteren
// op de 4D bundel-sleutel (debiteur × adres × vervoerder × week) en (optioneel)
// eerst splitsen op land. Geen rendering-logica hier — dat hoort in de
// PickWeekSectie-component thuis.
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
 * Clustert orders op de **bundel-sleutel** uit `voorgestelde_zending_bundels`
 * (mig 229). Orders die in dezelfde bundel zitten (zelfde debiteur × adres ×
 * effectieve vervoerder × verzendweek) krijgen één cluster en mogen in de UI
 * een BUNDEL-wrapper krijgen. Orders zonder bundel-entry (geen afleverdatum,
 * actieve zending, etc.) krijgen elk een eigen solo-cluster.
 *
 * Belangrijk: we clusteren NIET meer puur op `debiteur_nr`. Twee orders van
 * dezelfde klant met verschillende vervoerders zijn fysiek twee transport-
 * bewegingen → twee zendingen → twee verzendkosten-regels (mig 232). De UI
 * moet dat ook zo tonen, anders suggereert de BUNDEL-header een gezamenlijke
 * verzending die er niet komt.
 *
 * Sortering blijft op `(klant_naam, order_nr)` zodat clusters van dezelfde
 * klant visueel naast elkaar blijven staan, ook als ze niet bundelen.
 */
export function clusterOrdersOpKlant(
  orders: PickShipOrder[],
  bundelSleutelByOrderId?: Map<number, string>,
): KlantCluster[] {
  const gesort = [...orders].sort((a, b) => {
    const k = a.klant_naam.localeCompare(b.klant_naam)
    if (k !== 0) return k
    return a.order_nr.localeCompare(b.order_nr)
  })
  const byKey = new Map<string, KlantCluster>()
  const volgorde: string[] = []
  for (const o of gesort) {
    const bundleKey = bundelSleutelByOrderId?.get(o.order_id)
    // Bundel-sleutel is uniek per (debiteur × adres × vervoerder × week).
    // Solo-fallback per order_id zodat orders zonder bundle-entry elk in een
    // eigen cluster vallen — nooit kruislings gemengd met andere klanten.
    const key = bundleKey ? `bundle:${bundleKey}` : `solo:${o.order_id}`
    let cluster = byKey.get(key)
    if (!cluster) {
      cluster = {
        debiteur_nr: o.debiteur_nr,
        klant_naam: o.klant_naam,
        orders: [],
      }
      byKey.set(key, cluster)
      volgorde.push(key)
    }
    cluster.orders.push(o)
  }
  return volgorde.map((k) => byKey.get(k)!)
}

/**
 * Splitst orders eerst per land (genormaliseerd via `landNaarIso2`), en
 * clustert binnen elk land op de bundel-sleutel. Onbekende landen vallen
 * onder iso2=null en sorteren achteraan. ISO-2-codes alfabetisch — geen
 * NL-eerst-bias, want de magazijnier kan ook 100% NL-dag hebben en dan is
 * het overbodig.
 */
export function groepeerOrdersOpLand(
  orders: PickShipOrder[],
  bundelSleutelByOrderId?: Map<number, string>,
): LandGroep[] {
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
        clusters: clusterOrdersOpKlant(map.get(key)!, bundelSleutelByOrderId),
      }
    })
}
