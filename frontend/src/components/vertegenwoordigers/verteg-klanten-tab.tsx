import { Link } from 'react-router-dom'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import { useVertegKlanten } from '@/hooks/use-vertegenwoordigers'

interface Props {
  code: string
}

export function VertegKlantenTab({ code }: Props) {
  const { data: klanten, isLoading } = useVertegKlanten(code)

  if (isLoading) return <div className="p-5 text-sm text-slate-400">Laden...</div>

  if (!klanten || klanten.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Geen klanten gekoppeld</div>
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
          <th className="px-5 py-2 font-medium">#</th>
          <th className="px-5 py-2 font-medium">Klant</th>
          <th className="px-5 py-2 font-medium">Tier</th>
          <th className="px-5 py-2 font-medium text-right">Omzet YTD</th>
          <th className="px-5 py-2 font-medium text-right">Orders</th>
          <th className="px-5 py-2 font-medium">Plaats</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {klanten.map((k) => (
          <tr key={k.debiteur_nr} className="hover:bg-slate-50">
            <td className="px-5 py-2 text-slate-400">{k.debiteur_nr}</td>
            <td className="px-5 py-2">
              <Link
                to={`/klanten/${k.debiteur_nr}`}
                className="text-terracotta-500 hover:underline font-medium"
              >
                {k.naam}
              </Link>
            </td>
            <td className="px-5 py-2">
              <StatusBadge status={k.tier} type="tier" />
            </td>
            <td className="px-5 py-2 text-right font-medium">{formatCurrency(k.omzet_ytd)}</td>
            <td className="px-5 py-2 text-right">{k.aantal_orders_ytd}</td>
            <td className="px-5 py-2 text-slate-500">{k.plaats ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
