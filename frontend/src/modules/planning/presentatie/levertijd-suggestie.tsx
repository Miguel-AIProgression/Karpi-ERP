import { useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { useLevertijdCheck } from '@/hooks/use-levertijd-check'
import type { CheckLevertijdResponse, LevertijdScenario, SpoedDetails } from '@/lib/supabase/queries/levertijd'

interface LevertijdSuggestieProps {
  kwaliteitCode?: string | null
  kleurCode?: string | null
  lengteCm?: number | null
  breedteCm?: number | null
  vorm?: string | null
  gewensteLeverdatum?: string | null
  debiteurNr?: number | null
  fallbackDatum?: string | null
  onNeemOver?: (leverDatum: string, week: number) => void
  spoedActief?: boolean
  onSpoedToggle?: (actief: boolean, leverDatum: string | null, week: number | null, toeslag: number) => void
}

const SCENARIO_BADGE: Record<LevertijdScenario, { label: string; bg: string; text: string }> = {
  match_bestaande_rol: { label: 'Past op bestaande rol', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  nieuwe_rol_gepland: { label: 'Nieuwe rol gepland', bg: 'bg-blue-100', text: 'text-blue-700' },
  wacht_op_orders: { label: 'Wacht op meer orders', bg: 'bg-amber-100', text: 'text-amber-700' },
  spoed: { label: 'Spoed', bg: 'bg-rose-100', text: 'text-rose-700' },
}

function formatDatumNL(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

export function LevertijdSuggestie(props: LevertijdSuggestieProps) {
  const {
    kwaliteitCode, kleurCode, lengteCm, breedteCm, vorm,
    gewensteLeverdatum, debiteurNr, fallbackDatum, onNeemOver,
    spoedActief, onSpoedToggle,
  } = props
  const [showDetails, setShowDetails] = useState(false)

  const query = useLevertijdCheck({
    kwaliteitCode, kleurCode, lengteCm, breedteCm,
    vorm: vorm ?? undefined,
    gewensteLeverdatum: gewensteLeverdatum ?? undefined,
    debiteurNr: debiteurNr ?? undefined,
  })

  // Niets tonen als velden incompleet zijn
  if (!kwaliteitCode || !kleurCode || !lengteCm || !breedteCm) return null

  if (query.isLoading || query.isFetching) {
    return (
      <div className="border border-slate-200 rounded-[var(--radius-sm)] p-3 bg-white animate-pulse">
        <div className="h-4 w-24 bg-slate-100 rounded mb-2"></div>
        <div className="h-6 w-40 bg-slate-100 rounded"></div>
      </div>
    )
  }

  if (query.error) {
    return (
      <div className="border border-slate-200 rounded-[var(--radius-sm)] p-3 bg-slate-50 text-xs text-slate-500">
        Real-time levertijd-check niet beschikbaar.
        {fallbackDatum && (
          <span> Indicatie: <span className="font-medium text-slate-700">{formatDatumNL(fallbackDatum)}</span></span>
        )}
      </div>
    )
  }

  const data = query.data
  if (!data) return null

  const badge = SCENARIO_BADGE[data.scenario]
  const datumLabel = data.lever_datum ?? data.vroegst_mogelijk ?? null

  return (
    <div className="border border-slate-200 rounded-[var(--radius-sm)] bg-white">
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', badge.bg, badge.text)}>
            {badge.label}
          </span>
          {data.lever_datum && onNeemOver && (
            <button
              type="button"
              onClick={() => onNeemOver(data.lever_datum!, data.week)}
              className="text-xs text-terracotta-600 hover:text-terracotta-700 hover:underline"
            >
              Neem datum over
            </button>
          )}
        </div>

        <div>
          <div className="text-xs text-slate-500">Voorgestelde leverdatum</div>
          <div className="text-lg font-semibold text-slate-900">
            {formatDatumNL(datumLabel)}
            {data.week > 0 && (
              <span className="text-sm font-normal text-slate-500 ml-2">— week {data.week}</span>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">{data.onderbouwing}</p>

        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-xs text-slate-500 hover:text-slate-700"
        >
          {showDetails ? 'Verberg details' : 'Toon details'}
        </button>
      </div>

      {showDetails && <DetailsPanel data={data} />}

      {data.scenario === 'spoed' && (
        <div className="px-3 py-2 bg-rose-50 border-t border-rose-100 text-xs text-rose-700">
          ⚡ Gewenste datum binnen 2 dagen — bel productie voor handmatige inplanning.
        </div>
      )}

      {data.spoed && (
        <SpoedToggle
          spoed={data.spoed}
          actief={spoedActief ?? false}
          onChange={(actief) => onSpoedToggle?.(
            actief,
            data.spoed!.lever_datum,
            data.spoed!.week,
            data.spoed!.toeslag_bedrag,
          )}
        />
      )}
    </div>
  )
}

function SpoedToggle({ spoed, actief, onChange }: {
  spoed: SpoedDetails
  actief: boolean
  onChange: (a: boolean) => void
}) {
  if (!spoed.beschikbaar) {
    // Geen ruimte = bestaande backlog loopt al achter (rollen die te laat
    // gesneden worden) OF beide weken zijn vol qua capaciteit.
    const backlogAchter = spoed.week_restruimte_uren.deze === 0 && spoed.week_restruimte_uren.volgende === 0
    const reden = backlogAchter
      ? 'planner zit al achter (rollen op de planning worden te laat gesneden)'
      : `beide weken zijn vol (rest deze week: ${spoed.week_restruimte_uren.deze}u, volgende: ${spoed.week_restruimte_uren.volgende}u)`
    return (
      <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 text-xs text-slate-500">
        🚀 Spoed niet mogelijk — {reden}.
      </div>
    )
  }
  return (
    <label className="flex items-start gap-2 px-3 py-2 bg-amber-50 border-t border-amber-100 cursor-pointer hover:bg-amber-100 transition-colors">
      <input
        type="checkbox"
        checked={actief}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 rounded border-amber-400 text-amber-600 focus:ring-amber-400/30"
      />
      <div className="text-xs">
        <div className="font-medium text-amber-900">
          🚀 Met spoed leveren — {formatDatumNL(spoed.lever_datum)} (+€{spoed.toeslag_bedrag})
        </div>
        <div className="text-amber-700 mt-0.5">
          Snijden in {spoed.scenario === 'spoed_deze_week' ? 'deze week' : 'volgende week'}.
          Voegt SPOEDTOESLAG-regel toe aan de order.
        </div>
      </div>
    </label>
  )
}

function DetailsPanel({ data }: { data: CheckLevertijdResponse }) {
  const d = data.details
  return (
    <div className="border-t border-slate-100 px-3 py-2 bg-slate-50 text-xs space-y-1.5">
      {d.match_rol && (
        <Row label="Rol" value={`${d.match_rol.rolnummer} (snij ${formatDatumNL(d.match_rol.snij_datum)}, ${d.match_rol.kwaliteit_match})`} />
      )}
      {d.capaciteit && (
        <Row
          label="Capaciteit"
          value={`week ${d.capaciteit.week}: ${d.capaciteit.huidig_stuks}/${d.capaciteit.max_stuks} stuks (${d.capaciteit.ruimte_stuks} vrij)`}
        />
      )}
      {d.backlog && (
        <Row
          label="Backlog"
          value={`${d.backlog.totaal_m2.toFixed(1)} m² (${d.backlog.aantal_stukken} stuks), drempel ${d.backlog.drempel_m2} m²`}
        />
      )}
      <Row label="Logistieke buffer" value={`${d.logistieke_buffer_dagen} dag(en)`} />
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-500 min-w-[110px]">{label}:</span>
      <span className="text-slate-700">{value}</span>
    </div>
  )
}
