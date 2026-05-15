import { useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { useLevertijdCheck } from '@/hooks/use-levertijd-check'
import { verzendWeekVoor } from '@/lib/orders/verzendweek'
import type { CheckLevertijdResponse, LevertijdScenario } from '@/lib/supabase/queries/levertijd'

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
  // Spoed-UI is voor nu uitgeschakeld (zie changelog 2026-05-11). Props blijven
  // optioneel in de signatuur zodat call-sites niet hoeven mee te bewegen.
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

// Karpi communiceert leverbeloftes als verzendweek, niet als specifieke dag
// (zie data-woordenboek "Verzendweek"). Format consistent met de order-form
// ("Wk 22 · 2026"). Gebruikt de centrale verzendweek-seam.
function verzendWeekTekst(iso: string | null): string {
  const w = verzendWeekVoor(iso)
  return w ? `Wk ${w.week} · ${w.jaar}` : '—'
}

// Strip geparenthiseerde datums "(DD-MM-YYYY)" uit de backend-onderbouwing —
// de week staat er al naast, de exacte dag is niet wat we communiceren.
function onderbouwingZonderDatums(tekst: string): string {
  return tekst.replace(/\s*\(\d{2}-\d{2}-\d{4}\)/g, '')
}

export function LevertijdSuggestie(props: LevertijdSuggestieProps) {
  const {
    kwaliteitCode, kleurCode, lengteCm, breedteCm, vorm,
    gewensteLeverdatum, debiteurNr, fallbackDatum, onNeemOver,
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
          <span> Indicatie: <span className="font-medium text-slate-700">{verzendWeekTekst(fallbackDatum)}</span></span>
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
              Neem week over
            </button>
          )}
        </div>

        <div>
          <div className="text-xs text-slate-500">Voorgestelde verzendweek</div>
          <div className="text-lg font-semibold text-slate-900">
            {verzendWeekTekst(datumLabel)}
          </div>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">{onderbouwingZonderDatums(data.onderbouwing)}</p>

        {data.details.eerder_haalbaar && (
          <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-emerald-50 border border-emerald-100 px-2.5 py-1.5">
            <div className="text-xs text-emerald-800">
              <span className="font-medium">Eerder haalbaar:</span>{' '}
              <span>{verzendWeekTekst(data.details.eerder_haalbaar.lever_datum)}</span>
              <span className="text-emerald-600"> — snijden in week {data.details.eerder_haalbaar.snij_week}</span>
            </div>
            {onNeemOver && (
              <button
                type="button"
                onClick={() => onNeemOver(data.details.eerder_haalbaar!.lever_datum, isoWeekUit(data.details.eerder_haalbaar!.lever_datum))}
                className="shrink-0 text-xs text-emerald-700 hover:text-emerald-800 hover:underline"
              >
                Neem over
              </button>
            )}
          </div>
        )}

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
    </div>
  )
}

// ISO-weeknummer voor een YYYY-MM-DD datum (UTC). Spiegelt
// `isoWeekJaar` uit de edge function maar geeft alleen het weeknummer terug —
// nodig om `onNeemOver(datum, week)` consistent te kunnen aanroepen vanuit de
// eerder-haalbaar-hint.
function isoWeekUit(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  const dayNr = (utc.getUTCDay() + 6) % 7  // ma=0..zo=6
  utc.setUTCDate(utc.getUTCDate() - dayNr + 3)
  const firstThursday = new Date(Date.UTC(utc.getUTCFullYear(), 0, 4))
  const firstThursdayDayNr = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNr + 3)
  return 1 + Math.round((utc.getTime() - firstThursday.getTime()) / (7 * 86_400_000))
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
