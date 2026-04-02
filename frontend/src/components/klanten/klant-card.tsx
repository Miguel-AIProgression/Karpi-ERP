import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import type { KlantRow } from '@/lib/supabase/queries/klanten'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

interface KlantCardProps {
  klant: KlantRow
}

export function KlantCard({ klant }: KlantCardProps) {
  const logoUrl = klant.logo_path
    ? `${SUPABASE_URL}/storage/v1/object/public/logos/${klant.debiteur_nr}.jpg`
    : null

  const initials = klant.naam
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <Link
      to={`/klanten/${klant.debiteur_nr}`}
      className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 hover:shadow-md transition-shadow block"
    >
      <div className="flex items-start gap-4">
        {/* Logo / initials */}
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={klant.naam}
            className="w-12 h-12 rounded-[var(--radius-sm)] object-contain bg-slate-50"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        ) : (
          <div className="w-12 h-12 rounded-[var(--radius-sm)] bg-slate-100 flex items-center justify-center text-sm font-medium text-slate-500">
            {initials}
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-sm truncate">{klant.naam}</h3>
            <StatusBadge status={klant.tier} type="tier" />
          </div>
          <p className="text-xs text-slate-400">#{klant.debiteur_nr}</p>
        </div>
      </div>

      {klant.vertegenwoordiger_naam && (
        <p className="mt-2 text-xs text-slate-400 truncate">
          Verteg: <span className="text-slate-600">{klant.vertegenwoordiger_naam}</span>
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-slate-400">Omzet YTD</span>
          <p className="font-medium">{formatCurrency(klant.omzet_ytd)}</p>
        </div>
        <div>
          <span className="text-slate-400">Orders</span>
          <p className="font-medium">{klant.aantal_orders_ytd}</p>
        </div>
      </div>
    </Link>
  )
}
