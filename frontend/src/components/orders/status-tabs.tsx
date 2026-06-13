import { cn } from '@/lib/utils/cn'
import type { StatusCount } from '@/lib/supabase/queries/orders'

// Status-tabs volgen ADR-0016: 'Klaar voor picken' is de default-fase;
// 'In pickronde' / 'Deels verzonden' tonen pickronde-progressie;
// 'Wacht op maatwerk' onderscheidt maatwerk-blokkade van voorraad-blokkade.
// 'Actie vereist' is union van Wacht op voorraad ∪ Wacht op inkoop ∪
// heeft_unmatched_regels (zie fetchOrders).
// 'Te bevestigen' = EDI-orders met onbevestigde leverweek
// (bron_systeem='edi' AND edi_bevestigd_op IS NULL); status-overstijgend, net als 'Actie vereist'.
// 'Debiteur te bevestigen' = orders met onzekere fuzzy debiteur-match (mig 322,
// debiteur_zeker=false, bron <> env_fallback); ook status-overstijgend.
// 'Levertijd gewijzigd' = orders waarvan de leverweek is verschoven door een
// leverancier/Karpi-ETA-update op een gekoppelde inkooporderregel (mig 326,
// levertijd_wijziging_te_bevestigen_sinds IS NOT NULL); ook status-overstijgend.
// 'Afleveradres ontbreekt' = orders met een onvolledig afleveradres-snapshot
// (mig 395, afl_adres_incompleet_sinds IS NOT NULL); status-overstijgend en
// blokkeert pickronde-start tot het adres is aangevuld.
// 'Prijs ontbreekt' = orders met ≥1 regel zonder prijs (€0/NULL) (mig 396,
// prijs_ontbreekt_sinds IS NOT NULL); status-overstijgend en blokkeert
// pickronde-start tot de prijs is gecorrigeerd of bewust bevestigd.
const ALL_STATUSES = [
  'Alle',
  'Klaar voor picken',
  'Actie vereist',
  'Te bevestigen',
  'Debiteur te bevestigen',
  'Levertijd gewijzigd',
  'Afleveradres ontbreekt',
  'Prijs ontbreekt',
  'Wacht op voorraad',
  'Wacht op inkoop',
  'Wacht op maatwerk',
  'In pickronde',
  'Deels verzonden',
  'Verzonden',
  'Geannuleerd',
]

interface StatusTabsProps {
  selected: string
  onSelect: (status: string) => void
  counts: StatusCount[]
}

export function StatusTabs({ selected, onSelect, counts }: StatusTabsProps) {
  const countMap = new Map(counts.map((c) => [c.status, c.aantal]))
  const allCount = counts.reduce((sum, c) => sum + c.aantal, 0)

  return (
    <div className="flex gap-1 overflow-x-auto pb-2 mb-4">
      {ALL_STATUSES.map((status) => {
        const count = status === 'Alle' ? allCount : (countMap.get(status) ?? 0)
        const isActive = selected === status

        return (
          <button
            key={status}
            onClick={() => onSelect(status)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors',
              isActive
                ? 'bg-terracotta-500 text-white font-medium'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            {status}
            <span
              className={cn(
                'text-xs px-1.5 py-0.5 rounded-full',
                isActive ? 'bg-white/20' : 'bg-slate-200'
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}
