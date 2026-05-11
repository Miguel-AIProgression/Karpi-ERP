import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import type { DebiteurRow } from '../queries/debiteuren'
import { EdiTag } from '@/modules/edi'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

interface DebiteurCardProps {
  debiteur: DebiteurRow
}

export function DebiteurCard({ debiteur }: DebiteurCardProps) {
  const logoUrl = debiteur.logo_path
    ? `${SUPABASE_URL}/storage/v1/object/public/logos/${debiteur.debiteur_nr}.jpg`
    : null

  const initials = debiteur.naam
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  return (
    <Link
      to={`/klanten/${debiteur.debiteur_nr}`}
      className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 hover:shadow-md transition-shadow block"
    >
      <div className="flex items-start gap-4">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={debiteur.naam}
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
            <h3 className="font-medium text-sm truncate">{debiteur.naam}</h3>
            <StatusBadge status={debiteur.tier} type="tier" />
            {debiteur.edi_actief && <EdiTag testModus={debiteur.edi_test_modus} />}
          </div>
          <p className="text-xs text-slate-400">#{debiteur.debiteur_nr}</p>
        </div>
      </div>

      {debiteur.vertegenwoordiger_naam && (
        <p className="mt-2 text-xs text-slate-400 truncate">
          Verteg: <span className="text-slate-600">{debiteur.vertegenwoordiger_naam}</span>
        </p>
      )}

      <p className="mt-1 text-xs text-slate-400 truncate">
        Prijslijst:{' '}
        {debiteur.prijslijst_nr ? (
          <span className="text-slate-600">
            {debiteur.prijslijst_nr}
            {debiteur.prijslijst_naam ? ` — ${debiteur.prijslijst_naam}` : ''}
          </span>
        ) : (
          <span className="text-slate-300 italic">geen</span>
        )}
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-slate-400">Omzet YTD</span>
          <p className="font-medium">{formatCurrency(debiteur.omzet_ytd)}</p>
        </div>
        <div>
          <span className="text-slate-400">Orders</span>
          <p className="font-medium">{debiteur.aantal_orders_ytd}</p>
        </div>
      </div>
    </Link>
  )
}
