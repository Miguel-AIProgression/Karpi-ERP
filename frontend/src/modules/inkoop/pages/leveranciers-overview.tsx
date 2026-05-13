import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useLeveranciersOverzicht } from '@/hooks/use-leveranciers'
import { LeverancierFormDialog } from '@/components/leveranciers/leverancier-form-dialog'

function formatMeters(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 0, maximumFractionDigits: 1 })
}

function formatDatum(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function LeveranciersOverviewPage() {
  const navigate = useNavigate()
  const { data: leveranciers = [], isLoading } = useLeveranciersOverzicht()
  const [zoekterm, setZoekterm] = useState('')
  const [toonInactief, setToonInactief] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  const gefilterd = useMemo(() => {
    const q = zoekterm.trim().toLowerCase()
    return leveranciers.filter((l) => {
      if (!toonInactief && !l.actief) return false
      if (!q) return true
      return (
        l.naam.toLowerCase().includes(q) ||
        (l.woonplaats ?? '').toLowerCase().includes(q) ||
        (l.leverancier_nr !== null && String(l.leverancier_nr).includes(q))
      )
    })
  }, [leveranciers, zoekterm, toonInactief])

  const totaalOpen = gefilterd.reduce((s, l) => s + l.openstaande_meters, 0)

  return (
    <>
      <PageHeader
        title="Leveranciers"
        description={`${gefilterd.length} leveranciers · ${formatMeters(totaalOpen)} openstaand (m + st.)`}
        actions={
          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 transition-colors"
          >
            <Plus size={16} />
            Nieuwe leverancier
          </button>
        }
      />

      <div className="flex items-center gap-3 mb-5">
        <div className="relative w-96">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={zoekterm}
            onChange={(e) => setZoekterm(e.target.value)}
            placeholder="Zoek op naam, woonplaats of nummer…"
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={toonInactief}
            onChange={(e) => setToonInactief(e.target.checked)}
            className="rounded border-slate-300"
          />
          Toon inactief
        </label>
      </div>

      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">Leveranciers laden…</div>
        ) : gefilterd.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Building2 size={32} className="mx-auto mb-2 text-slate-300" />
            Geen leveranciers gevonden
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Nr.</th>
                <th className="px-4 py-3 text-left font-medium">Naam</th>
                <th className="px-4 py-3 text-left font-medium">Woonplaats</th>
                <th className="px-4 py-3 text-right font-medium">Openstaande orders</th>
                <th className="px-4 py-3 text-right font-medium">Openstaand</th>
                <th className="px-4 py-3 text-left font-medium">Eerstvolgende</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gefilterd.map((l) => (
                <tr
                  key={l.id}
                  onClick={() => navigate(`/leveranciers/${l.id}`)}
                  className="hover:bg-slate-50/60 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3 text-slate-500 tabular-nums">{l.leverancier_nr ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-slate-800">{l.naam}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{l.woonplaats ?? '-'}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {l.openstaande_orders > 0 ? (
                      <span className="font-medium text-slate-800">{l.openstaande_orders}</span>
                    ) : (
                      <span className="text-slate-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {l.openstaande_meters > 0 ? (
                      <span className="font-medium text-slate-800">{formatMeters(l.openstaande_meters)}</span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatDatum(l.eerstvolgende_levering)}</td>
                  <td className="px-4 py-3">
                    {l.actief ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">
                        Actief
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500">
                        Inactief
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {formOpen && <LeverancierFormDialog onClose={() => setFormOpen(false)} />}
    </>
  )
}
