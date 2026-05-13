import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { MultiSelectDropdown } from '@/components/ui/multi-select-dropdown'
import { FactuurLijst } from '@/modules/facturatie'
import { useFacturen } from '../hooks/use-facturen'
import type { FactuurStatus } from '../queries/facturen'

const ALLE_STATUSSEN: FactuurStatus[] = [
  'Concept',
  'Verstuurd',
  'Betaald',
  'Herinnering',
  'Aanmaning',
  'Gecrediteerd',
]

const STATUS_OPTIES = ALLE_STATUSSEN.map((s) => ({ value: s, label: s }))

export function FacturatieOverviewPage() {
  const [zoekterm, setZoekterm] = useState('')
  const [statusSelectie, setStatusSelectie] = useState<string[]>([])
  const [klantSelectie, setKlantSelectie] = useState<string[]>([])

  const { data: facturen = [] } = useFacturen()

  // Klant-keuzes komen uit de feitelijke facturen-lijst — alleen klanten die
  // ook minstens 1 factuur hebben verschijnen in de dropdown. Gesorteerd op
  // naam zodat de operator snel kan scannen.
  const klantOpties = useMemo(() => {
    const map = new Map<number, string>()
    for (const f of facturen) {
      map.set(f.debiteur_nr, f.klant_naam ?? `Debiteur ${f.debiteur_nr}`)
    }
    return Array.from(map, ([debiteur_nr, naam]) => ({
      value: String(debiteur_nr),
      label: naam,
    })).sort((a, b) => a.label.localeCompare(b.label, 'nl', { sensitivity: 'base' }))
  }, [facturen])

  const gefilterd = useMemo(() => {
    const statusSet = new Set(statusSelectie)
    const klantSet = new Set(klantSelectie)
    return facturen.filter((f) => {
      const matchStatus = statusSet.size === 0 || statusSet.has(f.status)
      const matchKlant = klantSet.size === 0 || klantSet.has(String(f.debiteur_nr))
      const q = zoekterm.trim().toLowerCase()
      const matchZoek =
        !q ||
        f.factuur_nr.toLowerCase().includes(q) ||
        (f.klant_naam ?? '').toLowerCase().includes(q)
      return matchStatus && matchKlant && matchZoek
    })
  }, [facturen, zoekterm, statusSelectie, klantSelectie])

  return (
    <>
      <PageHeader
        title="Facturen"
        description={`${gefilterd.length} facturen`}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
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

        <MultiSelectDropdown
          placeholder="Alle statussen"
          options={STATUS_OPTIES}
          selected={statusSelectie}
          onChange={setStatusSelectie}
        />

        <MultiSelectDropdown
          placeholder="Alle klanten"
          options={klantOpties}
          selected={klantSelectie}
          onChange={setKlantSelectie}
          zoekbaar
        />
      </div>

      {/* List */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
        <FactuurLijst items={gefilterd} />
      </div>
    </>
  )
}
