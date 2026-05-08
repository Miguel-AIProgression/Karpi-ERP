// Eén pick-week-sectie op de Pick & Ship-overview. Verantwoordelijk voor:
//   1. Sectie-kop ("Te picken in week N · Verzendweek M [achterstallig?]"),
//   2. Optionele land-subsecties als de gebruiker "Groeperen op land" aanzet,
//   3. Klant-clustering (orders met dezelfde debiteur_nr altijd bij elkaar),
//   4. Bulk-stickers-knop op klant-cluster en (bij toggle) op land-niveau.
//
// De pagina beslist welke orders bij deze sectie horen en óf de land-toggle
// aan staat — hier alleen het rangschikken + renderen.
import { Layers } from 'lucide-react'
import { OrderPickCard } from './order-pick-card'
import { BulkVerzendsetButton } from '@/modules/logistiek'
import {
  clusterOrdersOpKlant,
  groepeerOrdersOpLand,
  type KlantCluster,
  type LandGroep,
} from '../lib/groeperen'
import type { PickShipOrder } from '../lib/types'
import type { PickStatus } from '@/lib/orders/verzendweek'
import { cn } from '@/lib/utils/cn'

interface Props {
  orders: PickShipOrder[]
  /** Pick-week-nummer voor de kop ("Te picken in week N"); null = geen datum. */
  pickWeek: number | null
  /** Verzendweek voor de pill in de kop; null = geen datum. */
  verzendWeek: number | null
  status: PickStatus
  /** Toggle: split orders eerst op land vóór de klant-clustering. */
  groepeerOpLand: boolean
}

export function PickWeekSectie({
  orders,
  pickWeek,
  verzendWeek,
  status,
  groepeerOpLand,
}: Props) {
  const achterstallig = status === 'achterstallig'
  const kopLabel =
    pickWeek !== null ? `Te picken in week ${pickWeek}` : 'Geen pick-datum'

  // Eén "all-bucket" als toggle uit staat, anders één bucket per land.
  // Beide paden eindigen in dezelfde KlantCluster[]-shape, zodat de render-
  // loop er niets van merkt.
  const groepen: LandGroep[] = groepeerOpLand
    ? groepeerOrdersOpLand(orders)
    : [{ iso2: null, vlag: null, clusters: clusterOrdersOpKlant(orders) }]

  return (
    <section>
      <h3 className="flex flex-wrap items-center gap-2 mb-2 px-1 text-sm font-semibold">
        <span className={achterstallig ? 'text-rose-700' : 'text-slate-700'}>
          {kopLabel}
        </span>
        {verzendWeek !== null && (
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
              achterstallig
                ? 'bg-rose-100 text-rose-700'
                : 'bg-teal-50 text-teal-700',
            )}
          >
            Verzendweek {verzendWeek}
          </span>
        )}
        {achterstallig && (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500 text-white"
            title="Pick-week ligt al in het verleden — had vorige week of eerder gepickt moeten worden"
          >
            Achterstallig
          </span>
        )}
        <span className="text-slate-400 font-normal">({orders.length})</span>
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
                  <BulkVerzendsetButton
                    orders={ordersInLand}
                    context={`voor ${groep.iso2 ?? 'onbekend land'}`}
                  />
                </div>
              )}
              {groep.clusters.map((cluster) => (
                <KlantClusterBlok
                  key={`${groep.iso2 ?? 'none'}-${cluster.debiteur_nr}`}
                  cluster={cluster}
                />
              ))}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Render-strategie voor één klant-cluster: bij één order toon je gewoon de
 * card; bij 2+ orders pak je ze in een herkenbare bundel-wrapper. Visueel
 * onderscheid in één oogopslag via:
 *  - dikke linker-accent-streep in terracotta (huiskleur)
 *  - "Bundel" badge + Layers-icoon in de kop
 *  - prominente klantnaam + telling-pill (groter dan losse-order-tekst)
 *  - subtiele terracotta-tint achtergrond rondom alle gebundelde cards
 */
function KlantClusterBlok({ cluster }: { cluster: KlantCluster }) {
  if (cluster.orders.length === 1) {
    return <OrderPickCard order={cluster.orders[0]} />
  }
  return (
    <div className="relative rounded-[var(--radius)] border-2 border-terracotta-400 bg-terracotta-100/60 pl-4 pr-2 pt-2 pb-2 space-y-2 shadow-sm">
      {/* Linker accent-streep — duidelijke bundel-aanduiding bij snelle scan */}
      <div
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-[var(--radius)] bg-terracotta-500"
      />
      <div className="flex items-center justify-between gap-2 px-1 pt-0.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex items-center gap-1 rounded-full bg-terracotta-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            <Layers size={11} />
            Bundel
          </span>
          <span className="text-sm font-semibold text-terracotta-600 truncate">
            {cluster.klant_naam}
          </span>
          <span className="inline-flex items-center rounded-full bg-white border border-terracotta-400 px-2 py-0.5 text-xs font-semibold text-terracotta-600 whitespace-nowrap">
            {cluster.orders.length} orders
          </span>
        </div>
        <BulkVerzendsetButton
          orders={cluster.orders}
          context={`voor ${cluster.klant_naam}`}
        />
      </div>
      <div className="space-y-2">
        {cluster.orders.map((o) => (
          <OrderPickCard key={o.order_id} order={o} />
        ))}
      </div>
    </div>
  )
}
