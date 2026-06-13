import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase/client'

interface TransportorderRij {
  id: number
  status: string
  error_msg: string | null
}

interface ZendingRij {
  zending_nr: string
  status: string
  hst_transportorders: TransportorderRij[]
}

export interface OpenVerzendFout {
  zending_nr: string
  error_msg: string | null
}

/**
 * Pure helper: een zending heeft een OPEN verzendfout als er een Fout-rij
 * bestaat zonder dat er nog een actieve (Wachtrij/Bezig) of geslaagde
 * (Verstuurd) transportorder is. Een Fout-rij naast een Verstuurd-rij is
 * historie (geslaagde retry) en geen open probleem; een Fout-rij naast een
 * Wachtrij-rij is een lopende retry en evenmin "open".
 */
export function bepaalOpenVerzendFouten(zendingen: ZendingRij[]): OpenVerzendFout[] {
  const fouten: OpenVerzendFout[] = []
  for (const z of zendingen) {
    const rijen = z.hst_transportorders ?? []
    const heeftActiefOfGeslaagd = rijen.some((t) =>
      ['Wachtrij', 'Bezig', 'Verstuurd'].includes(t.status),
    )
    const foutRij = rijen.find((t) => t.status === 'Fout')
    if (foutRij && !heeftActiefOfGeslaagd) {
      fouten.push({ zending_nr: z.zending_nr, error_msg: foutRij.error_msg })
    }
  }
  return fouten
}

async function fetchOpenVerzendFouten(orderId: number): Promise<OpenVerzendFout[]> {
  // Mig 222: orders-per-zending via M2M zending_orders (backfill heeft
  // 1-op-1 zendingen ook gevuld, dus deze route dekt solo én bundel).
  const { data, error } = await supabase
    .from('zending_orders')
    .select('zendingen ( zending_nr, status, hst_transportorders ( id, status, error_msg ) )')
    .eq('order_id', orderId)
  if (error) throw error
  const zendingen = (data ?? [])
    .map((row) => (row as unknown as { zendingen: ZendingRij | null }).zendingen)
    .filter((z): z is ZendingRij => z != null)
  return bepaalOpenVerzendFouten(zendingen)
}

export function useOpenVerzendFouten(orderId: number) {
  return useQuery({
    queryKey: ['order-verzend-fouten', orderId],
    queryFn: () => fetchOpenVerzendFouten(orderId),
    staleTime: 30_000,
  })
}

/**
 * Rose waarschuwingsbanner op order-detail: de order kan op "Verzonden"
 * staan (voltooi_pickronde flipt bij de laatste pickronde), terwijl de
 * transportorder naar de vervoerder daarna alsnog faalde — de goederen
 * liggen dan klaar maar er rijdt geen vervoerder. Zonder dit signaal is
 * die mismatch alleen op de Zendingen-pagina zichtbaar.
 * Rendert null zonder open fouten (gouden regel).
 */
export function VerzendFoutBanner({ orderId }: { orderId: number }) {
  const { data: fouten = [] } = useOpenVerzendFouten(orderId)

  if (fouten.length === 0) return null

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-rose-300 bg-rose-50 p-4">
      <div className="mb-2 flex items-center gap-2 font-medium text-rose-900">
        <AlertTriangle size={18} />
        Verzending naar vervoerder mislukt
      </div>
      <div className="mb-3 text-sm text-rose-900">
        De order is gepickt, maar de transportorder naar de vervoerder kon niet
        verstuurd worden — er is dus nog géén vervoerder ingepland.
      </div>
      <ul className="space-y-1.5 text-sm">
        {fouten.map((f) => (
          <li key={f.zending_nr} className="flex flex-wrap items-center gap-2">
            <Link
              to={`/logistiek/${f.zending_nr}`}
              className="font-medium text-rose-700 underline hover:text-rose-900"
            >
              {f.zending_nr}
            </Link>
            {f.error_msg && <span className="text-rose-800">— {f.error_msg}</span>}
          </li>
        ))}
      </ul>
      <div className="mt-3 text-xs text-rose-700">
        Los de oorzaak op (bv. adres aanvullen) en klik op de zending op
        “Opnieuw versturen”.
      </div>
    </div>
  )
}
