// Planning-tab voor de snijderij werklijst.
//
// Toont een geprojekteerd snijschema, gegroepeerd per week → dag → sessie.
// Sessies zijn gekleurde blokken met kwaliteit, kleur, duur, ordregels en status.

import { useState } from 'react'
import { Link } from 'react-router-dom'
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
  ExternalLink,
  Layers,
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { WerklijstKwaliteitGroep } from '@/modules/snijplanning/lib/werklijst-groepering'
import type { WerklijstOrderregel, WerklijstRol } from '@/modules/snijplanning/lib/werklijst-groepering'
import type { WerklijstRow } from '@/modules/snijplanning/queries/werklijst'
import { usePlanningBerekening } from '@/modules/snijplanning/hooks/use-planning-berekening'
import type {
  PlanningSession,
  PlanningDag,
  PlanningWeek,
  TekortGroep,
  TekortReden,
} from '@/modules/snijplanning/lib/planning-berekening'

// ─── Datum-formattering ──────────────────────────────────────────────────────

const DAGNAMEN = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function formatDatum(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  const dag = DAGNAMEN[d.getUTCDay()]
  return `${dag} ${d.getUTCDate()} ${MAANDEN[d.getUTCMonth()]}`
}

function formatDatumKort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T12:00:00Z`)
  return `${d.getUTCDate()}-${d.getUTCMonth() + 1}-${d.getUTCFullYear()}`
}

function formatMinuten(min: number): string {
  if (min < 60) return `${min} min`
  const u = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${u} u` : `${u} u ${m} min`
}

function formatVorm(vorm: string | null): string {
  if (!vorm) return 'Rechthoek'
  const namen: Record<string, string> = {
    rechthoek: 'Rechthoek',
    rond: 'Rond',
    ovaal: 'Ovaal',
    ellips: 'Ellips',
    afgeronde_hoeken: 'Afgeronde hoeken',
    organisch_a: 'Organisch A',
    organisch_b_sp: 'Organisch B gespiegeld',
    pebble: 'Pebble',
    klanteigen_vorm: 'Klant eigen vorm',
  }
  return namen[vorm] ?? vorm
}

function formatMaat(l: number | null, b: number | null): string {
  if (!l && !b) return '—'
  if (!b) return `${l} cm`
  if (!l) return `${b} cm`
  return `${l} × ${b} cm`
}

function formatWeek(week: string | null): string {
  if (!week) return '—'
  const m = week.match(/^(\d{4})-W0?(\d+)$/)
  return m ? `wk ${m[2]}` : week
}

// ─── Orderregel-rij (herbruikbaar in sessie en tekort) ───────────────────────

function OrderregelRij({
  regel,
  dimmen = false,
}: {
  regel: WerklijstOrderregel
  dimmen?: boolean
}) {
  return (
    <div className={cn('space-y-0.5', dimmen && 'opacity-60')}>
      {/* Eerste rij: ordernr (klikbaar) + klant + express */}
      <div className="flex items-center gap-2 text-xs">
        <Link
          to={`/orders/${regel.orderId}`}
          className="font-mono font-medium text-terracotta-600 hover:underline flex items-center gap-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {regel.orderNr}
          <ExternalLink size={10} className="opacity-60" />
        </Link>
        {regel.express && (
          <span className="px-1 py-0 rounded text-[9px] font-bold bg-red-100 text-red-700 uppercase shrink-0">
            express
          </span>
        )}
        <span className="truncate text-slate-600">{regel.klantNaam}</span>
        <span className="ml-auto shrink-0 text-slate-400">
          {regel.aantalStuks}×
        </span>
      </div>

      {/* Tweede rij: afmetingen + vorm + datum + leverweek */}
      <div className="flex items-center gap-2 text-[11px] text-slate-400 pl-0.5">
        <span className="font-medium text-slate-500">
          {formatMaat(regel.maatwerk_lengte_cm, regel.maatwerk_breedte_cm)}
        </span>
        <span>·</span>
        <span>{formatVorm(regel.maatwerk_vorm)}</span>
        {regel.maatwerk_afwerking && (
          <>
            <span>·</span>
            <span className="uppercase">{regel.maatwerk_afwerking}</span>
          </>
        )}
        <span className="ml-auto shrink-0 flex items-center gap-1.5">
          {regel.orderdatum && (
            <span title="Besteldatum">
              {formatDatumKort(regel.orderdatum)}
            </span>
          )}
          <span className="text-slate-300">→</span>
          <span className={cn(
            'font-medium',
            regel.haalbaarheid === 'rood' ? 'text-red-500' :
            regel.haalbaarheid === 'oranje' ? 'text-amber-500' :
            'text-slate-500'
          )}>
            {formatWeek(regel.verzendweek)}
          </span>
        </span>
      </div>
    </div>
  )
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

        {/* Kwaliteit + kleur + labels */}
        <span className="flex-1 min-w-0">
          <span className="font-medium text-slate-800">
            {sessie.kwaliteit_code} {sessie.kleur_code}
          </span>
          {sessie.rolnummer && (
            <span className="ml-2 text-xs text-slate-400">rol {sessie.rolnummer}</span>
          )}
          {heeftIo && sessie.io_verwacht_datum && (
            <span className="ml-2 text-xs text-blue-500">
              IO verwacht {formatDatumKort(sessie.io_verwacht_datum)}
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

        {/* Stuks + duur + toggle */}
        <span className="shrink-0 text-right text-xs text-slate-500 flex items-center gap-2">
          <span>
            <span className="font-medium text-slate-700">{sessie.aantalStuks}×</span>
            {' · '}{formatMinuten(sessie.duurMinuten)}
          </span>
          <span className="text-slate-400">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </span>
        </span>
      </button>

      {/* Orderregels (uitgeklapt) */}
      {open && (
        <div className="border-t border-slate-100 px-3 pb-3 pt-2 space-y-3">
          {sessie.orderregels.map((rij) => (
            <OrderregelRij key={rij.orderRegelId} regel={rij} />
          ))}
          {/* Tijdsinschatting */}
          {sessie.duurMinuten > sessie.snijMinuten && (
            <div className="flex items-center gap-1 text-[10px] text-slate-400 pt-1 border-t border-slate-50">
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

// ─── Rol-pakking (voor tekort "te weinig materiaal") ─────────────────────────

function RolPakkingKaart({ rol }: { rol: WerklijstRol }) {
  const pct = rol.rolLengteCm > 0 ? Math.round((rol.gebruikteLengteCm / rol.rolLengteCm) * 100) : 0

  return (
    <div className="rounded border border-slate-200 bg-white p-2.5 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <Layers size={12} className="text-slate-400 shrink-0" />
        <span className="font-medium text-slate-700">Rol {rol.rolnummer}</span>
        <span className="text-slate-400">
          {rol.rolBreedteCm} cm breed · {rol.rolLengteCm} cm lang
        </span>
        <span className="ml-auto text-slate-500">
          {rol.gebruikteLengteCm} cm bezet ({pct}%)
          {rol.restLengteCm > 0 && (
            <span className="text-emerald-600"> · {rol.restLengteCm} cm rest</span>
          )}
        </span>
      </div>

      {/* Shelves */}
      {rol.shelves.length > 0 && (
        <div className="space-y-1 pl-4">
          {rol.shelves.map((shelf) => (
            <div key={shelf.positieYCm} className="text-[11px] text-slate-500 flex items-start gap-2">
              <span className="text-slate-300 shrink-0 w-20 text-right">{shelf.positieYCm}–{shelf.eindYCm} cm</span>
              <div className="flex flex-wrap gap-1">
                {shelf.stukken.map((stuk) => {
                  const margeCm = stuk.margeCm
                  return (
                    <span
                      key={stuk.snijplanId}
                      className="inline-block bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5 text-[10px]"
                      title={[
                        stuk.klantNaam,
                        `besteld: ${formatMaat(stuk.maatwerk_lengte_cm, stuk.maatwerk_breedte_cm)}`,
                        margeCm > 0 ? `snijmarge: +${margeCm} cm → ${Math.round(stuk.geplaatsteBreedteCm)}×${Math.round(stuk.geplaatstelLengteCm)} cm op rol` : null,
                      ].filter(Boolean).join(' — ')}
                    >
                      {stuk.orderNr}
                      {' '}
                      <span className="text-slate-500">
                        {formatMaat(stuk.maatwerk_lengte_cm, stuk.maatwerk_breedte_cm)}
                      </span>
                      {margeCm > 0 && (
                        <span className="text-slate-300 ml-0.5">+{margeCm}m</span>
                      )}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Orderregels op de rol */}
      <div className="space-y-1 pl-4 pt-1 border-t border-slate-50">
        {rol.orderregels.map((regel) => (
          <div key={regel.orderRegelId} className="text-[11px] flex items-center gap-2">
            <Link
              to={`/orders/${regel.orderId}`}
              className="font-mono text-terracotta-600 hover:underline shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {regel.orderNr}
            </Link>
            <span className="text-slate-500 truncate">{regel.klantNaam}</span>
            <span className="ml-auto shrink-0 text-slate-400">
              {formatMaat(regel.maatwerk_lengte_cm, regel.maatwerk_breedte_cm)} · {regel.aantalStuks}×
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tekort reden-badge ───────────────────────────────────────────────────────

function TekortRedenBadge({ reden, ioAantalStuks }: { reden: TekortReden; ioAantalStuks: number }) {
  if (reden === 'te_weinig_materiaal') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
        Te weinig materiaal
      </span>
    )
  }
  if (reden === 'heeft_ook_io') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
        {ioAantalStuks} stuk{ioAantalStuks !== 1 ? 'ken' : ''} wacht op inkoop
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
      Geen materiaal, geen inkoop
    </span>
  )
}

// ─── Tekort-sectie ────────────────────────────────────────────────────────────

function TekortGroepKaart({ groep }: { groep: TekortGroep }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded border border-red-200 bg-red-50 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
      >
        <AlertTriangle size={13} className="text-red-500 shrink-0" />
        <span className="font-medium text-red-800 text-sm">
          {groep.kwaliteit_code} {groep.kleur_code}
        </span>
        <TekortRedenBadge reden={groep.reden} ioAantalStuks={groep.ioAantalStuks} />
        <span className="ml-auto shrink-0 flex items-center gap-2 text-xs text-red-500">
          <span>{groep.aantalStuks} stukken · {groep.orderregels.length} orders</span>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-red-200 bg-white px-3 pb-3 pt-2 space-y-3">
          {/* Pakking-overzicht voor "te weinig materiaal" */}
          {groep.reden === 'te_weinig_materiaal' && groep.rollenInGroep.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600">
                Bezette rollen ({groep.rollenInGroep.length}):
              </p>
              {groep.rollenInGroep.map((rol) => (
                <RolPakkingKaart key={rol.rolId} rol={rol} />
              ))}
              <p className="text-xs font-medium text-red-600 pt-1">
                Niet planbaar ({groep.aantalStuks} stukken — geen vrij materiaal):
              </p>
            </div>
          )}

          {/* IO-context voor "heeft_ook_io" */}
          {groep.reden === 'heeft_ook_io' && (
            <div className="rounded bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
              {groep.ioAantalStuks} stuk{groep.ioAantalStuks !== 1 ? 'ken' : ''} van deze kwaliteit wacht op inkoop
              (zichtbaar als blauwe sessies in de planning hierboven).
              De onderstaande stukken hebben ook geen IO-claim — handmatig koppelen in de Werklijst-tab.
            </div>
          )}

          {/* Tekort-orderregels */}
          <div className="space-y-3">
            {groep.orderregels.map((regel) => (
              <OrderregelRij key={regel.orderRegelId} regel={regel} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

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
        <span className="ml-auto text-xs text-red-400 flex items-center gap-2">
          {tekortGroepen.length} kwaliteiten
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-red-200 px-4 py-3 space-y-2">
          {tekortGroepen.map((g) => (
            <TekortGroepKaart key={`${g.kwaliteit_code}|${g.kleur_code}`} groep={g} />
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

  const max = 400
  const nettoMinuten = 480

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

      {/* Tekort bovenaan */}
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
