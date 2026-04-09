import { useState } from 'react'
import { ChevronDown, ChevronRight, Printer } from 'lucide-react'
import { SnijVisualisatie } from './snij-visualisatie'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import type { SnijGroep, SnijStuk } from '@/lib/types/productie'

interface WeekGroepAccordionProps {
  groep: SnijGroep
}

export function WeekGroepAccordion({ groep }: WeekGroepAccordionProps) {
  const [open, setOpen] = useState(false)

  // Flatten all stukken across rollen for the simple list view
  const alleStukken = groep.rollen.flatMap((r) => r.stukken)
  const orderCount = new Set(alleStukken.map((s) => s.order_nr)).size
  const hasRol = groep.rollen.some((r) => r.rol_breedte_cm > 0 && r.rol_lengte_cm > 0)

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      {/* Collapsed header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 flex-wrap">
          {open ? (
            <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
          ) : (
            <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
          )}
          <span className="font-medium text-slate-900">
            {groep.kwaliteit_code} {groep.kleur_code}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {orderCount} {orderCount === 1 ? 'order' : 'orders'}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {groep.totaal_stukken} {groep.totaal_stukken === 1 ? 'stuk' : 'stuks'}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {groep.totaal_m2.toFixed(1)} m²
            </span>
            <span
              className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                groep.totaal_gesneden === groep.totaal_stukken
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-amber-100 text-amber-700'
              )}
            >
              {groep.totaal_gesneden}/{groep.totaal_stukken} gesneden
            </span>
          </div>
        </div>
        <Printer size={16} className="text-slate-400 hover:text-slate-600 flex-shrink-0" />
      </button>

      {/* Expanded content: stukkenlijst (SVG alleen tonen als er een rol is) */}
      {open && (
        <div className="border-t border-slate-100 p-4">
          {hasRol && groep.rollen.filter(r => r.rol_breedte_cm > 0).map((voorstel) => (
            <div key={voorstel.rol_id} className="mb-4">
              <div className="text-sm font-medium text-slate-700 mb-2">
                Rol: {voorstel.rolnummer} — {voorstel.rol_breedte_cm} × {voorstel.rol_lengte_cm} cm
              </div>
              <SnijVisualisatie
                rolBreedte={voorstel.rol_breedte_cm}
                rolLengte={voorstel.rol_lengte_cm}
                stukken={voorstel.stukken}
                restLengte={voorstel.rest_lengte_cm}
                afvalPct={voorstel.afval_pct}
                reststukBruikbaar={voorstel.reststuk_bruikbaar}
                className="my-3"
              />
            </div>
          ))}

          {/* Stukkenlijst als tabel */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                <th className="py-2 pr-3">Maat</th>
                <th className="py-2 pr-3">Vorm</th>
                <th className="py-2 pr-3">Klant</th>
                <th className="py-2 pr-3">Order</th>
                <th className="py-2 pr-3">Afwerking</th>
                <th className="py-2 pr-3">Afleverdatum</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {alleStukken.map((stuk, i) => (
                <StukRow key={stuk.snijplan_id ?? i} stuk={stuk} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StukRow({ stuk }: { stuk: SnijStuk }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="py-2 pr-3 font-medium">
        {stuk.breedte_cm}×{stuk.lengte_cm} cm
      </td>
      <td className="py-2 pr-3">
        {(() => {
          const vd = getVormDisplay(stuk.vorm)
          return (
            <span className={cn('text-xs px-1.5 py-0.5 rounded', vd.bg, vd.text)}>
              {vd.label}
            </span>
          )
        })()}
      </td>
      <td className="py-2 pr-3">{stuk.klant_naam}</td>
      <td className="py-2 pr-3 text-slate-500">{stuk.order_nr}</td>
      <td className="py-2 pr-3">
        {stuk.afwerking && AFWERKING_MAP[stuk.afwerking] ? (
          <span className={cn('text-xs px-1.5 py-0.5 rounded', AFWERKING_MAP[stuk.afwerking].bg, AFWERKING_MAP[stuk.afwerking].text)}>
            {stuk.afwerking}
          </span>
        ) : '—'}
      </td>
      <td className="py-2 pr-3 text-slate-500">
        {stuk.afleverdatum ? new Date(stuk.afleverdatum).toLocaleDateString('nl-NL') : '—'}
      </td>
    </tr>
  )
}
