// Planning-tab voor de snijderij werklijst.
//
// Toont een geprojekteerd snijschema, gegroepeerd per week → dag → sessie.
// Sessies zijn gekleurde blokken met kwaliteit, kleur, duur, ordregels en status.

import { useState } from 'react'
import {
  Loader2,
  CalendarDays,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Package,
  Scissors,
  ChevronDown,
  ChevronRight,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { WerklijstKwaliteitGroep } from '@/modules/snijplanning/lib/werklijst-groepering'
import type { WerklijstRow } from '@/modules/snijplanning/queries/werklijst'
import { usePlanningBerekening } from '@/modules/snijplanning/hooks/use-planning-berekening'
import type { PlanningSession, PlanningDag, PlanningWeek, TekortGroep } from '@/modules/snijplanning/lib/planning-berekening'

// ─── Datum-formattering ──────────────────────────────────────────────────────

const DAGNAMEN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function formatDatum(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  const dag = DAGNAMEN[d.getUTCDay()]
  return `${dag} ${d.getUTCDate()} ${MAANDEN[d.getUTCMonth()]}`
}

function formatMinuten(min: number): string {
  if (min < 60) return `${min} min`
  const u = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${u} u` : `${u} u ${m} min`
}

// ─── Sessie-kaart ─────────────────────────────────────────────────────────────

function SessieKaart({ sessie }: { sessie: PlanningSession }) {
  const [open, setOpen] = useState(false)

  const isInBewerking = sessie.isInBewerking
  const heeftIo = sessie.io_regel_id != null

  return (
    <div
      className={cn(
        'rounded-[var(--radius)] border text-sm',
        isInBewerking
          ? 'border-amber-300 bg-amber-50'
          : heeftIo
          ? 'border-blue-200 bg-blue-50'
          : 'border-slate-200 bg-white',
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left"
      >
        {/* Status-icoon */}
        <span className="mt-0.5 shrink-0">
          {isInBewerking ? (
            <Wrench size={14} className="text-amber-500" />
          ) : heeftIo ? (
            <Package size={14} className="text-blue-400" />
          ) : (
            <Scissors size={14} className="text-slate-400" />
          )}
        </span>

        {/* Kwaliteit + kleur */}
        <span className="flex-1 min-w-0">
          <span className="font-medium text-slate-800">
            {sessie.kwaliteit_code} {sessie.kleur_code}
          </span>
          {sessie.rolnummer && (
            <span className="ml-2 text-xs text-slate-400">rol {sessie.rolnummer}</span>
          )}
          {heeftIo && sessie.io_verwacht_datum && (
            <span className="ml-2 text-xs text-blue-500">
              IO verwacht {sessie.io_verwacht_datum}
            </span>
          )}
          {isInBewerking && (
            <span className="ml-2 text-xs font-medium text-amber-600">⚙ In bewerking</span>
          )}
          {sessie.heeftExpress && (
            <span className="ml-2 inline-flex items-center px-1.5 py-0 rounded text-[10px] font-semibold bg-red-100 text-red-700">
              EXPRESS
            </span>
          )}
        </span>

        {/* Stuks + duur */}
        <span className="shrink-0 text-right text-xs text-slate-500">
          <span className="font-medium text-slate-700">{sessie.aantalStuks}×</span>
          {' · '}{formatMinuten(sessie.duurMinuten)}
        </span>

        {/* Open/dicht */}
        <span className="shrink-0 text-slate-400 mt-0.5">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {/* Orderregels */}
      {open && (
        <div className="border-t border-slate-100 px-3 pb-2 pt-1.5 space-y-1">
          {sessie.orderregels.map((rij) => (
            <div key={rij.orderRegelId} className="flex items-center gap-2 text-xs text-slate-600">
              <span className="font-mono text-slate-400">{rij.orderNr}</span>
              <span className="truncate">{rij.klantNaam}</span>
              <span className="ml-auto shrink-0 text-slate-400">
                {rij.aantalStuks}× · wk {rij.verzendweek?.replace(/^\d{4}-W/, '') ?? '?'}
              </span>
            </div>
          ))}
          {sessie.duurMinuten > sessie.snijMinuten && (
            <div className="flex items-center gap-1 text-[10px] text-slate-400 mt-1">
              <Clock size={10} />
              <span>
                snijden {formatMinuten(sessie.snijMinuten)} + wisselen {formatMinuten(sessie.duurMinuten - sessie.snijMinuten)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Dag-kaart ────────────────────────────────────────────────────────────────

function DagKaart({ dag, nettoMinuten }: { dag: PlanningDag; nettoMinuten: number }) {
  const bezettingsPct = Math.round((dag.gebruikteMinuten / nettoMinuten) * 100)
  const isOverloaded = dag.gebruikteMinuten > nettoMinuten

  return (
    <div className="space-y-2">
      {/* Dag-header */}
      <div className="flex items-center gap-2">
        <CalendarDays size={13} className="text-slate-400 shrink-0" />
        <span className="text-xs font-medium text-slate-700">{formatDatum(dag.datum)}</span>
        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden mx-1">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              isOverloaded ? 'bg-red-400' : bezettingsPct > 80 ? 'bg-amber-400' : 'bg-emerald-400',
            )}
            style={{ width: `${Math.min(100, bezettingsPct)}%` }}
          />
        </div>
        <span className={cn('text-xs', isOverloaded ? 'text-red-600 font-medium' : 'text-slate-400')}>
          {formatMinuten(dag.gebruikteMinuten)}/{formatMinuten(nettoMinuten)}
        </span>
        {dag.rollenWaarschuwing && (
          <span className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle size={11} />
            {dag.aantalRollen} rollen
          </span>
        )}
      </div>

      {/* Sessie-kaarten */}
      <div className="pl-5 space-y-1.5">
        {dag.sessies.map((s) => (
          <SessieKaart key={s.sleutel} sessie={s} />
        ))}
      </div>
    </div>
  )
}

// ─── Week-sectie ──────────────────────────────────────────────────────────────

function WeekSectie({
  week,
  nettoMinuten,
  max,
}: {
  week: PlanningWeek
  nettoMinuten: number
  max: number
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-[var(--radius-lg)] border border-slate-200 bg-white overflow-hidden">
      {/* Week-header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="font-semibold text-slate-800 text-sm">
          Week {week.weekLabel.replace(/^\d{4}-W0?/, '')}
        </span>
        <span className="text-xs text-slate-400">{week.weekLabel.slice(0, 4)}</span>
        <span className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium',
              !week.binnenMax
                ? 'bg-red-100 text-red-700'
                : !week.binnenStreef
                ? 'bg-amber-100 text-amber-700'
                : 'bg-emerald-100 text-emerald-700',
            )}
          >
            {week.aantalStuks}/{max} stuks
          </span>
          {week.binnenStreef && (
            <CheckCircle2 size={13} className="text-emerald-500" />
          )}
          {!week.binnenMax && (
            <AlertTriangle size={13} className="text-red-500" />
          )}
          {open ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
        </span>
      </button>

      {/* Dagen */}
      {open && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-4">
          {week.dagen.map((dag) => (
            <DagKaart key={dag.datum} dag={dag} nettoMinuten={nettoMinuten} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tekort-sectie ────────────────────────────────────────────────────────────

function TekortSectie({ tekortGroepen }: { tekortGroepen: TekortGroep[] }) {
  const [open, setOpen] = useState(false)
  if (tekortGroepen.length === 0) return null

  const totaalStuks = tekortGroepen.reduce((s, g) => s + g.aantalStuks, 0)

  return (
    <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <AlertTriangle size={14} className="text-red-500 shrink-0" />
        <span className="font-medium text-red-700 text-sm">
          Tekort — {totaalStuks} stukken niet planbaar
        </span>
        <span className="ml-auto text-xs text-red-400">
          {tekortGroepen.length} kwaliteiten
          {open ? <ChevronDown size={13} className="inline ml-1" /> : <ChevronRight size={13} className="inline ml-1" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-red-200 px-4 py-3 space-y-1">
          {tekortGroepen.map((g) => (
            <div key={`${g.kwaliteit_code}|${g.kleur_code}`} className="flex items-center gap-2 text-sm text-red-700">
              <span className="font-medium">{g.kwaliteit_code} {g.kleur_code}</span>
              <span className="text-red-400">{g.aantalStuks} stukken</span>
              <span className="ml-auto text-xs text-red-400">{g.orderregels.length} orders</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Startdatum-picker ────────────────────────────────────────────────────────

function StartdatumPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <CalendarDays size={14} className="text-slate-400" />
      <label className="text-slate-600">Starten op</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-slate-200 rounded-[var(--radius-sm)] px-2 py-1 text-sm text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
      />
    </div>
  )
}

// ─── Hoofd-component ──────────────────────────────────────────────────────────

function volgendeWerkdagVanaf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  // Skip weekend
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export interface PlanningTabProps {
  groepen: WerklijstKwaliteitGroep[]
  rawStukken: WerklijstRow[]
  isWerklijstLoading: boolean
}

export function PlanningTab({ groepen, rawStukken, isWerklijstLoading }: PlanningTabProps) {
  const [startdatum, setStartdatum] = useState(() => volgendeWerkdagVanaf(new Date().toISOString().slice(0, 10)))

  const { resultaat, isLoading, error } = usePlanningBerekening(groepen, rawStukken, startdatum)

  const totaalLoading = isWerklijstLoading || isLoading

  // Capaciteitslimieten (defaults als config niet beschikbaar)
  const max = 400
  const nettoMinuten = 480  // 08:00-17:00 minus pauzes

  if (totaalLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-400">
        <Loader2 size={22} className="animate-spin mr-3" />
        Planning berekenen…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Fout bij berekenen: {error.message}
      </div>
    )
  }

  if (!resultaat || groepen.length === 0) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <StartdatumPicker value={startdatum} onChange={setStartdatum} />
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-12 text-center">
          <p className="text-slate-400 text-sm">Geen openstaande maatwerk-stukken om in te plannen.</p>
        </div>
      </div>
    )
  }

  const { weken, tekortGroepen, sessiesGepland, stukkenGepland, stukkenTekort, eersteSnijdatum, laatsteSnijdatum } = resultaat

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-4 justify-between">
        <StartdatumPicker value={startdatum} onChange={setStartdatum} />
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>{sessiesGepland} sessies gepland</span>
          <span>{stukkenGepland} stukken</span>
          {stukkenTekort > 0 && (
            <span className="text-red-600 font-medium">{stukkenTekort} tekort</span>
          )}
          {eersteSnijdatum && (
            <span>
              {formatDatum(eersteSnijdatum)}
              {laatsteSnijdatum && eersteSnijdatum !== laatsteSnijdatum && (
                <> — {formatDatum(laatsteSnijdatum)}</>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Tekort bovenaan als waarschuwing */}
      <TekortSectie tekortGroepen={tekortGroepen} />

      {/* Weken */}
      {weken.map((week) => (
        <WeekSectie
          key={week.weekLabel}
          week={week}
          nettoMinuten={nettoMinuten}
          max={max}
        />
      ))}
    </div>
  )
}
