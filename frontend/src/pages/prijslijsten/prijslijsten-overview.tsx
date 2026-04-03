import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Search, Users, FileSpreadsheet } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { usePrijslijsten } from '@/hooks/use-prijslijsten'

export function PrijslijstenOverviewPage() {
  const { data: prijslijsten, isLoading } = usePrijslijsten()
  const [zoek, setZoek] = useState('')

  const filtered = useMemo(() => {
    if (!prijslijsten) return []
    if (!zoek) return prijslijsten
    const q = zoek.toLowerCase()
    return prijslijsten.filter(
      (p) =>
        p.nr.includes(q) ||
        p.naam.toLowerCase().includes(q) ||
        p.klanten.some((k) => k.naam.toLowerCase().includes(q)),
    )
  }, [prijslijsten, zoek])

  const totaalKlanten = useMemo(
    () => prijslijsten?.reduce((sum, p) => sum + p.klanten.length, 0) ?? 0,
    [prijslijsten],
  )

  if (isLoading) return <PageHeader title="Prijslijsten laden..." />

  return (
    <>
      <PageHeader title="Prijslijsten" />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
          <div className="text-xs text-slate-400 mb-1">Prijslijsten</div>
          <div className="text-2xl font-semibold text-slate-900">{prijslijsten?.length ?? 0}</div>
        </div>
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
          <div className="text-xs text-slate-400 mb-1">Gekoppelde klanten</div>
          <div className="text-2xl font-semibold text-slate-900">{totaalKlanten}</div>
        </div>
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
          <div className="text-xs text-slate-400 mb-1">Zonder klanten</div>
          <div className="text-2xl font-semibold text-slate-900">
            {prijslijsten?.filter((p) => p.klanten.length === 0).length ?? 0}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative w-80">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Zoek op nr, naam of klant..."
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] focus:outline-none focus:ring-1 focus:ring-terracotta-300 focus:border-terracotta-300"
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-3 font-medium w-20">Nr</th>
              <th className="px-5 py-3 font-medium">Naam</th>
              <th className="px-5 py-3 font-medium w-28">Geldig vanaf</th>
              <th className="px-5 py-3 font-medium w-20 text-right">Regels</th>
              <th className="px-5 py-3 font-medium">Gekoppelde klanten</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((p) => (
              <tr key={p.nr} className="hover:bg-slate-50 group">
                <td className="px-5 py-3">
                  <Link
                    to={`/prijslijsten/${p.nr}`}
                    className="font-mono text-xs text-terracotta-500 font-medium hover:underline"
                  >
                    {p.nr}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <Link to={`/prijslijsten/${p.nr}`} className="font-medium text-slate-900 hover:text-terracotta-600">
                    {p.naam}
                  </Link>
                </td>
                <td className="px-5 py-3 text-slate-500">
                  {p.geldig_vanaf
                    ? new Date(p.geldig_vanaf).toLocaleDateString('nl-NL')
                    : '—'}
                </td>
                <td className="px-5 py-3 text-right">
                  <span className="inline-flex items-center gap-1 text-slate-500">
                    <FileSpreadsheet size={13} />
                    {p.aantal_regels}
                  </span>
                </td>
                <td className="px-5 py-3">
                  {p.klanten.length === 0 ? (
                    <span className="text-slate-300 text-xs">Geen klanten</span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Users size={13} className="text-slate-400 flex-shrink-0" />
                      <span className="text-slate-600 truncate max-w-md">
                        {p.klanten.length <= 3
                          ? p.klanten.map((k) => k.naam).join(', ')
                          : `${p.klanten.slice(0, 2).map((k) => k.naam).join(', ')} +${p.klanten.length - 2}`}
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-slate-400">
            Geen prijslijsten gevonden
          </div>
        )}
      </div>
    </>
  )
}
