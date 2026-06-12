// Onderste sectie op Pick & Ship: orders die niet startbaar zijn omdat geen
// enkele actieve vervoerder-regel matcht ("Geen vervoerder mogelijk", zelfde
// predicaat als StartPickrondesButton + de mig 373-guard). Deze orders bleven
// in de week-secties bovenaan hangen (oude verzendweken → "Achterstallig"-
// koppen) terwijl de magazijnier er niets mee kan — verzoek Miguel 2026-06-12:
// alles wat wél gepickt kan worden hoort erboven.
//
// De orders blijven gewoon zichtbaar (bewuste keuze, zie mig 373) — de kaart
// zelf toont de disabled "Geen vervoerder mogelijk"-knop. Zodra een vervoerder
// geactiveerd wordt (bv. Rhenus-cutover) of een handmatige override gezet is,
// verhuist de order vanzelf terug naar zijn week-sectie.
import { Ban } from 'lucide-react'
import { KlantClusterBlok } from './klant-cluster-blok'
import {
  clusterOrdersOpKlant,
  groepeerOrdersOpLand,
  type LandGroep,
} from '../lib/groeperen'
import type { PickShipOrder } from '../lib/types'

interface Props {
  orders: PickShipOrder[]
  /** Zelfde land-toggle als de week-secties. */
  groepeerOpLand: boolean
}

export function PickGeblokkeerdSectie({ orders, groepeerOpLand }: Props) {
  if (orders.length === 0) return null

  const groepen: LandGroep[] = groepeerOpLand
    ? groepeerOrdersOpLand(orders)
    : [{ iso2: null, vlag: null, clusters: clusterOrdersOpKlant(orders) }]

  return (
    <section className="rounded-[var(--radius)] border border-amber-300 bg-amber-50/40 p-3">
      <h3 className="flex flex-wrap items-center gap-2 mb-3 px-1 text-sm font-semibold">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
          <Ban size={13} />
          Geen vervoerder mogelijk
        </span>
        <span className="text-amber-800 font-normal">
          Pick-start geblokkeerd — activeer de vervoerder voor dit land of kies handmatig een vervoerder op de order
        </span>
        <span className="text-slate-500 font-normal">({orders.length})</span>
      </h3>

      <div className="space-y-4">
        {groepen.map((groep, i) => (
          <div key={groep.iso2 ?? `none-${i}`} className="space-y-3">
            {groepeerOpLand && (
              <h4 className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {groep.vlag && <span aria-hidden>{groep.vlag}</span>}
                <span>{groep.iso2 ?? 'Onbekend land'}</span>
                <span className="font-normal text-slate-400">
                  ({groep.clusters.reduce((n, c) => n + c.orders.length, 0)})
                </span>
              </h4>
            )}
            {groep.clusters.map((cluster) => (
              <KlantClusterBlok
                key={`${groep.iso2 ?? 'none'}-${cluster.debiteur_nr}-${cluster.orders[0]?.order_id}`}
                cluster={cluster}
                bundel={null}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
