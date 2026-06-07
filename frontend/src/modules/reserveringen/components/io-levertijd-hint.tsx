import { Clock } from 'lucide-react'
import { useOpenstaandeInkoopregelsVoorArtikel } from '@/modules/inkoop'
import { isoWeek } from '@/lib/orders/verzendweek'

interface Props {
  artikelnr: string
  /** Aantal dat (na voorraad + uitwisselbaar) nog op inkoop moet wachten. */
  tekortAantal: number
}

function weekLabel(datumIso: string): string {
  const w = isoWeek(new Date(datumIso + 'T00:00:00'))
  return `Wk ${w.week} · ${w.jaar}`
}

/**
 * Toont voor een vaste-maat IO-tekort wanneer de dekkende inkoop verwacht
 * wordt. Loopt de openstaande inkooporder-regels voor dit artikel af in
 * dezelfde FIFO-volgorde (verwacht_datum ASC) als de allocator
 * (`herallocateer_orderregel`, mig 144-152) en het inkooporders-regeloverzicht
 * gebruiken — zodat de operator bij het invoeren al ziet wat de klant kan
 * verwachten, in plaats van pas na opslaan via de afleverdatum-sync (mig 153).
 * Puur informatief: de daadwerkelijke claim loopt server-side.
 */
export function IoLevertijdHint({ artikelnr, tekortAantal }: Props) {
  const { data: regels } = useOpenstaandeInkoopregelsVoorArtikel(artikelnr)

  if (tekortAantal <= 0 || !regels || regels.length === 0) return null

  let resterend = tekortAantal
  let dekkendeRegel: (typeof regels)[number] | null = null
  for (const regel of regels) {
    if (resterend <= 0) break
    resterend -= regel.te_leveren_m
    dekkendeRegel = regel
  }

  if (!dekkendeRegel?.verwacht_datum) {
    return (
      <div className="text-xs text-amber-700 mt-1">
        {tekortAantal}× wacht op inkoop — leverweek nog onbekend (geen verwachte datum op openstaande inkooporder).
      </div>
    )
  }

  return (
    <div
      className="text-xs text-amber-700 mt-1 inline-flex items-center gap-1"
      title={`Verwacht op ${dekkendeRegel.inkooporder_nr}`}
    >
      <Clock size={12} />
      <span>
        {tekortAantal}× wacht op inkoop — verwacht{' '}
        <span className="font-medium">{weekLabel(dekkendeRegel.verwacht_datum)}</span>
        {' '}({dekkendeRegel.inkooporder_nr})
        {resterend > 0 && (
          <span className="text-rose-600"> — openstaande inkoop dekt het tekort nog niet volledig</span>
        )}
      </span>
    </div>
  )
}
