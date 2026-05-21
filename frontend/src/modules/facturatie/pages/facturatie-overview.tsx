import { useState, useMemo } from 'react'
import { Search, FileDown } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { MultiSelectDropdown } from '@/components/ui/multi-select-dropdown'
import { FactuurLijst } from '@/modules/facturatie'
import { useFacturen } from '../hooks/use-facturen'
import type { FactuurStatus } from '../queries/facturen'
import { VerkoopoverzichtExportDialog } from '../components/verkoopoverzicht-export-dialog'
import { FactuurBulkBalk } from '../components/factuur-bulk-balk'

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
  const [datumVan, setDatumVan] = useState('')
  const [datumTot, setDatumTot] = useState('')
  const [selectie, setSelectie] = useState<Set<number>>(new Set())
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

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
      // Datum-vergelijking op ISO-strings — facturen.factuurdatum is een
      // ISO-date (YYYY-MM-DD), input-values zijn ook YYYY-MM-DD, dus
      // lexicale vergelijking = chronologische vergelijking.
      const matchDatum =
        (!datumVan || f.factuurdatum >= datumVan) &&
        (!datumTot || f.factuurdatum <= datumTot)
      const q = zoekterm.trim().toLowerCase()
      const matchZoek =
        !q ||
        f.factuur_nr.toLowerCase().includes(q) ||
        (f.klant_naam ?? '').toLowerCase().includes(q)
      return matchStatus && matchKlant && matchDatum && matchZoek
    })
  }, [facturen, zoekterm, statusSelectie, klantSelectie, datumVan, datumTot])

  function toggle(id: number) {
    setSelectie((huidig) => {
      const nieuw = new Set(huidig)
      if (nieuw.has(id)) nieuw.delete(id)
      else nieuw.add(id)
      return nieuw
    })
  }

  function toggleAlles(zichtbareIds: number[], aan: boolean) {
    setSelectie((huidig) => {
      const nieuw = new Set(huidig)
      if (aan) zichtbareIds.forEach((id) => nieuw.add(id))
      else zichtbareIds.forEach((id) => nieuw.delete(id))
      return nieuw
    })
  }

  function clearSelectie() {
    setSelectie(new Set())
  }

  const geselecteerdeIds = useMemo(() => Array.from(selectie), [selectie])

  return (
    <>
      <PageHeader
        title="Facturen"
        description={`${gefilterd.length} facturen`}
        actions={
          <button
            type="button"
            onClick={() => setExportDialogOpen(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-[var(--radius-sm)] border border-slate-300 bg-white hover:bg-slate-50 text-slate-700"
          >
            <FileDown size={14} />
            Verkoopoverzicht
          </button>
        }
      />

      <VerkoopoverzichtExportDialog
        open={exportDialogOpen}
        onClose={() => setExportDialogOpen(false)}
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

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500">Van</label>
          <input
            type="date"
            value={datumVan}
            onChange={(e) => setDatumVan(e.target.value)}
            className="py-2 px-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
          <label className="text-xs text-slate-500">Tot</label>
          <input
            type="date"
            value={datumTot}
            onChange={(e) => setDatumTot(e.target.value)}
            className="py-2 px-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
          {(datumVan || datumTot) && (
            <button
              type="button"
              onClick={() => {
                setDatumVan('')
                setDatumTot('')
              }}
              className="text-xs text-slate-500 hover:text-slate-700"
            >
              Wis
            </button>
          )}
        </div>
      </div>

      {/* Bulk-actie-balk */}
      <FactuurBulkBalk
        geselecteerdeIds={geselecteerdeIds}
        onClear={clearSelectie}
        onKlaar={clearSelectie}
      />

      {/* List */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
        <FactuurLijst
          items={gefilterd}
          selectie={selectie}
          onToggle={toggle}
          onToggleAlles={toggleAlles}
        />
      </div>
    </>
  )
}
