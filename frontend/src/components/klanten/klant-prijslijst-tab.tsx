import { useState } from 'react'
import { Search } from 'lucide-react'
import { useKlantPrijslijst } from '@/hooks/use-klanten'
import { formatCurrency } from '@/lib/utils/formatters'

interface Props {
  debiteurNr: number
}

export function KlantPrijslijstTab({ debiteurNr }: Props) {
  const { data: regels, isLoading } = useKlantPrijslijst(debiteurNr)
  const [zoek, setZoek] = useState('')

  if (isLoading) return <div className="p-5 text-sm text-slate-400">Laden...</div>

  if (!regels || regels.length === 0) {
    return <div className="p-5 text-sm text-slate-400">Geen prijslijst gekoppeld</div>
  }

  const filtered = zoek
    ? regels.filter(
        (r) =>
          r.artikelnr.includes(zoek) ||
          r.omschrijving?.toLowerCase().includes(zoek.toLowerCase()) ||
          r.omschrijving_2?.toLowerCase().includes(zoek.toLowerCase()),
      )
    : regels

  return (
    <>
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
        <span className="text-xs text-slate-400">{regels.length} artikelen</span>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Zoek op artikelnr of omschrijving..."
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-[var(--radius-sm)] w-64 focus:outline-none focus:ring-1 focus:ring-terracotta-300 focus:border-terracotta-300"
          />
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
            <th className="px-5 py-2 font-medium">Artikelnr</th>
            <th className="px-5 py-2 font-medium">Omschrijving</th>
            <th className="px-5 py-2 font-medium">Omschrijving 2</th>
            <th className="px-5 py-2 font-medium text-right">Prijs</th>
            <th className="px-5 py-2 font-medium text-right">Gewicht</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {filtered.slice(0, 200).map((r) => (
            <tr key={r.artikelnr} className="hover:bg-slate-50">
              <td className="px-5 py-2 font-mono text-xs">{r.artikelnr}</td>
              <td className="px-5 py-2">{r.omschrijving ?? '—'}</td>
              <td className="px-5 py-2 text-slate-500">{r.omschrijving_2 ?? '—'}</td>
              <td className="px-5 py-2 text-right font-medium">{formatCurrency(r.prijs)}</td>
              <td className="px-5 py-2 text-right text-slate-500">
                {r.gewicht != null ? `${r.gewicht} kg` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {filtered.length > 200 && (
        <div className="px-5 py-3 text-xs text-slate-400 border-t border-slate-100">
          {filtered.length - 200} artikelen niet getoond. Gebruik de zoekbalk om te filteren.
        </div>
      )}
    </>
  )
}
