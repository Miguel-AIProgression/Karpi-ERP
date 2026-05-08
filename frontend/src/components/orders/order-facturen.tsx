import { Link } from 'react-router-dom'
import { Receipt } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { useFacturenVoorOrder } from '@/modules/facturatie'
import { formatCurrency, formatDate } from '@/lib/utils/formatters'

interface OrderFacturenProps {
  orderId: number
}

export function OrderFacturen({ orderId }: OrderFacturenProps) {
  const { data: facturen, isLoading } = useFacturenVoorOrder(orderId)

  if (isLoading) return null

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Receipt size={15} className="text-slate-400" />
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Facturatie
        </h2>
      </div>

      {!facturen || facturen.length === 0 ? (
        <p className="text-sm text-slate-400 italic">Nog niet gefactureerd</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {facturen.map((f) => (
            <li key={f.id}>
              <Link
                to={`/facturatie/${f.id}`}
                className="flex items-center justify-between py-2 -mx-2 px-2 rounded hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-terracotta-500">{f.factuur_nr}</span>
                  <StatusBadge status={f.status} type="factuur" />
                  <span className="text-xs text-slate-400">{formatDate(f.factuurdatum)}</span>
                </div>
                <span className="text-sm font-medium text-slate-700">
                  {formatCurrency(f.totaal)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
