import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Printer, Scissors, Loader2, RotateCcw, Ruler, Move, Lock } from 'lucide-react'
import { formatDate, formatNumber } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import {
  useSnijplannenVoorGroep,
  useGenereerSnijvoorstel,
  useGoedgekeurdVoorstel,
  useTriggerAutoplan,
  useBenodigdeLengteSchatting,
  useRolLocaties,
  useKandidaatRollenVoorStuk,
  useWijsHandmatigToe,
  useOntgrendelHandmatig,
  buildPlanFromStukken,
  groepeerStukkenPerRol,
  useVormSnijtijden,
  useMoeilijkeKwaliteiten,
  bepaalSnijtijdMinuten,
  type RolGroep,
  type TekortAnalyseRow,
  type AutoplanGroepResultaat,
} from '@/modules/snijplanning'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { useAuth } from '@/hooks/use-auth'
import { SnijvoorstelModal } from './snijvoorstel-modal'
import type { SnijplanRow, SnijvoorstelResponse } from '@/lib/types/productie'

// Vaste kolombreedtes zodat álle stukken-tabellen (per rol-sectie én tekort)
// onderling uitlijnen ongeacht inhoud. Klant = flex-rest.
function StukkenColgroup({ withStatus }: { withStatus: boolean }) {
  return (
    <colgroup>
      <col className="w-[120px]" />
      <col className="w-[170px]" />
      <col />
      <col className="w-[130px]" />
      <col className="w-[120px]" />
      <col className="w-[100px]" />
      {withStatus && <col className="w-[100px]" />}
      <col className="w-[44px]" />
    </colgroup>
  )
}

/**
 * `auto-plan-groep` kan HTTP 200 + success teruggeven terwijl het voorstel
 * toch niet live ingepland is (concept, verdringingsrisico of een skip) —
 * vóór deze functie zag de operator dan alleen "geen foutmelding" en had geen
 * idee waarom er niets veranderde. Geeft null als er niets noemenswaardigs is
 * (gewoon auto-approved, geen skip).
 */
function beschrijfAutoplanResultaat(result: AutoplanGroepResultaat): string | null {
  if (result.skipped) {
    return result.reason ?? 'Auto-plan overgeslagen.'
  }
  if (result.auto_approved === false) {
    let msg = result.reason ?? 'Voorstel blijft concept voor handmatige beoordeling.'
    if (result.verdrongen_orders && result.verdrongen_orders.length > 0) {
      const orders = result.verdrongen_orders.map((o) => o.order_nr ?? `#${o.order_id}`).join(', ')
      msg += ` Verdrongen order(s): ${orders}.`
    }
    if (result.voorstel_nr) {
      msg += ` Bekijk voorstel ${result.voorstel_nr} bij "Te beoordelen".`
    }
    return msg
  }
  return null
}

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
  tekortAnalyse?: TekortAnalyseRow | null
  /** Opent de RolUitvoerModal op page-niveau (state leeft daar zodat de modal
   *  niet unmounted bij refetches/rerenders binnen deze accordion). */
  onStartRol: (rolId: number) => void
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
  tekortAnalyse = null,
  onStartRol,
}: GroepAccordionProps) {
  const [toonExtraRollen, setToonExtraRollen] = useState(false)
  // Externe vertegenwoordiger (mig 489): read-only — geen muteer-affordances.
  const { isExternRep } = useAuth()
  const kleurCodeZonderDecimaal = kleurCode.replace(/\.0$/, '')
  // props totaalOrders/totaalSnijden/totaalSnijdenGepland/defaultOpen blijven voor compat
  void defaultOpen; void totaalOrders; void totaalSnijden; void totaalSnijdenGepland
  const [genError, setGenError] = useState<string | null>(null)
  const [autoplanInfo, setAutoplanInfo] = useState<string | null>(null)
  const [voorstelResult, setVoorstelResult] = useState<SnijvoorstelResponse | null>(null)
  const [showPlan, setShowPlan] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [handmatigStuk, setHandmatigStuk] = useState<SnijplanRow | null>(null)
  const genereer = useGenereerSnijvoorstel(); void genereer
  const autoplan = useTriggerAutoplan()
  const lengteSchatting = useBenodigdeLengteSchatting()

  const { data: stukken, isLoading } = useSnijplannenVoorGroep(kwaliteitCode, kleurCode, true, totDatum)

  // Rol-groepen (stukken met rol_id), gesorteerd op leverdatum + aantal
  const rolGroepen = useMemo<RolGroep[]>(() => {
    if (!stukken) return []
    return groepeerStukkenPerRol(stukken)
  }, [stukken])

  // Stukken zonder rol_id (nog niet toegewezen)
  const stukkenZonderRol = useMemo(() => {
    return (stukken ?? []).filter((s) => s.rol_id == null)
  }, [stukken])

  const tekortM2 = useMemo(() => {
    const totaal = stukkenZonderRol.reduce((s, x) => {
      const m2 = ((x.snij_lengte_cm ?? 0) * (x.snij_breedte_cm ?? 0)) / 10000
      return s + m2
    }, 0)
    return Math.round(totaal * 10) / 10
  }, [stukkenZonderRol])

  type TekortReden =
    | { kind: 'geen_collectie' }
    | { kind: 'geen_voorraad'; codes: string[] }
    | { kind: 'rol_te_klein'; codes: string[]; maxLange: number; maxKorte: number; stukLange: number; stukKorte: number }
    | { kind: 'voldoende'; codes: string[]; totaalM2: number }
    | null

  const tekortReden = useMemo<TekortReden>(() => {
    if (modus !== 'tekort' || stukkenZonderRol.length === 0) return null
    if (!tekortAnalyse) return null

    if (!tekortAnalyse.heeft_collectie) {
      return { kind: 'geen_collectie' }
    }
    if (tekortAnalyse.aantal_beschikbaar === 0) {
      return { kind: 'geen_voorraad', codes: tekortAnalyse.uitwisselbare_codes }
    }

    // RPC geeft het grootste stuk dat op GEEN ENKELE rol past (per-stuk check
    // tegen individuele rol-afmetingen, niet aggregatie over rollen). Als > 0
    // → minstens één stuk kan nergens op → rol_te_klein. Zie migratie 117.
    const onpassendLange = tekortAnalyse.grootste_onpassend_stuk_lange_cm ?? 0
    const onpassendKorte = tekortAnalyse.grootste_onpassend_stuk_korte_cm ?? 0
    if (onpassendLange > 0 && onpassendKorte > 0) {
      return {
        kind: 'rol_te_klein',
        codes: tekortAnalyse.uitwisselbare_codes,
        maxLange: tekortAnalyse.max_lange_zijde_cm,
        maxKorte: tekortAnalyse.max_korte_zijde_cm,
        stukLange: onpassendLange,
        stukKorte: onpassendKorte,
      }
    }

    return {
      kind: 'voldoende',
      codes: tekortAnalyse.uitwisselbare_codes,
      totaalM2: Number(tekortAnalyse.totaal_beschikbaar_m2) || 0,
    }
  }, [modus, stukkenZonderRol, tekortAnalyse])

  // Locaties voor alle rollen
  const rolIds = useMemo(() => rolGroepen.map((g) => g.rolId), [rolGroepen])
  const { data: locatieMap } = useRolLocaties(rolIds)

  const { data: planningConfig } = usePlanningConfig()
  const { data: vormTarieven } = useVormSnijtijden()
  const { data: moeilijkeKwaliteiten } = useMoeilijkeKwaliteiten()

  const { data: goedgekeurdPlan } = useGoedgekeurdVoorstel(kwaliteitCode, kleurCode, showPlan && !voorstelResult)

  const reconstructedPlan = useMemo(() => {
    if (!showPlan || !stukken || goedgekeurdPlan) return null
    return buildPlanFromStukken(stukken)
  }, [showPlan, stukken, goedgekeurdPlan])

  const modalData = voorstelResult ?? goedgekeurdPlan ?? reconstructedPlan

  function formatMinuten(stukken: SnijplanRow[]): string | null {
    if (!planningConfig || !vormTarieven || !moeilijkeKwaliteiten || stukken.length === 0) return null
    const minuten = planningConfig.wisseltijd_minuten
      + stukken.reduce((s, p) => s + bepaalSnijtijdMinuten(p.maatwerk_vorm, p.kwaliteit_code, vormTarieven, moeilijkeKwaliteiten), 0)
    if (minuten === 0) return null
    const uren = Math.floor(minuten / 60)
    const min = Math.round(minuten % 60)
    if (uren === 0) return `${min} min`
    return min === 0 ? `${uren} uur` : `${uren} uur ${min} min`
  }

  // Opent de rol-uitvoer-modal via de page-level handler. De modal roept zelf
  // `start_snijden_rol` aan via useEffect (promoot Gepland-stukken op de rol
  // naar Snijden + zet snijden_gestart_op). De legacy `start_productie_rol`
  // flow (stukken naar 'In productie') wordt niet meer gebruikt.
  const handleStartRol = (rolId: number) => {
    setStartError(null)
    onStartRol(rolId)
  }

  return (
    <div className="space-y-2 bg-white">
      {genError && (
        <div className="mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-[var(--radius-sm)] text-sm text-red-700">
          {genError}
          <button onClick={() => setGenError(null)} className="ml-2 underline text-xs">Sluiten</button>
        </div>
      )}
      {autoplanInfo && (
        <div className="mb-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm text-amber-800">
          {autoplanInfo}
          <button onClick={() => setAutoplanInfo(null)} className="ml-2 underline text-xs">Sluiten</button>
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

              {modus !== 'tekort' && rolGroepen.length > 0 && (
                <div className="space-y-2">
                  <RolSectie
                    key={rolGroepen[0].rolId}
                    rol={rolGroepen[0]}
                    locatieMap={locatieMap ?? null}
                    kwaliteitCode={kwaliteitCode}
                    kleurLabel={kleurCodeZonderDecimaal}
                    geschatteTijd={formatMinuten(rolGroepen[0].stukken)}
                    defaultOpen={true}
                    onStart={handleStartRol}
                    isStartPending={false}
                    pendingRolId={null}
                    onHandmatigToewijzen={setHandmatigStuk}
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
                      geschatteTijd={formatMinuten(rol.stukken)}
                      defaultOpen={false}
                      onStart={handleStartRol}
                      isStartPending={false}
                      pendingRolId={null}
                      onHandmatigToewijzen={setHandmatigStuk}
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

              {modus === 'tekort' && stukkenZonderRol.length > 0 && (() => {
                const redenBg =
                  tekortReden?.kind === 'geen_collectie' ? 'bg-rose-50 border-rose-200' :
                  tekortReden?.kind === 'rol_te_klein' ? 'bg-orange-50 border-orange-200' :
                  tekortReden?.kind === 'voldoende' ? 'bg-sky-50 border-sky-200' :
                  'bg-amber-50 border-amber-200'
                const redenText =
                  tekortReden?.kind === 'geen_collectie' ? 'text-rose-800' :
                  tekortReden?.kind === 'rol_te_klein' ? 'text-orange-800' :
                  tekortReden?.kind === 'voldoende' ? 'text-sky-800' :
                  'text-amber-800'
                const redenLabel = (() => {
                  if (!tekortReden) return 'Analyse wordt geladen…'
                  switch (tekortReden.kind) {
                    case 'geen_collectie':
                      return `Geen collectie gekoppeld aan kwaliteit ${kwaliteitCode} — geen uitwisseling mogelijk. Inkoop of collectie instellen.`
                    case 'geen_voorraad':
                      return `Geen voorraad in uitwisselbare kwaliteiten (${tekortReden.codes.join(', ')}) voor kleur ${kleurCodeZonderDecimaal}. Inkoop nodig.`
                    case 'rol_te_klein':
                      return `Rol te klein: grootste stuk ${tekortReden.stukLange}×${tekortReden.stukKorte}cm past niet op beste beschikbare rol (max ${tekortReden.maxLange}×${tekortReden.maxKorte}cm in ${tekortReden.codes.join(', ')}). Inkoop van grotere rol.`
                    case 'voldoende':
                      return `Zou plannbaar moeten zijn — ${tekortReden.totaalM2} m² in ${tekortReden.codes.join(', ')}.`
                  }
                })()
                const handleAutoplan = () => {
                  setGenError(null)
                  setAutoplanInfo(null)
                  autoplan.mutate(
                    { kwaliteitCode, kleurCode, totDatum: totDatum ?? null },
                    {
                      onSuccess: (result) => setAutoplanInfo(beschrijfAutoplanResultaat(result)),
                      onError: (err: unknown) => {
                        const msg = err instanceof Error ? err.message : 'Auto-plan faalde'
                        setGenError(msg)
                      },
                    },
                  )
                }
                const handleSchatLengte = () => {
                  lengteSchatting.mutate({ kwaliteitCode, kleurCode })
                }
                return (
                <div className={cn('mt-2 border rounded-[var(--radius-sm)] overflow-hidden', redenBg)}>
                  <div className={cn('px-3 py-2 text-xs font-medium flex items-center gap-2 flex-wrap', redenText)}>
                    <span className="text-sm font-semibold text-slate-900">
                      {kwaliteitCode} {kleurCodeZonderDecimaal}
                    </span>
                    <span>
                      · {stukkenZonderRol.length} {stukkenZonderRol.length === 1 ? 'stuk' : 'stukken'} ({tekortM2} m²)
                    </span>
                    <span className="w-full mt-1 font-normal">{redenLabel}</span>
                    {/* Ook tonen bij geen_voorraad/rol_te_klein/geen_collectie: de
                        tweede pak-pas (mig 437-445) matcht op exacte kwaliteit+kleur
                        tegen openstaande rol-inkoop, los van de uitwisselbare-paren-
                        check hierboven — dus ook dán kan een herplan iets oplossen. */}
                    {tekortReden && !isExternRep && (
                      <button
                        onClick={handleAutoplan}
                        disabled={autoplan.isPending}
                        className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] bg-sky-600 text-white text-xs font-medium hover:bg-sky-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      >
                        {autoplan.isPending ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <RotateCcw size={12} />
                        )}
                        Auto-plan opnieuw draaien
                      </button>
                    )}
                    {/* Read-only schatting (schat-benodigde-lengte) — géén
                        mutatie, los van de Auto-plan-knop hierboven. */}
                    <button
                      onClick={handleSchatLengte}
                      disabled={lengteSchatting.isPending}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] bg-white border border-slate-300 text-slate-700 text-xs font-medium hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors',
                        tekortReden ? '' : 'ml-auto',
                      )}
                    >
                      {lengteSchatting.isPending ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Ruler size={12} />
                      )}
                      Bereken benodigde lengte
                    </button>
                    {lengteSchatting.data && (
                      <span className="w-full mt-1 font-normal text-slate-700">
                        {lengteSchatting.data.kan_berekenen ? (
                          <>
                            ≈ {formatNumber((lengteSchatting.data.benodigde_lengte_cm ?? 0) / 100, 1)} m nodig bij{' '}
                            {lengteSchatting.data.standaard_breedte_cm} cm breedte ({lengteSchatting.data.afval_percentage}% afval)
                            {(lengteSchatting.data.aantal_niet_passend ?? 0) > 0 && (
                              <span className="text-rose-700">
                                {' '}— {lengteSchatting.data.aantal_niet_passend}{' '}
                                {lengteSchatting.data.aantal_niet_passend === 1 ? 'stuk past' : 'stukken passen'} niet eens
                                op een rol van {lengteSchatting.data.standaard_breedte_cm} cm breed
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-rose-700">{lengteSchatting.data.reden}</span>
                        )}
                      </span>
                    )}
                  </div>
                  <table className="w-full text-sm table-fixed">
                    <StukkenColgroup withStatus={false} />
                    <thead>
                      <tr className="border-b border-amber-200 text-left text-xs text-slate-500 uppercase bg-white">
                        <th className="py-2 pl-3 pr-3">Maat</th>
                        <th className="py-2 pr-3">Vorm</th>
                        <th className="py-2 pr-3">Klant</th>
                        <th className="py-2 pr-3">Order</th>
                        <th className="py-2 pr-3">Leverdatum</th>
                        <th className="py-2 pr-3">Afwerking</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100 bg-white">
                      {[...stukkenZonderRol]
                        .sort((a, b) => {
                          const aD = a.afleverdatum ?? null
                          const bD = b.afleverdatum ?? null
                          if (aD === bD) return 0
                          if (!aD) return 1
                          if (!bD) return -1
                          return aD.localeCompare(bD)
                        })
                        .map((stuk) => (
                          <tr key={stuk.id} className="hover:bg-amber-50/40">
                            <td className="py-2 pl-3 pr-3 font-medium">
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
                              <div className="flex items-center gap-2 justify-end">
                                {!isExternRep && (
                                  <button
                                    type="button"
                                    onClick={() => setHandmatigStuk(stuk)}
                                    className="text-slate-300 hover:text-slate-600 transition-colors"
                                    title="Handmatig aan een rol toewijzen"
                                  >
                                    <Move size={14} />
                                  </button>
                                )}
                                <Link
                                  to={`/snijplanning/${stuk.id}/stickers`}
                                  className="text-slate-300 hover:text-slate-600 transition-colors"
                                  title="Sticker printen"
                                >
                                  <Printer size={14} />
                                </Link>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                )
              })()}
            </>
          )}
        </div>

      {/* Handmatige rol-toewijzing (Fase 4) */}
      {handmatigStuk && (
        <HandmatigToewijzenDialog stuk={handmatigStuk} onClose={() => setHandmatigStuk(null)} />
      )}

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
  locatieMap: Map<number, string | null> | null
  kwaliteitCode: string
  kleurLabel: string
  geschatteTijd: string | null
  defaultOpen: boolean
  onStart: (rolId: number) => void
  isStartPending: boolean
  pendingRolId: number | null
  onHandmatigToewijzen: (stuk: SnijplanRow) => void
}

function RolSectie({ rol, locatieMap, kwaliteitCode, kleurLabel, geschatteTijd, defaultOpen, onStart, isStartPending, pendingRolId, onHandmatigToewijzen }: RolSectieProps) {
  const [open, setOpen] = useState(defaultOpen)
  const { isExternRep } = useAuth()
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
          {/* Werkelijk gebruikte/resterende lengte uit de opgeslagen 2D-posities
              (mapSnijplannenToStukken) — niet een platte m²-som. Amber zodra er
              minder dan 1m over is ("bijna vol"). */}
          <span
            className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              rol.restLengteCm < 100 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600',
            )}
            title="Gebruikte / resterende lengte op deze rol"
          >
            {formatNumber(rol.gebruikteLengteCm / 100, 1)}m gebruikt · {formatNumber(rol.restLengteCm / 100, 1)}m rest
          </span>
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
          {rol.aantalTeSnijden > 0 && !isExternRep && (
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
          <table className="w-full text-sm table-fixed">
            <StukkenColgroup withStatus={true} />
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                <th className="py-2 pr-3">Maat</th>
                <th className="py-2 pr-3">Vorm</th>
                <th className="py-2 pr-3">Klant</th>
                <th className="py-2 pr-3">Order</th>
                <th className="py-2 pr-3">Leverdatum</th>
                <th className="py-2 pr-3">Afwerking</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {gesorteerdeStukken.map((stuk) => (
                <StukRow key={stuk.id} stuk={stuk} onHandmatigToewijzen={onHandmatigToewijzen} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}


function StukRow({ stuk, onHandmatigToewijzen }: { stuk: SnijplanRow; onHandmatigToewijzen: (stuk: SnijplanRow) => void }) {
  const ontgrendel = useOntgrendelHandmatig()
  const { isExternRep } = useAuth()
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
          stuk.status === 'Gepland' ? 'bg-slate-100 text-slate-700'
            : stuk.status === 'Snijden' ? 'bg-blue-100 text-blue-700'
            : stuk.status === 'Gesneden' ? 'bg-amber-100 text-amber-700'
            : 'bg-slate-100 text-slate-600'
        )}>
          {stuk.status}
        </span>
      </td>
      <td className="py-2 pr-3">
        <div className="flex items-center gap-2 justify-end">
          {stuk.is_handmatig_toegewezen && !isExternRep && (
            <button
              type="button"
              onClick={() => ontgrendel.mutate(stuk.id)}
              disabled={ontgrendel.isPending}
              className="text-amber-500 hover:text-amber-700 transition-colors disabled:opacity-50"
              title="Vergrendeld — klik om te ontgrendelen (geeft vrij voor automatische planning)"
            >
              <Lock size={14} />
            </button>
          )}
          {stuk.status === 'Gepland' && !isExternRep && (
            <button
              type="button"
              onClick={() => onHandmatigToewijzen(stuk)}
              className="text-slate-300 hover:text-slate-600 transition-colors"
              title="Handmatig naar een andere rol verplaatsen"
            >
              <Move size={14} />
            </button>
          )}
          <Link
            to={`/snijplanning/${stuk.id}/stickers`}
            className="text-slate-300 hover:text-slate-600 transition-colors"
            title="Sticker printen"
          >
            <Printer size={14} />
          </Link>
        </div>
      </td>
    </tr>
  )
}

/**
 * Fase 4: handmatige rol-toewijzing. Toont compatibele, groot-genoeg rollen
 * (`kandidaat_rollen_voor_handmatige_toewijzing`); de positie op de gekozen
 * rol wordt server-side bepaald (edge function `wijs-snijplan-handmatig-toe`,
 * dezelfde shelf-packing-logica als de auto-planner). Werkt zowel voor een
 * nog-niet-geplaatst stuk als voor het verplaatsen van een al-geplaatst
 * (ook al-vergrendeld) stuk naar een andere rol.
 */
function HandmatigToewijzenDialog({ stuk, onClose }: { stuk: SnijplanRow; onClose: () => void }) {
  const [rolId, setRolId] = useState<number | null>(null)
  const { data: kandidaten, isLoading } = useKandidaatRollenVoorStuk(stuk.id)
  const wijsToe = useWijsHandmatigToe()

  function handleConfirm() {
    if (!rolId) return
    wijsToe.mutate(
      { snijplanId: stuk.id, rolId },
      { onSuccess: (result) => { if (result.success) onClose() } },
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-[var(--radius)] shadow-xl p-6 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Handmatig toewijzen</h3>
        <p className="text-sm text-slate-600 mb-4">
          {stuk.snij_breedte_cm}×{stuk.snij_lengte_cm} cm — kies een rol. De toewijzing wordt
          vergrendeld zodat de automatische planning dit stuk niet terugdraait.
        </p>

        {isLoading ? (
          <p className="text-sm text-slate-400 mb-4">Rollen laden...</p>
        ) : !kandidaten || kandidaten.length === 0 ? (
          <p className="text-sm text-rose-600 mb-4">
            Geen compatibele rol groot genoeg gevonden voor dit stuk.
          </p>
        ) : (
          <select
            value={rolId ?? ''}
            onChange={(e) => setRolId(Number(e.target.value))}
            className="w-full px-3 py-2 mb-4 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          >
            <option value="" disabled>Kies een rol...</option>
            {kandidaten.map((k) => (
              <option key={k.rol_id} value={k.rol_id}>
                {k.rolnummer} — {k.breedte_cm}×{k.lengte_cm} cm{k.is_exact ? '' : ' (uitwisselbaar)'}
              </option>
            ))}
          </select>
        )}

        {wijsToe.data && !wijsToe.data.success && (
          <p className="text-sm text-rose-600 mb-3">{wijsToe.data.reason}</p>
        )}
        {wijsToe.isError && (
          <p className="text-sm text-rose-600 mb-3">
            {wijsToe.error instanceof Error ? wijsToe.error.message : 'Toewijzen mislukt'}
          </p>
        )}

        <div className="flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={wijsToe.isPending}
            className="px-4 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm hover:bg-slate-50"
          >
            Annuleren
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!rolId || wijsToe.isPending || isLoading || !kandidaten?.length}
            className="px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 disabled:opacity-50 transition-colors"
          >
            {wijsToe.isPending ? 'Bezig...' : 'Toewijzen'}
          </button>
        </div>
      </div>
    </div>
  )
}
