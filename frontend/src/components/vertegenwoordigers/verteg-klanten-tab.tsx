import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Unlink } from 'lucide-react'
import { StatusBadge } from '@/components/ui/status-badge'
import { formatCurrency } from '@/lib/utils/formatters'
import { useSetKlantVerteg, useVertegKlanten } from '@/hooks/use-vertegenwoordigers'
import { VertegKoppelKlantDialog } from './verteg-koppel-klant-dialog'

interface Props {
  code: string
  naam?: string
}

export function VertegKlantenTab({ code, naam }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: klanten, isLoading } = useVertegKlanten(code)
  const ontkoppel = useSetKlantVerteg()

  const handleOntkoppel = (debiteurNr: number, klantNaam: string) => {
    if (confirm(`"${klantNaam}" loskoppelen van deze vertegenwoordiger?`)) {
      ontkoppel.mutate({ debiteurNr, code: null })
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <span className="text-xs text-slate-400">
          {klanten?.length ?? 0} klant{(klanten?.length ?? 0) === 1 ? '' : 'en'} gekoppeld
        </span>
        <button
          onClick={() => setDialogOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-terracotta-500 text-white text-sm font-medium rounded-[var(--radius-sm)] hover:bg-terracotta-600"
        >
          <Plus size={14} />
          Klant koppelen
        </button>
      </div>

      {isLoading ? (
        <div className="p-5 text-sm text-slate-400">Laden...</div>
      ) : !klanten || klanten.length === 0 ? (
        <div className="p-5 text-sm text-slate-400">Geen klanten gekoppeld</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-2 font-medium">#</th>
              <th className="px-5 py-2 font-medium">Klant</th>
              <th className="px-5 py-2 font-medium">Tier</th>
              <th className="px-5 py-2 font-medium text-right">Omzet YTD</th>
              <th className="px-5 py-2 font-medium text-right">Orders</th>
              <th className="px-5 py-2 font-medium">Plaats</th>
              <th className="px-5 py-2 font-medium w-10"></th>
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
                <td className="px-5 py-2">
                  <button
                    onClick={() => handleOntkoppel(k.debiteur_nr, k.naam)}
                    disabled={ontkoppel.isPending}
                    title="Loskoppelen"
                    className="p-1 text-slate-400 hover:text-rose-600 disabled:opacity-50"
                  >
                    <Unlink size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <VertegKoppelKlantDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        vertegCode={code}
        vertegNaam={naam ?? code}
      />
    </>
  )
}
