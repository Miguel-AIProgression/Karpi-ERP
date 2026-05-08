import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { FactuurLijst } from '@/components/facturatie/factuur-lijst'
import { useFacturen } from '@/hooks/use-facturen'
import type { FactuurStatus } from '@/lib/supabase/queries/facturen'

const ALLE_STATUSSEN: FactuurStatus[] = [
  'Concept',
  'Verstuurd',
  'Betaald',
  'Herinnering',
  'Aanmaning',
  'Gecrediteerd',
]

export function FacturatieOverviewPage() {
  const [zoekterm, setZoekterm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('Alle')

  const { data: facturen = [] } = useFacturen()

  const gefilterd = useMemo(() => {
    return facturen.filter((f) => {
      const matchStatus =
        statusFilter === 'Alle' || f.status === statusFilter
      const q = zoekterm.trim().toLowerCase()
      const matchZoek =
        !q ||
        f.factuur_nr.toLowerCase().includes(q) ||
        (f.klant_naam ?? '').toLowerCase().includes(q)
      return matchStatus && matchZoek
    })
  }, [facturen, zoekterm, statusFilter])

  return (
    <>
      <PageHeader
        title="Facturen"
        description={`${gefilterd.length} facturen`}
      />

      {/* Filters */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative w-72">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={zoekterm}
            onChange={(e) => setZoekterm(e.target.value)}
            placeholder="Zoek op factuurnr of klant…"
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="py-2 px-3 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400 bg-white"
        >
          <option value="Alle">Alle statussen</option>
          {ALLE_STATUSSEN.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
        <FactuurLijst items={gefilterd} />
      </div>
    </>
  )
}
