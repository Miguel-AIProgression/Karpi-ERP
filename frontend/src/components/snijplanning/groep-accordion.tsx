import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Printer, Scissors, Loader2 } from 'lucide-react'
import { RolUitvoerModal } from './rol-uitvoer-modal'
import { formatDate } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import { useSnijplannenVoorGroep, useGenereerSnijvoorstel, useBeschikbareCapaciteit, useGoedgekeurdVoorstel, useTriggerAutoplan, useRolLocaties, useStartProductieRol } from '@/hooks/use-snijplanning'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { SnijvoorstelModal } from './snijvoorstel-modal'
import { buildPlanFromStukken, groepeerStukkenPerRol, type RolGroep } from '@/lib/utils/snijplan-mapping'
import type { SnijplanRow, SnijvoorstelResponse } from '@/lib/types/productie'

interface GroepAccordionProps {
  kwaliteitCode: string
  kleurCode: string
  totaalOrders: number
  totaalSnijden: number
  totaalSnijdenGepland: number
  totDatum?: string | null
  defaultOpen?: boolean
  /** 'te-snijden' toont alleen stukken met rol; 'tekort' toont alleen stukken zonder rol. */
  modus?: 'te-snijden' | 'tekort'
}

export function GroepAccordion({
  kwaliteitCode,
  kleurCode,
  totaalOrders,
  totaalSnijden,
  totaalSnijdenGepland,
  totDatum,
  defaultOpen = false,
  modus = 'te-snijden',
}: GroepAccordionProps) {
  const [toonExtraRollen, setToonExtraRollen] = useState(false)
  const kleurCodeZonderDecimaal = kleurCode.replace(/\.0$/, '')
  // defaultOpen was voorheen voor collapse — nu altijd open, prop blijft voor compat
  void defaultOpen
  const [genError, setGenError] = useState<string | null>(null)
  const [voorstelResult, setVoorstelResult] = useState<SnijvoorstelResponse | null>(null)
  const [showPlan, setShowPlan] = useState(false)
  const [activeRolId, setActiveRolId] = useState<number | null>(null)
  const startProductie = useStartProductieRol()
  const [startError, setStartError] = useState<string | null>(null)
  const genereer = useGenereerSnijvoorstel()
  const autoplan = useTriggerAutoplan()
  const { data: capaciteit } = useBeschikbareCapaciteit(kwaliteitCode, kleurCode)

  const heeftGepland = totaalSnijdenGepland > 0
  const heeftWacht = totaalSnijden - totaalSnijdenGepland > 0

  const { data: stukken, isLoading } = useSnijplannenVoorGroep(kwaliteitCode, kleurCode, true, totDatum)

  const teSnijdenM2 = useMemo(() => {
    if (!stukken) return null
    const totaal = stukken.reduce((s, x) => {
      const m2 = ((x.snij_lengte_cm ?? 0) * (x.snij_breedte_cm ?? 0)) / 10000
      return s + m2
    }, 0)
    return Math.round(totaal * 10) / 10
  }, [stukken])

  // Rol-groepen (stukken met rol_id), gesorteerd op leverdatum + aantal
  const rolGroepen = useMemo<RolGroep[]>(() => {
    if (!stukken) return []
    return groepeerStukkenPerRol(stukken)
  }, [stukken])

  // Stukken zonder rol_id (nog niet toegewezen)
  const stukkenZonderRol = useMemo(() => {
    return (stukken ?? []).filter((s) => s.rol_id == null)
  }, [stukken])

  // Locaties voor alle rollen
  const rolIds = useMemo(() => rolGroepen.map((g) => g.rolId), [rolGroepen])
  const { data: locatieMap } = useRolLocaties(rolIds)

  // Geschatte snijtijd (alle rollen, status 'Snijden')
  const { data: planningConfig } = usePlanningConfig()
  const geschatteTijd = useMemo(() => {
    if (!planningConfig) return null
    const totaalTeSnijden = rolGroepen.reduce((s, g) => s + g.aantalTeSnijden, 0)
    if (totaalTeSnijden === 0) return null
    const uniekeRollen = rolGroepen.filter((g) => g.aantalTeSnijden > 0).length
    const minuten = uniekeRollen * planningConfig.wisseltijd_minuten
      + totaalTeSnijden * planningConfig.snijtijd_minuten
    if (minuten === 0) return null
    const uren = Math.floor(minuten / 60)
    const min = Math.round(minuten % 60)
    if (uren === 0) return `${min} min`
    return min === 0 ? `${uren} uur` : `${uren} uur ${min} min`
  }, [planningConfig, rolGroepen])

  const { data: goedgekeurdPlan } = useGoedgekeurdVoorstel(kwaliteitCode, kleurCode, showPlan && !voorstelResult)

  const reconstructedPlan = useMemo(() => {
    if (!showPlan || !stukken || goedgekeurdPlan) return null
    return buildPlanFromStukken(stukken)
  }, [showPlan, stukken, goedgekeurdPlan])

  const modalData = voorstelResult ?? goedgekeurdPlan ?? reconstructedPlan

  const pendingRolId = startProductie.isPending ? (startProductie.variables ?? null) : null

  function formatMinuten(aantalTeSnijden: number): string | null {
    if (!planningConfig || aantalTeSnijden === 0) return null
    const minuten = planningConfig.wisseltijd_minuten + aantalTeSnijden * planningConfig.snijtijd_minuten
    if (minuten === 0) return null
    const uren = Math.floor(minuten / 60)
    const min = Math.round(minuten % 60)
    if (uren === 0) return `${min} min`
    return min === 0 ? `${uren} uur` : `${uren} uur ${min} min`
  }

  const handleStartRol = (rolId: number) => {
    setStartError(null)
    startProductie.mutate(rolId, {
      onSuccess: () => setActiveRolId(rolId),
      onError: (err) => {
        const msg = err instanceof Error ? err.message : 'Onbekende fout'
        if (msg.toLowerCase().includes('al in productie') || msg.toLowerCase().includes('already')) {
          setActiveRolId(rolId)
        } else {
          setStartError(msg)
        }
      },
    })
  }

  return (
    <div className="space-y-2">
      {genError && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-[var(--radius-sm)] text-sm text-red-700">
          {genError}
          <button onClick={() => setGenError(null)} className="ml-2 underline text-xs">Sluiten</button>
        </div>
      )}

      <div>
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-4">Laden...</p>
          ) : !stukken || stukken.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Geen items gevonden</p>
          ) : (
            <>
              {startError && (
                <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-[var(--radius-sm)] text-sm text-red-700">
                  {startError}
                  <button onClick={() => setStartError(null)} className="ml-2 underline text-xs">Sluiten</button>
                </div>
              )}

              {rolGroepen.length > 0 && (
                <div className="space-y-2">
                  <RolSectie
                    key={rolGroepen[0].rolId}
                    rol={rolGroepen[0]}
                    locatieMap={locatieMap ?? null}
                    kwaliteitCode={kwaliteitCode}
                    kleurLabel={kleurCodeZonderDecimaal}
                    geschatteTijd={formatMinuten(rolGroepen[0].aantalTeSnijden)}
                    defaultOpen={true}
                    onStart={handleStartRol}
                    isStartPending={startProductie.isPending}
                    pendingRolId={pendingRolId}
                  />
                  {rolGroepen.length > 1 && !toonExtraRollen && (
                    <button
                      onClick={() => setToonExtraRollen(true)}
                      className="w-full py-2 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-[var(--radius-sm)] border border-dashed border-slate-300 transition-colors"
                    >
                      Toon {rolGroepen.length - 1} {rolGroepen.length - 1 === 1 ? 'andere rol' : 'andere rollen'}
                    </button>
                  )}
                  {toonExtraRollen && rolGroepen.slice(1).map((rol) => (
                    <RolSectie
                      key={rol.rolId}
                      rol={rol}
                      locatieMap={locatieMap ?? null}
                      kwaliteitCode={kwaliteitCode}
                      kleurLabel={kleurCodeZonderDecimaal}
                      geschatteTijd={formatMinuten(rol.aantalTeSnijden)}
                      defaultOpen={false}
                      onStart={handleStartRol}
                      isStartPending={startProductie.isPending}
                      pendingRolId={pendingRolId}
                    />
                  ))}
                  {toonExtraRollen && rolGroepen.length > 1 && (
                    <button
                      onClick={() => setToonExtraRollen(false)}
                      className="w-full py-2 text-xs text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-[var(--radius-sm)] transition-colors"
                    >
                      Verberg overige rollen
                    </button>
                  )}
                </div>
              )}

              {modus === 'tekort' && stukkenZonderRol.length > 0 && (
                <div className="mt-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm text-amber-700">
                  {stukkenZonderRol.length} {stukkenZonderRol.length === 1 ? 'stuk is' : 'stukken zijn'} nog niet toegewezen aan een rol.
                </div>
              )}
            </>
          )}
        </div>

      {/* Rol-uitvoer modal */}
      <RolUitvoerModal
        rolId={activeRolId}
        open={activeRolId !== null}
        onClose={() => setActiveRolId(null)}
      />

      {/* Snijvoorstel modal */}
      {modalData && (voorstelResult || showPlan) && (
        <SnijvoorstelModal
          voorstel={modalData}
          kwaliteitCode={kwaliteitCode}
          kleurCode={kleurCode}
          onClose={() => { setVoorstelResult(null); setShowPlan(false) }}
          readOnly={showPlan && !voorstelResult}
        />
      )}
    </div>
  )
}

interface RolSectieProps {
  rol: RolGroep
  locatieMap: Map<number, string> | null
  kwaliteitCode: string
  kleurLabel: string
  geschatteTijd: string | null
  defaultOpen: boolean
  onStart: (rolId: number) => void
  isStartPending: boolean
  pendingRolId: number | null
}

function RolSectie({ rol, locatieMap, kwaliteitCode, kleurLabel, geschatteTijd, defaultOpen, onStart, isStartPending, pendingRolId }: RolSectieProps) {
  const [open, setOpen] = useState(defaultOpen)
  const locatie = locatieMap?.get(rol.rolId) ?? null
  const isPendingThis = isStartPending && pendingRolId === rol.rolId

  // Sorteer stukken binnen een rol op leverdatum (null achteraan)
  const gesorteerdeStukken = useMemo(() => {
    return [...rol.stukken].sort((a, b) => {
      const aD = a.afleverdatum ?? null
      const bD = b.afleverdatum ?? null
      if (aD === bD) return 0
      if (!aD) return 1
      if (!bD) return -1
      return aD.localeCompare(bD)
    })
  }, [rol.stukken])

  return (
    <div className="rounded-[var(--radius-sm)] border border-slate-200 overflow-hidden">
      {/* Rol header bar */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } }}
        className={cn(
          'w-full flex items-center justify-between px-3 py-2 text-left cursor-pointer transition-colors',
          open ? 'bg-slate-50' : 'hover:bg-slate-50'
        )}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {open ? (
            <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />
          ) : (
            <ChevronRight size={14} className="text-slate-400 flex-shrink-0" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {kwaliteitCode} {kleurLabel}
          </span>
          <span className="font-medium text-sm text-slate-900">Rol {rol.rolnummer}</span>
          <span className="text-xs text-slate-500">{rol.rolBreedte} × {rol.rolLengte} cm</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {rol.stukken.length} {rol.stukken.length === 1 ? 'stuk' : 'stuks'}
          </span>
          {rol.aantalTeSnijden > 0 && rol.aantalTeSnijden !== rol.stukken.length && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">
              {rol.aantalTeSnijden} te snijden
            </span>
          )}
          {rol.vroegsteLeverdatum && (
            <span className="text-xs text-slate-600">{formatDate(rol.vroegsteLeverdatum)}</span>
          )}
          {geschatteTijd && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600" title="Geschatte snijtijd">
              ~{geschatteTijd}
            </span>
          )}
          {locatie && (
            <span className="text-xs text-slate-500 tabular-nums">· {locatie}</span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {rol.aantalTeSnijden > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onStart(rol.rolId) }}
              disabled={isStartPending}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50"
            >
              {isPendingThis ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Scissors size={12} />
              )}
              Start snijden rol ({rol.aantalTeSnijden})
            </button>
          )}
        </div>
      </div>

      {/* Expanded: stukken-tabel */}
      {open && (
        <div className="border-t border-slate-100 px-3 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                <th className="py-2 pr-3">Maat</th>
                <th className="py-2 pr-3">Vorm</th>
                <th className="py-2 pr-3">Klant</th>
                <th className="py-2 pr-3">Order</th>
                <th className="py-2 pr-3">Leverdatum</th>
                <th className="py-2 pr-3">Afwerking</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 w-8"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gesorteerdeStukken.map((stuk) => (
                <StukRow key={stuk.id} stuk={stuk} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
      {children}
    </span>
  )
}

function StukRow({ stuk }: { stuk: SnijplanRow }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="py-2 pr-3 font-medium">
        {stuk.snij_breedte_cm}×{stuk.snij_lengte_cm} cm
      </td>
      <td className="py-2 pr-3">
        {stuk.maatwerk_vorm && (() => {
          const vd = getVormDisplay(stuk.maatwerk_vorm)
          return (
            <span className={cn('text-xs px-1.5 py-0.5 rounded', vd.bg, vd.text)}>
              {vd.label}
            </span>
          )
        })()}
      </td>
      <td className="py-2 pr-3">{stuk.klant_naam}</td>
      <td className="py-2 pr-3">
        <Link to={`/orders/${stuk.order_id}`} className="text-terracotta-600 hover:underline">
          {stuk.order_nr}
        </Link>
      </td>
      <td className="py-2 pr-3">
        {stuk.afleverdatum ? (
          <span className="text-sm text-slate-700">{formatDate(stuk.afleverdatum)}</span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="py-2 pr-3">
        {stuk.maatwerk_afwerking && AFWERKING_MAP[stuk.maatwerk_afwerking] ? (
          <span className={cn('text-xs px-1.5 py-0.5 rounded', AFWERKING_MAP[stuk.maatwerk_afwerking].bg, AFWERKING_MAP[stuk.maatwerk_afwerking].text)}>
            {stuk.maatwerk_afwerking}
          </span>
        ) : '—'}
      </td>
      <td className="py-2 pr-3">
        <span className={cn(
          'text-xs px-1.5 py-0.5 rounded',
          stuk.status === 'Snijden' ? 'bg-blue-100 text-blue-700'
            : stuk.status === 'Gesneden' ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-100 text-slate-600'
        )}>
          {stuk.status}
        </span>
      </td>
      <td className="py-2 pr-3">
        <Link
          to={`/snijplanning/${stuk.id}/stickers`}
          className="text-slate-300 hover:text-slate-600 transition-colors"
          title="Sticker printen"
        >
          <Printer size={14} />
        </Link>
      </td>
    </tr>
  )
}
