// Render-strategie voor één klant-cluster: bij één order toon je gewoon de
// card; bij 2+ orders pak je ze in een herkenbare bundel-wrapper. Visueel
// onderscheid in één oogopslag via:
//  - dikke linker-accent-streep in terracotta (huiskleur)
//  - "Bundel" badge + Layers-icoon in de kop
//  - prominente klantnaam + telling-pill (groter dan losse-order-tekst)
//  - subtiele terracotta-tint achtergrond rondom alle gebundelde cards
//
// Twee modi op dezelfde wrapper:
//  - **voorgesteld** (pre-pickronde): toont `VoorgesteldeBundelInfo` (truck
//    + adres + besparing) en de `StartPickrondesButton` om de bundel te starten.
//  - **gestart** (post-pickronde): alle orders delen dezelfde
//    `actieve_pickronde.zending_id`; toont `ActieveBundelInfo` (zending-nr +
//    adres) en verbergt de start-knop omdat de zending al loopt.
//
// Gedeeld door PickWeekSectie en PickDagOrdersSectie — beide weergaven willen
// hetzelfde bundel-gedrag.
import { Layers } from 'lucide-react'
import { OrderPickCard } from './order-pick-card'
import { VoorgesteldeBundelInfo } from './voorgestelde-bundel-info'
import { ActieveBundelInfo } from './actieve-bundel-info'
import { StartPickrondesButton } from '@/modules/logistiek'
import type { VoorgesteldeBundel } from '@/modules/logistiek/queries/voorgestelde-bundels'
import type { KlantCluster } from '../lib/groeperen'

interface Props {
  cluster: KlantCluster
  bundel: VoorgesteldeBundel | null
}

export function KlantClusterBlok({ cluster, bundel }: Props) {
  if (cluster.orders.length === 1) {
    return <OrderPickCard order={cluster.orders[0]} />
  }
  const eerstePickronde = cluster.orders[0].actieve_pickronde
  const isGestart =
    eerstePickronde !== null &&
    cluster.orders.every(
      (o) => o.actieve_pickronde?.zending_id === eerstePickronde.zending_id,
    )
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
        {!isGestart && (
          <StartPickrondesButton
            orders={cluster.orders}
            context={`voor ${cluster.klant_naam}`}
            voorgesteldeBundel={bundel}
          />
        )}
      </div>
      {isGestart && eerstePickronde ? (
        <ActieveBundelInfo
          zendingNr={eerstePickronde.zending_nr}
          postcode={cluster.orders[0].afl_postcode}
          plaats={cluster.orders[0].afl_plaats}
        />
      ) : (
        bundel &&
        bundel.aantal_orders >= 2 && <VoorgesteldeBundelInfo bundel={bundel} />
      )}
      <div className="space-y-2">
        {cluster.orders.map((o) => (
          <OrderPickCard key={o.order_id} order={o} />
        ))}
      </div>
    </div>
  )
}
