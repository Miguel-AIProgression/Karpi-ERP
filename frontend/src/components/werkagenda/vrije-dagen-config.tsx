import { useState } from 'react'
import { CalendarOff, Plus, Trash2 } from 'lucide-react'
import type { Werktijden, FeestdagVrij } from '@/lib/utils/bereken-agenda'

interface Props {
  werktijden: Werktijden
  onChange: (w: Werktijden) => void
}

function fmtNL(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

export function VrijeDagenConfig({ werktijden, onChange }: Props) {
  const [datum, setDatum] = useState('')
  const [naam, setNaam] = useState('')

  const vrij = werktijden.vrij ?? []
  const sorted = [...vrij].sort((a, b) => a.datum.localeCompare(b.datum))

  function voegToe() {
    if (!datum) return
    if (vrij.some((v) => v.datum === datum)) {
      setDatum(''); setNaam(''); return
    }
    const nieuw: FeestdagVrij = naam.trim() ? { datum, naam: naam.trim() } : { datum }
    onChange({ ...werktijden, vrij: [...vrij, nieuw] })
    setDatum(''); setNaam('')
  }

  function verwijder(iso: string) {
    onChange({ ...werktijden, vrij: vrij.filter((v) => v.datum !== iso) })
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6">
      <div className="flex items-center gap-2 mb-4">
        <CalendarOff size={18} className="text-slate-500" />
        <h2 className="text-lg font-semibold text-slate-900">Vrije dagen</h2>
        <span className="text-xs text-slate-400 ml-auto">{vrij.length} dagen</span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Blokkeer specifieke dagen (feestdagen, vakantie, bedrijfssluiting). Op deze dagen wordt niets ingepland.
      </p>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1">Datum</label>
          <input
            type="date"
            value={datum}
            onChange={(e) => setDatum(e.target.value)}
            className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs text-slate-500 uppercase tracking-wide mb-1">Naam (optioneel)</label>
          <input
            type="text"
            value={naam}
            onChange={(e) => setNaam(e.target.value)}
            placeholder="Bijv. Koningsdag, 2e Pinksterdag"
            className="w-full px-3 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
            onKeyDown={(e) => e.key === 'Enter' && voegToe()}
          />
        </div>
        <button
          onClick={voegToe}
          disabled={!datum}
          className="flex items-center gap-1 px-3 py-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-40"
        >
          <Plus size={14} /> Toevoegen
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="text-sm text-slate-400 italic">Geen vrije dagen ingesteld.</div>
      ) : (
        <ul className="divide-y divide-slate-100 border border-slate-100 rounded-[var(--radius-sm)]">
          {sorted.map((v) => (
            <li key={v.datum} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="font-medium tabular-nums w-24">{fmtNL(v.datum)}</span>
              <span className="flex-1 text-slate-600">{v.naam ?? <span className="text-slate-300">—</span>}</span>
              <button
                onClick={() => verwijder(v.datum)}
                className="p-1 text-slate-400 hover:text-red-600 transition-colors"
                title="Verwijderen"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
