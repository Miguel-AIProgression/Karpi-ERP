import { useEffect, useState, type FormEvent } from 'react'
import { X, Download } from 'lucide-react'
import { fetchCbsExport } from '../queries/cbs-export'
import { downloadCbsExportTsv } from '../lib/cbs-export-tsv'

interface Props {
  open: boolean
  onClose: () => void
}

export function CbsExportDialog({ open, onClose }: Props) {
  const vandaag = new Date().toISOString().slice(0, 10)
  const eersteVanMaand = vandaag.slice(0, 8) + '01'
  const [vanDatum, setVanDatum] = useState(eersteVanMaand)
  const [totDatum, setTotDatum] = useState(vandaag)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [resultaat, setResultaat] = useState<{ aantal: number; zonderCode: number } | null>(null)

  useEffect(() => {
    if (!open) {
      setVanDatum(eersteVanMaand)
      setTotDatum(vandaag)
      setBezig(false)
      setFout(null)
      setResultaat(null)
    }
  }, [open, vandaag, eersteVanMaand])

  if (!open) return null

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFout(null)
    setResultaat(null)
    if (vanDatum > totDatum) {
      setFout('Van-datum moet vóór of gelijk aan tot-datum liggen.')
      return
    }
    setBezig(true)
    try {
      const rijen = await fetchCbsExport(vanDatum, totDatum)
      if (rijen.length === 0) {
        setFout('Geen buitenlandse (btw-verlegde) facturen gevonden in deze periode.')
        setBezig(false)
        return
      }
      downloadCbsExportTsv({ rijen, vanDatum, totDatum })
      const zonderCode = rijen.filter((r) => !r.goederencode).length
      setResultaat({ aantal: rijen.length, zonderCode })
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-md">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-medium text-lg">CBS-export (Intrastat)</h2>
            <p className="text-sm text-slate-500">
              Tab-separated bestand voor de maandelijkse CBS-aangifte
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700"
            aria-label="Sluiten"
          >
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-slate-600 mb-1">Van</span>
              <input
                type="date"
                value={vanDatum}
                onChange={(e) => setVanDatum(e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                required
              />
            </label>
            <label className="block">
              <span className="block text-slate-600 mb-1">Tot &amp; met</span>
              <input
                type="date"
                value={totDatum}
                onChange={(e) => setTotDatum(e.target.value)}
                className="w-full rounded-[var(--radius-sm)] border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                required
              />
            </label>
          </div>

          <p className="text-xs text-slate-500">
            Bevat alle buitenlandse (intracommunautaire, btw-verlegde)
            factuurregels met factuurdatum binnen de geselecteerde periode —
            1 rij per factuurregel, conform de oude Basta-aangifte-export.
          </p>

          {fout && (
            <div className="rounded border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2">
              {fout}
            </div>
          )}
          {resultaat && !fout && (
            <div className="rounded border border-emerald-200 bg-emerald-50 text-emerald-700 text-xs px-3 py-2">
              {resultaat.aantal} regel{resultaat.aantal === 1 ? '' : 's'} geëxporteerd.
            </div>
          )}
          {resultaat && resultaat.zonderCode > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 text-amber-700 text-xs px-3 py-2">
              {resultaat.zonderCode} regel{resultaat.zonderCode === 1 ? '' : 's'} zonder
              goederencode (kwaliteit nog niet gekoppeld) — controleer vóór
              het indienen bij CBS.
            </div>
          )}

          <footer className="flex justify-end gap-2 pt-3 border-t border-slate-200 -mx-6 px-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded border border-slate-300 hover:bg-slate-50"
            >
              Sluiten
            </button>
            <button
              type="submit"
              disabled={bezig}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Download size={14} />
              {bezig ? 'Bezig…' : 'Downloaden'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  )
}
