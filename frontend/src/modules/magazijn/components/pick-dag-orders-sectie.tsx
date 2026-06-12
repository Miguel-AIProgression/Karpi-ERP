// Top-sectie voor dag-orders (`lever_type='datum'`, ADR 0014). Verschijnt
// bovenaan Pick & Ship omdat dag-orders een specifieke afleverdag beloven
// (i.t.t. de "ergens in de week"-default voor B2B). De magazijnier moet ze
// in één oogopslag los kunnen lezen van de week-buckets eronder.
//
// Visueel:
//  - prominente terracotta kop met kalender-icoon + "Op leverdatum" + telling
//  - dezelfde land-groepering en bundel-clustering als PickWeekSectie (zodat
//    twee dag-orders op hetzelfde adres + vervoerder + ISO-week één bundel
//    blijven vormen)
//  - orders gesorteerd op afleverdatum ASC vóór clustering — meest urgente
//    datum bovenaan binnen elk klant-cluster
//
// Dag-orders verschijnen pas 1 werkdag vóór afleverdatum in Pick & Ship
// (zie CLAUDE.md / mig 244), dus in de praktijk valt deze sectie meestal
// samen met de eerstvolgende verzendweek.
import { CalendarDays } from 'lucide-react'
import { KlantClusterBlok } from './klant-cluster-blok'
import { StartPickrondesButton } from '@/modules/logistiek'
import type { VoorgesteldeBundel } from '@/modules/logistiek/queries/voorgestelde-bundels'
import {
  clusterOrdersOpKlant,
  groepeerOrdersOpLand,
  type LandGroep,
} from '../lib/groeperen'
import type { PickShipOrder } from '../lib/types'

interface Props {
  orders: PickShipOrder[]
  groepeerOpLand: boolean
  voorgesteldeBundels: VoorgesteldeBundel[]
  /** Order-ids die niet startbaar zijn ("Geen vervoerder mogelijk") —
   *  sorteren onder de startbare orders binnen deze sectie. */
  geblokkeerdeOrderIds?: Set<number>
}

export function PickDagOrdersSectie({
  orders,
  groepeerOpLand,
  voorgesteldeBundels,
  geblokkeerdeOrderIds,
}: Props) {
  const bundelByOrderId = new Map<number, VoorgesteldeBundel>()
  const sleutelByOrderId = new Map<number, string>()
  for (const b of voorgesteldeBundels) {
    for (const oid of b.order_ids) {
      bundelByOrderId.set(oid, b)
      sleutelByOrderId.set(oid, b.sleutel)
    }
  }
  for (const o of orders) {
    if (o.actieve_pickronde) {
      sleutelByOrderId.set(o.order_id, `actief:${o.actieve_pickronde.zending_id}`)
    }
  }

  // Sorteer op afleverdatum ASC zodat de meest urgente datum bovenaan
  // staat binnen elk klant-cluster.
  const gesort = [...orders].sort((a, b) => {
    const ad = a.afleverdatum ?? '9999-12-31'
    const bd = b.afleverdatum ?? '9999-12-31'
    return ad.localeCompare(bd) || a.order_nr.localeCompare(b.order_nr)
  })

  const groepen: LandGroep[] = groepeerOpLand
    ? groepeerOrdersOpLand(gesort, sleutelByOrderId, geblokkeerdeOrderIds)
    : [{ iso2: null, vlag: null, clusters: clusterOrdersOpKlant(gesort, sleutelByOrderId, geblokkeerdeOrderIds) }]

  return (
    <section className="rounded-[var(--radius)] border-2 border-terracotta-400 bg-terracotta-50/40 p-3">
      <h3 className="flex flex-wrap items-center gap-2 mb-3 px-1 text-sm font-semibold">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-terracotta-500 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
          <CalendarDays size={13} />
          Op leverdatum
        </span>
        <span className="text-terracotta-700">
          Specifieke afleverdag — voorrang vóór wekelijkse buckets
        </span>
        <span className="text-slate-500 font-normal">({orders.length})</span>
      </h3>

      <div className="space-y-4">
        {groepen.map((groep, i) => {
          const ordersInLand = groep.clusters.flatMap((c) => c.orders)
          return (
            <div key={groep.iso2 ?? `none-${i}`} className="space-y-3">
              {groepeerOpLand && (
                <div className="flex items-center justify-between gap-2 px-1">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {groep.vlag && <span aria-hidden>{groep.vlag}</span>}
                    <span>{groep.iso2 ?? 'Onbekend land'}</span>
                    <span className="font-normal text-slate-400">
                      ({ordersInLand.length})
                    </span>
                  </h4>
                  <StartPickrondesButton
                    orders={ordersInLand}
                    context={`voor ${groep.iso2 ?? 'onbekend land'}`}
                  />
                </div>
              )}
              {groep.clusters.map((cluster) => {
                const eersteId = cluster.orders[0]?.order_id
                const bundel = eersteId !== undefined
                  ? bundelByOrderId.get(eersteId) ?? null
                  : null
                return (
                  <KlantClusterBlok
                    key={`${groep.iso2 ?? 'none'}-${cluster.debiteur_nr}-${eersteId}`}
                    cluster={cluster}
                    bundel={bundel}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </section>
  )
}
