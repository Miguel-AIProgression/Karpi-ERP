import { useQuery } from '@tanstack/react-query'
import { PackageCheck, PackageX, Clock, Ban } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'
import { isAdminPseudo } from '@/lib/orders/admin-pseudo'
import type { OrderRegel } from '@/lib/supabase/queries/orders'

// Per orderregel zichtbaar maken wat al verzonden is en wat nog niet — relevant
// zodra een order in deelzendingen de deur uit gaat (mig 518: een niet-gevonden
// regel blijft als Manco staan terwijl de rest verzonden wordt).
//
// Verzonden-aantal = som van zending_regels.aantal in een eindstatus-zending.
// Manco-status komt uit de orderregel zelf (pick_backorder_*), niet uit
// zending_regels.manco_aantal — die verdwijnt als een volledig-manco zending
// wordt verwijderd (voltooi_pickronde), de orderregel-gate blijft bron-van-waarheid.

const VERZONDEN_STATUSSEN = ['Klaar voor verzending', 'Onderweg', 'Afgeleverd']

/** Som verzonden aantal per order_regel_id (zending_regels in een eindstatus-zending). */
async function fetchVerzondenPerRegel(orderId: number): Promise<Map<number, number>> {
  const map = new Map<number, number>()
  // 1. Zendingen van de order (M2M, mig 222) die fysiek klaarstaan/onderweg zijn.
  const { data: zo, error: zoErr } = await supabase
    .from('zending_orders')
    .select('zending_id, zendingen!inner(status)')
    .eq('order_id', orderId)
    .in('zendingen.status', VERZONDEN_STATUSSEN)
  if (zoErr) throw zoErr
  const zendingIds = (zo ?? []).map((r) => (r as { zending_id: number }).zending_id)
  if (zendingIds.length === 0) return map
  // 2. Regels van die zendingen. Bij een bundel-zending komen ook regels van
  //    andere orders mee — die order_regel_ids staan niet in deze ordertabel en
  //    worden bij het opzoeken simpelweg genegeerd.
  const { data: zr, error: zrErr } = await supabase
    .from('zending_regels')
    .select('order_regel_id, aantal')
    .in('zending_id', zendingIds)
  if (zrErr) throw zrErr
  for (const row of (zr ?? []) as Array<{ order_regel_id: number | null; aantal: number | null }>) {
    if (row.order_regel_id == null) continue
    map.set(row.order_regel_id, (map.get(row.order_regel_id) ?? 0) + (row.aantal ?? 0))
  }
  return map
}

export function useVerzondenPerRegel(orderId: number) {
  return useQuery({
    queryKey: ['order-verzonden-per-regel', orderId],
    queryFn: () => fetchVerzondenPerRegel(orderId),
    staleTime: 30_000,
  })
}

export type RegelVerzendStatus =
  | 'verzonden'
  | 'deels_verzonden'
  | 'manco'
  | 'niet_leverbaar'
  | 'nog_te_verzenden'

/** Eén status per regel. `toonNogTeVerzenden` voorkomt ruis op gewone open orders
 *  (alleen tonen zodra de order al deels de deur uit is). */
export function bepaalRegelVerzendStatus(
  regel: OrderRegel,
  verzonden: number,
  toonNogTeVerzenden: boolean,
): RegelVerzendStatus | null {
  if (regel.pick_backorder_sinds && !regel.pick_backorder_geannuleerd_op) return 'manco'
  if (regel.pick_backorder_geannuleerd_op) return 'niet_leverbaar'
  if (verzonden > 0 && verzonden >= regel.orderaantal) return 'verzonden'
  if (verzonden > 0) return 'deels_verzonden'
  if (toonNogTeVerzenden) return 'nog_te_verzenden'
  return null
}

const PRESENTATIE: Record<
  RegelVerzendStatus,
  { bg: string; text: string; label: string; title: string; Icon: typeof PackageCheck }
> = {
  verzonden: {
    bg: 'bg-emerald-100', text: 'text-emerald-700', Icon: PackageCheck,
    label: 'Verzonden', title: 'Verzonden — zit in een klaargezette/onderweg/afgeleverde zending',
  },
  deels_verzonden: {
    bg: 'bg-emerald-100', text: 'text-emerald-700', Icon: PackageCheck,
    label: 'Verzonden', title: 'Deels verzonden — een deel van deze regel is al de deur uit',
  },
  manco: {
    bg: 'bg-amber-100', text: 'text-amber-800', Icon: PackageX,
    label: 'Manco — niet gevonden', title: 'Niet gevonden tijdens het picken — wacht op de Manco-werklijst',
  },
  niet_leverbaar: {
    bg: 'bg-slate-100', text: 'text-slate-600', Icon: Ban,
    label: 'Niet geleverd', title: 'Manco afgesloten als niet leverbaar',
  },
  nog_te_verzenden: {
    bg: 'bg-slate-100', text: 'text-slate-500', Icon: Clock,
    label: 'Nog te verzenden', title: 'Nog niet verzonden',
  },
}

/** Badge per orderregel op order-detail. Rendert null als er niets te melden is
 *  (gewone open order) of voor admin-pseudo-regels (VERZEND e.d.). */
export function RegelVerzendBadge({ regel, verzonden, toonNogTeVerzenden }: {
  regel: OrderRegel
  verzonden: number
  toonNogTeVerzenden: boolean
}) {
  if (isAdminPseudo(regel)) return null
  const status = bepaalRegelVerzendStatus(regel, verzonden, toonNogTeVerzenden)
  if (!status) return null
  const p = PRESENTATIE[status]
  const label = status === 'deels_verzonden'
    ? `Verzonden ${verzonden}/${regel.orderaantal}`
    : p.label
  return (
    <span
      className={`mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${p.bg} ${p.text}`}
      title={p.title}
    >
      <p.Icon size={11} /> {label}
    </span>
  )
}
