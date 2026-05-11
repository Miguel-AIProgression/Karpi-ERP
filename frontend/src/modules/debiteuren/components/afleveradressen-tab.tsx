import type { Afleveradres } from '../queries/debiteuren'

interface Props {
  adressen?: Afleveradres[]
}

export function AfleveradressenTab({ adressen }: Props) {
  if (!adressen || adressen.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Geen afleveradressen</div>
  }
  return (
    <div className="divide-y divide-slate-50">
      {adressen.map((a) => (
        <div key={a.id} className="px-5 py-3 text-sm">
          <span className="text-slate-400 mr-2">#{a.adres_nr}</span>
          <span className="font-medium">{a.naam}</span>
          {a.adres && (
            <span className="text-slate-500"> — {a.adres}, {a.postcode} {a.plaats}</span>
          )}
        </div>
      ))}
    </div>
  )
}
