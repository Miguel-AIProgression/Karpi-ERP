import { useState } from 'react'
import { Clock } from 'lucide-react'
import type { SnijvoorstelFifo } from '@/lib/types/productie'

// ---------------------------------------------------------------------------
// Subtiele FIFO-magazijnleeftijd-badge (ADR-0021)
//
// Bewust onopvallend: bij 'grijs' (leeftijd speelde niet / 0 extra afval) tonen
// we niets. Pas wanneer de leeftijd-voorkeur meetbaar extra snijafval kost
// kleurt een klein pill-tabje geel/rood; uitklappen toont de afweging.
// ---------------------------------------------------------------------------

interface FifoBadgeProps {
  fifo: SnijvoorstelFifo | null | undefined
}

export function FifoBadge({ fifo }: FifoBadgeProps) {
  const [open, setOpen] = useState(false)

  if (!fifo || fifo.badge === 'grijs') return null

  const kleur =
    fifo.badge === 'rood'
      ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
      : 'bg-amber-50 text-amber-600 border-amber-200 hover:bg-amber-100'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${kleur}`}
        title="FIFO-magazijnleeftijd — klik voor de afweging"
      >
        <Clock size={11} />
        +{fifo.extra_afval_m2.toFixed(1)} m²
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-72 rounded-md border border-slate-200 bg-white p-3 text-xs shadow-lg">
          <p className="mb-2 text-slate-600">{fifo.reden}</p>
          <dl className="space-y-1 text-slate-500">
            <div className="flex justify-between">
              <dt>Extra snijafval</dt>
              <dd className="font-medium text-slate-700">
                {fifo.extra_afval_m2.toFixed(1)} m² ({fifo.extra_afval_pct.toFixed(0)}%)
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Oudste rol verwerkt</dt>
              <dd className="font-medium text-slate-700">
                {fifo.oudste_rol_dagen} dgn{' '}
                <span className="text-slate-400">
                  (efficiëntst: {fifo.efficient_oudste_rol_dagen} dgn)
                </span>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>Rolwissels</dt>
              <dd className="font-medium text-slate-700">
                {fifo.rolwissels}{' '}
                <span className="text-slate-400">
                  (efficiëntst: {fifo.efficient_rolwissels})
                </span>
              </dd>
            </div>
          </dl>
          {fifo.rationale.length > 0 && (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <p className="mb-1 text-slate-400">Oude rollen weggesneden:</p>
              <ul className="space-y-0.5">
                {fifo.rationale.map((r) => (
                  <li key={r.rol_id} className="flex justify-between text-slate-600">
                    <span className="font-mono">{r.rolnummer}</span>
                    <span>{r.leeftijd_dagen} dgn</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
