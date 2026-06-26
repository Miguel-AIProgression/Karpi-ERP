import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import { usePickProblemen } from '../hooks/use-pickronde'

// Compact banner: rendert niets als er geen open pick-problemen zijn. Anders
// een amber-banner bovenaan Pick & Ship met een uitklap-lijst van getroffen
// colli's. Sinds mig 518 blokkeren niet-gevonden colli de zending niet meer —
// ze gaan naar de Manco-werklijst waar de binnendienst ze afhandelt.
export function PickProblemenBanner() {
  const { data: problemen = [] } = usePickProblemen()
  const [open, setOpen] = useState(false)

  if (problemen.length === 0) return null

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-amber-200 bg-amber-50">
      <div className="flex w-full items-center gap-2 px-4 py-2.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <AlertCircle size={16} className="text-amber-600 shrink-0" />
          <span className="text-sm font-medium text-amber-800">
            {problemen.length} niet-gevonden colli — afhandelen op de Manco-werklijst
          </span>
          <span className="text-xs text-amber-600 ml-1">
            {open ? 'verberg' : 'toon'}
          </span>
          <span className="ml-auto text-amber-600">
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>
        <Link
          to="/orders?status=Manco"
          className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline shrink-0"
        >
          Naar Manco
          <ExternalLink size={11} />
        </Link>
      </div>

      {open && (
        <ul className="divide-y divide-amber-100 border-t border-amber-100">
          {problemen.map((p) => (
            <li key={p.colli_id} className="px-4 py-2 text-sm flex items-start gap-3">
              <Link
                to={`/logistiek/${p.zending_nr}/printset`}
                className="inline-flex items-center gap-1 text-amber-700 font-medium hover:underline shrink-0"
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
                <span className="ml-auto text-xs text-amber-600 truncate max-w-xs">
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
