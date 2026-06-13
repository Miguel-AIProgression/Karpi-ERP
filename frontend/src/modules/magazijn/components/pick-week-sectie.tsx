// Eén pick-week-sectie op de Pick & Ship-overview. Verantwoordelijk voor:
//   1. Sectie-kop ("Te picken in week N · Verzendweek M [achterstallig?]"),
//   2. Optionele land-subsecties als de gebruiker "Groeperen op land" aanzet,
//   3. Klant-clustering (orders met dezelfde debiteur_nr altijd bij elkaar),
//   4. Bulk-stickers-knop op klant-cluster en (bij toggle) op land-niveau.
//
// De pagina beslist welke orders bij deze sectie horen en óf de land-toggle
// aan staat — hier alleen het rangschikken + renderen.
import { KlantClusterBlok } from './klant-cluster-blok'
import { StartPickrondesButton, StartWeekButton } from '@/modules/logistiek'
import type { VoorgesteldeBundel } from '@/modules/logistiek/queries/voorgestelde-bundels'
import {
  clusterOrdersOpKlant,
  groepeerOrdersOpLand,
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
  /** Voorgestelde-bundels voor déze verzendweek. Per cluster matchen we op
   *  order-id om de drempel-progressbar + besparing-badge te tonen. Zonder
   *  match (bv. solo-orders, weken zonder bundeling) toont KlantClusterBlok
   *  alleen de orders zoals voorheen. */
  voorgesteldeBundels: VoorgesteldeBundel[]
}

export function PickWeekSectie({
  orders,
  pickWeek,
  verzendWeek,
  status,
  groepeerOpLand,
  voorgesteldeBundels,
}: Props) {
  // Twee indexen op de bundel-rijen:
  //   · bundelByOrderId  → snelle lookup per order voor decoratie (truck +
  //     adres-strip + besparing-badge in de KlantClusterBlok).
  //   · sleutelByOrderId → drijft de clustering: orders met dezelfde 4D-
  //     bundel-sleutel komen in één visuele cluster, andere orders blijven
  //     gescheiden — ook binnen dezelfde klant. Zo verdwijnt de misleidende
  //     "BUNDEL X 2 orders"-header bij verschillende vervoerders.
  const bundelByOrderId = new Map<number, VoorgesteldeBundel>()
  const sleutelByOrderId = new Map<number, string>()
  for (const b of voorgesteldeBundels) {
    for (const oid of b.order_ids) {
      bundelByOrderId.set(oid, b)
      sleutelByOrderId.set(oid, b.sleutel)
    }
  }
  // Orders met een lopende pickronde vallen uit `voorgestelde_zending_bundels`
  // (mig 229 filtert actieve zendingen weg). Voor visuele continuïteit pre- en
  // post-pickronde-start clusteren we ze opnieuw via hun zending_id — alle
  // orders die in dezelfde bundel-zending zitten delen per definitie dezelfde
  // 4D-sleutel. Overschrijft de voorgestelde-sleutel als beide bestaan; geen
  // probleem want zodra een order in pickronde zit is de voorgestelde-info
  // stale.
  for (const o of orders) {
    if (o.actieve_pickronde) {
      sleutelByOrderId.set(o.order_id, `actief:${o.actieve_pickronde.zending_id}`)
    }
  }
  const achterstallig = status === 'achterstallig'
  const kopLabel =
    pickWeek !== null ? `Te picken in week ${pickWeek}` : 'Geen pick-datum'

  // Eén "all-bucket" als toggle uit staat, anders één bucket per land.
  // Beide paden eindigen in dezelfde KlantCluster[]-shape, zodat de render-
  // loop er niets van merkt.
  const groepen: LandGroep[] = groepeerOpLand
    ? groepeerOrdersOpLand(orders, sleutelByOrderId)
    : [{ iso2: null, vlag: null, clusters: clusterOrdersOpKlant(orders, sleutelByOrderId) }]

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
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
        {/* Hele week in één keer starten → bulk-printset (labels + pakbonnen als
            aparte stapels per printer). Auto-4D-bundeling maakt er meerdere
            zendingen van. Dag-orders blijven hun eigen cluster-start houden. */}
        <StartWeekButton orders={orders} verzendWeek={verzendWeek} />
      </div>

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
                    key={`${groep.iso2 ?? 'none'}-${cluster.debiteur_nr}`}
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

