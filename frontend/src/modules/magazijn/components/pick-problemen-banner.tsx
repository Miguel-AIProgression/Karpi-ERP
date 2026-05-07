import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { usePickProblemen } from '../hooks/use-pickronde'

// Compact banner: rendert niets als er geen open pick-problemen zijn. Anders
// een rose-banner bovenaan Pick & Ship met een uitklap-lijst van getroffen
// colli's. Klik op zending opent printset-pagina waar magazijnchef het
// probleem kan oplossen.
export function PickProblemenBanner() {
  const { data: problemen = [] } = usePickProblemen()
  const [open, setOpen] = useState(false)

  if (problemen.length === 0) return null

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-rose-200 bg-rose-50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <AlertCircle size={16} className="text-rose-600 shrink-0" />
        <span className="text-sm font-medium text-rose-800">
          {problemen.length} pick-probleem{problemen.length === 1 ? '' : 'en'} openstaand
        </span>
        <span className="text-xs text-rose-600 ml-1">
          {open ? 'verberg' : 'toon'}
        </span>
        <span className="ml-auto text-rose-600">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {open && (
        <ul className="divide-y divide-rose-100 border-t border-rose-100">
          {problemen.map((p) => (
            <li key={p.colli_id} className="px-4 py-2 text-sm flex items-start gap-3">
              <Link
                to={`/logistiek/${p.zending_nr}/printset`}
                className="inline-flex items-center gap-1 text-rose-700 font-medium hover:underline shrink-0"
              >
                {p.zending_nr}
                <ExternalLink size={11} />
              </Link>
              <span className="text-slate-500 shrink-0">{p.order_nr}</span>
              {p.klant_naam && <span className="text-slate-600 shrink-0">· {p.klant_naam}</span>}
              <span className="text-slate-700 truncate">
                {p.omschrijving_snapshot ?? '—'}
              </span>
              {p.pick_opmerking && (
                <span className="ml-auto text-xs text-rose-600 truncate max-w-xs">
                  ⚠ {p.pick_opmerking}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
