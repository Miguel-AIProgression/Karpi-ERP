import { useKlanteigenNamen } from '@/hooks/use-klanten'

interface Props {
  debiteurNr: number
}

export function KlanteigenNamenTab({ debiteurNr }: Props) {
  const { data: namen, isLoading } = useKlanteigenNamen(debiteurNr)

  if (isLoading) return <div className="p-5 text-sm text-slate-400">Laden...</div>

  if (!namen || namen.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Geen klanteigen namen</div>
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
          <th className="px-5 py-2 font-medium">Kwaliteit</th>
          <th className="px-5 py-2 font-medium">Eigen naam</th>
          <th className="px-5 py-2 font-medium">Omschrijving</th>
          <th className="px-5 py-2 font-medium">Leverancier</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {namen.map((n) => (
          <tr key={n.id}>
            <td className="px-5 py-2 font-mono text-xs">{n.kwaliteit_code}</td>
            <td className="px-5 py-2 font-medium">{n.benaming}</td>
            <td className="px-5 py-2 text-slate-500">{n.omschrijving ?? '—'}</td>
            <td className="px-5 py-2 text-slate-500">{n.leverancier ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
