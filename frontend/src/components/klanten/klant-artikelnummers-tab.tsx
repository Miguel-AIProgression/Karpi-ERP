import { useKlantArtikelnummers } from '@/hooks/use-klanten'

interface Props {
  debiteurNr: number
}

export function KlantArtikelnummersTab({ debiteurNr }: Props) {
  const { data: nummers, isLoading } = useKlantArtikelnummers(debiteurNr)

  if (isLoading) return <div className="p-5 text-sm text-slate-400">Laden...</div>

  if (!nummers || nummers.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Geen klant-artikelnummers</div>
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
          <th className="px-5 py-2 font-medium">Artikelnr</th>
          <th className="px-5 py-2 font-medium">Product</th>
          <th className="px-5 py-2 font-medium">Klant artikelnr</th>
          <th className="px-5 py-2 font-medium">Omschrijving</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {nummers.map((n) => (
          <tr key={n.id}>
            <td className="px-5 py-2 font-mono text-xs">{n.artikelnr}</td>
            <td className="px-5 py-2 text-slate-500">{n.product_omschrijving ?? '—'}</td>
            <td className="px-5 py-2 font-medium">{n.klant_artikel}</td>
            <td className="px-5 py-2 text-slate-500">{n.omschrijving ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
