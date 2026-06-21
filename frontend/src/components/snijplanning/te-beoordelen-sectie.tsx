import { Link } from 'react-router-dom'
import { AlertTriangle, Check, X } from 'lucide-react'
import { formatDate } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { useKeurSnijvoorstelGoed, useVerwerpSnijvoorstel, type ConceptVoorstelRow } from '@/modules/snijplanning'

// Mig 459: voorstellen die auto-plan-groep bewust als 'concept' liet liggen
// (verdringingsrisico of rode FIFO-badge) — geen automatische actie, een
// planner moet de afweging zien en zelf goedkeuren/afwijzen. Spiegelt
// wacht-op-inkoop-sectie.tsx qua opzet (kaart per groep, eigen kleurthema).

interface TeBeoordelenSectieProps {
  voorstellen: ConceptVoorstelRow[]
}

export function TeBeoordelenSectie({ voorstellen }: TeBeoordelenSectieProps) {
  if (voorstellen.length === 0) {
    return (
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
        Geen voorstellen wachten op beoordeling
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {voorstellen.map((v) => (
        <ConceptVoorstelCard key={v.id} voorstel={v} />
      ))}
    </div>
  )
}

function ConceptVoorstelCard({ voorstel: v }: { voorstel: ConceptVoorstelRow }) {
  const kleurLabel = v.kleur_code.replace(/\.0$/, '')
  const info = v.verdringing_info
  const keur = useKeurSnijvoorstelGoed()
  const verwerp = useVerwerpSnijvoorstel()
  const pending = keur.isPending || verwerp.isPending

  return (
    <div className="rounded-[var(--radius-sm)] border border-purple-200 bg-purple-50 overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 flex-wrap text-xs font-medium text-purple-800">
        <AlertTriangle size={14} className="flex-shrink-0" />
        <span className="text-sm font-semibold text-slate-900">
          {v.kwaliteit_code} {kleurLabel}
        </span>
        <span className="text-slate-500 font-normal">
          {v.voorstel_nr} · {v.totaal_stukken} stukken · {v.totaal_rollen} rollen · {v.afval_percentage}% afval
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => verwerp.mutate(v.id)}
            disabled={pending}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-50"
          >
            <X size={12} /> Afwijzen
          </button>
          <button
            onClick={() => keur.mutate(v.id)}
            disabled={pending}
            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-white bg-terracotta-500 rounded hover:bg-terracotta-600 disabled:opacity-50"
          >
            <Check size={12} /> Goedkeuren
          </button>
        </div>
      </div>

      <div className="bg-white divide-y divide-purple-100 text-sm">
        {info?.reden && (
          <div className="px-3 py-2 text-slate-700">{info.reden}</div>
        )}

        {info && info.verdrongen_orders.length > 0 && (
          <div className="px-3 py-2">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
              Verdrongen orders ({info.verdrongen_orders.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {info.verdrongen_orders.map((o) => (
                <Link
                  key={o.snijplan_id}
                  to={`/orders/${o.order_id}`}
                  className="text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-700 hover:bg-red-100 whitespace-nowrap"
                  title={o.snijplan_nr ?? undefined}
                >
                  {o.order_nr ?? `order ${o.order_id}`}
                </Link>
              ))}
            </div>
          </div>
        )}

        {info?.wacht_op_inkoop && info.wacht_op_inkoop.regels.length > 0 && (
          <div className="px-3 py-2">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">
              Wacht op inkoop ({info.wacht_op_inkoop.aantal_stukken} stukken)
            </div>
            <div className="space-y-1">
              {info.wacht_op_inkoop.regels.map((r, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                    {r.inkooporder_nr}
                  </span>
                  {r.is_achterstallig && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">
                      <AlertTriangle size={10} /> ETA verstreken
                    </span>
                  )}
                  <span className={cn(r.is_achterstallig ? 'text-red-600 font-medium' : 'text-slate-500')}>
                    verwacht{r.verwacht_datum ? ` ${formatDate(r.verwacht_datum)}` : ' onbekend'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(keur.isError || verwerp.isError) && (
          <div className="px-3 py-2 text-xs text-red-600">
            Fout: {((keur.error ?? verwerp.error) as Error).message}
          </div>
        )}
      </div>
    </div>
  )
}
