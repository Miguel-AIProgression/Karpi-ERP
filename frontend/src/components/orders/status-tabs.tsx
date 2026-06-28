import { cn } from '@/lib/utils/cn'
import type { StatusCount } from '@/lib/supabase/queries/orders'

// Twee assen (zie ook ADR-0016):
//  • FASE = de order-status zelf — waar zit de order in de flow. Vaste overzicht-rij,
//    altijd alle chips zichtbaar zodat je de aantallen per fase in één oogopslag ziet.
//  • AANDACHT = afgeleide, status-overstijgende vlaggen die om een menselijke actie
//    vragen. Alleen getoond als hun teller > 0 (of als ze nu geselecteerd zijn) —
//    een vlag op 0 is ruis en hoort niet permanent in de balk te staan.
//
// Betekenis van de aandacht-vlaggen:
// 'Actie vereist'        = Wacht op voorraad ∪ Wacht op inkoop ∪ heeft_unmatched_regels.
// 'Manco'                = open manco-werklijst (mig 518) — rendert de MancoTab i.p.v. de orderlijst.
// 'Te bevestigen'        = EDI-orders met onbevestigde leverweek (edi_bevestigd_op IS NULL).
// 'Debiteur te bevestigen' = onzekere fuzzy debiteur-match (mig 322).
// 'Levertijd gewijzigd'  = leverweek verschoven door een ETA-update (mig 326).
// 'Afleveradres ontbreekt' = onvolledig afleveradres-snapshot (mig 395).
// 'Prijs ontbreekt'      = ≥1 regel zonder prijs (mig 396).
// 'Geen verzendweek'     = order zonder afleverdatum (geen weekindeling in Pick & Ship).
// 'Had mankement'        = order waarop ooit een manco gedetecteerd is (mig 518).
const FASE_STATUSES = [
  'Alle',
  'Klaar voor picken',
  'Wacht op voorraad',
  'Wacht op inkoop',
  'Wacht op maatwerk',
  'In pickronde',
  'Deels verzonden',
  'Verzonden',
  'Geannuleerd',
]

const AANDACHT_STATUSES = [
  'Actie vereist',
  'Manco',
  'Te bevestigen',
  'Debiteur te bevestigen',
  'Levertijd gewijzigd',
  'Afleveradres ontbreekt',
  'Prijs ontbreekt',
  'Geen verzendweek',
  'Had mankement',
]

interface StatusTabsProps {
  selected: string
  onSelect: (status: string) => void
  counts: StatusCount[]
  /** Totaal aantal unieke orders (fetchOrders totalCount) voor de 'Alle'-badge —
   *  cross-cutting buckets tellen anders dubbel in een gewone optelsom. */
  totalCount?: number
}

export function StatusTabs({ selected, onSelect, counts, totalCount }: StatusTabsProps) {
  const countMap = new Map(counts.map((c) => [c.status, c.aantal]))

  const chip = (status: string, accent: 'fase' | 'aandacht') => {
    const count = status === 'Alle' ? (totalCount ?? 0) : (countMap.get(status) ?? 0)
    const isActive = selected === status
    return (
      <button
        key={status}
        onClick={() => onSelect(status)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
          isActive
            ? 'bg-terracotta-500 text-white font-medium'
            : accent === 'aandacht'
              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
        )}
      >
        {status}
        <span
          className={cn(
            'text-xs px-1.5 py-0.5 rounded-full',
            isActive ? 'bg-white/20' : accent === 'aandacht' ? 'bg-amber-100' : 'bg-slate-200',
          )}
        >
          {count}
        </span>
      </button>
    )
  }

  // Aandacht-vlaggen alleen tonen als er iets openstaat (of de chip nu actief is, zodat
  // een geselecteerde 0-vlag deselecteerbaar blijft).
  const actieveAandacht = AANDACHT_STATUSES.filter(
    (s) => (countMap.get(s) ?? 0) > 0 || selected === s,
  )

  return (
    <div className="space-y-2 mb-4">
      {/* Fase: de order-status zelf — vaste overzicht-rij */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {FASE_STATUSES.map((s) => chip(s, 'fase'))}
      </div>

      {/* Vereist actie: status-overstijgende vlaggen, alleen zichtbaar als er iets openstaat */}
      {actieveAandacht.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="text-xs font-medium text-amber-700/80 whitespace-nowrap pr-1">
            Vereist actie
          </span>
          {actieveAandacht.map((s) => chip(s, 'aandacht'))}
        </div>
      )}
    </div>
  )
}
