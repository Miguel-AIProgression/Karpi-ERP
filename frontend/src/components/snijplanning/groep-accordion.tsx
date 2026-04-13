import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Printer, Scissors, Loader2, Eye, CheckSquare } from 'lucide-react'
import { SnijBevestigingModal } from './snij-bevestiging-modal'
import { formatDate } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import { useSnijplannenVoorGroep, useGenereerSnijvoorstel, useBeschikbareCapaciteit, useGoedgekeurdVoorstel, useTriggerAutoplan } from '@/hooks/use-snijplanning'
import { SnijvoorstelModal } from './snijvoorstel-modal'
import { buildPlanFromStukken } from '@/lib/utils/snijplan-mapping'
import type { SnijplanRow, SnijvoorstelResponse } from '@/lib/types/productie'

interface GroepAccordionProps {
  kwaliteitCode: string
  kleurCode: string
  totaalStukken: number
  totaalOrders: number
  totaalM2: number
  totaalGesneden: number
  totaalSnijden: number
  totaalSnijdenGepland: number
  totDatum?: string | null
}


export function GroepAccordion({
  kwaliteitCode,
  kleurCode,
  totaalStukken,
  totaalOrders,
  totaalM2,
  totaalGesneden,
  totaalSnijden,
  totaalSnijdenGepland,
  totDatum,
}: GroepAccordionProps) {
  const [open, setOpen] = useState(true)
  const [genError, setGenError] = useState<string | null>(null)
  const [voorstelResult, setVoorstelResult] = useState<SnijvoorstelResponse | null>(null)
  const [showPlan, setShowPlan] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showSnijModal, setShowSnijModal] = useState(false)
  const genereer = useGenereerSnijvoorstel()
  const autoplan = useTriggerAutoplan()
  const { data: capaciteit } = useBeschikbareCapaciteit(kwaliteitCode, kleurCode)

  // Gepland = heeft rol toegewezen; Wacht = nog geen rol
  const heeftGepland = totaalSnijdenGepland > 0
  const heeftWacht = totaalSnijden - totaalSnijdenGepland > 0

  // Altijd stukken laden (view is standaard open)
  const { data: stukken, isLoading } = useSnijplannenVoorGroep(kwaliteitCode, kleurCode, true, totDatum)

  // Try loading the approved voorstel (has correct placed dimensions from optimizer)
  const { data: goedgekeurdPlan } = useGoedgekeurdVoorstel(kwaliteitCode, kleurCode, showPlan && !voorstelResult)

  // Fallback: reconstruct from snijplannen data (infers rotation from position)
  const reconstructedPlan = useMemo(() => {
    if (!showPlan || !stukken || goedgekeurdPlan) return null
    return buildPlanFromStukken(stukken)
  }, [showPlan, stukken, goedgekeurdPlan])

  // Priority: new voorstel > approved voorstel > reconstructed plan
  const modalData = voorstelResult ?? goedgekeurdPlan ?? reconstructedPlan

  // Snijbare stukken (status = Snijden)
  const snijbareStukken = useMemo(
    () => (stukken ?? []).filter(s => s.status === 'Snijden'),
    [stukken]
  )
  const selectedStukken = useMemo(
    () => snijbareStukken.filter(s => selectedIds.has(s.id)),
    [snijbareStukken, selectedIds]
  )
  const alleGeselecteerd = snijbareStukken.length > 0 && snijbareStukken.every(s => selectedIds.has(s.id))

  function toggleStuk(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAlles() {
    if (alleGeselecteerd) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(snijbareStukken.map(s => s.id)))
    }
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open) } }}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left cursor-pointer"
      >
        <div className="flex items-center gap-3 flex-wrap">
          {open ? (
            <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
          ) : (
            <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
          )}
          <span className="font-medium text-slate-900">
            {kwaliteitCode} {kleurCode}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge>{totaalOrders} {totaalOrders === 1 ? 'order' : 'orders'}</Badge>
            <Badge>{totaalStukken} stuks</Badge>
            <Badge>{totaalM2} m²</Badge>
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              totaalGesneden === totaalStukken
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            )}>
              {totaalGesneden}/{totaalStukken} gesneden
            </span>
            {capaciteit && (
              <Link
                to={`/rollen?kwaliteit=${kwaliteitCode}&kleur=${kleurCode}`}
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full hover:underline',
                  capaciteit.totaalRollen === 0
                    ? 'bg-red-50 text-red-700'
                    : capaciteit.vrijRollen > 0
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-blue-50 text-blue-700'
                )}
              >
                {capaciteit.vrijRollen > 0 && (
                  <>{capaciteit.vrijRollen} vrij ({capaciteit.vrijM2} m²)</>
                )}
                {capaciteit.vrijRollen > 0 && capaciteit.restcapaciteitRollen > 0 && ' · '}
                {capaciteit.restcapaciteitRollen > 0 && (
                  <>{capaciteit.restcapaciteitRollen} gepland ({capaciteit.restcapaciteitM2} m² over)</>
                )}
                {capaciteit.totaalRollen === 0 && '0 rollen · 0 m² beschikbaar'}
                {capaciteit.heeftUitwisselbaar && (
                  <span className="text-[10px] opacity-70"> (+{capaciteit.uitwisselbaarM2} m² uitw.)</span>
                )}
              </Link>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Bekijk plan button — when items are Gepland */}
          {heeftGepland && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowPlan(true)
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-[var(--radius-sm)] text-xs font-medium hover:bg-blue-600 transition-colors"
            >
              <Eye size={14} />
              Bekijk plan
            </button>
          )}

          {/* Snijden shortcut — linkt naar groepsproductie met alle rollen */}
          {heeftGepland && stukken && stukken.some(s => s.rol_id) && (
            <Link
              to={`/snijplanning/productie?kwaliteit=${kwaliteitCode}&kleur=${kleurCode}`}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 text-white rounded-[var(--radius-sm)] text-xs font-medium hover:bg-emerald-600 transition-colors"
            >
              <Scissors size={14} />
              Snijden
            </Link>
          )}

          {/* Genereren / Herplannen button — verberg als er geen rollen beschikbaar zijn */}
          {heeftWacht && (capaciteit?.totaalRollen ?? 0) > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setGenError(null)
                if (heeftGepland) {
                  // Er zijn al geplande stukken: gebruik auto-plan (release + heroptimaliseer)
                  autoplan.mutate(
                    { kwaliteitCode, kleurCode, totDatum },
                    {
                      onError: (err) => setGenError(err instanceof Error ? err.message : 'Onbekende fout'),
                    },
                  )
                } else {
                  // Alleen wachtende stukken: standaard genereren
                  genereer.mutate(
                    { kwaliteitCode, kleurCode, totDatum },
                    {
                      onSuccess: (result) => setVoorstelResult(result),
                      onError: (err) => setGenError(err instanceof Error ? err.message : 'Onbekende fout'),
                    },
                  )
                }
              }}
              disabled={genereer.isPending || autoplan.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-xs font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50"
            >
              {(genereer.isPending || autoplan.isPending) ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
              {heeftGepland ? 'Herplannen' : 'Genereren'}
            </button>
          )}

          <Link
            to={`/snijplanning/stickers?kwaliteit=${kwaliteitCode}&kleur=${kleurCode}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-[var(--radius-sm)] text-xs font-medium hover:bg-slate-50 transition-colors"
            title="Stickers printen voor hele groep"
          >
            <Printer size={14} />
            Stickers
          </Link>
        </div>
      </div>

      {/* Generation error */}
      {genError && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-[var(--radius-sm)] text-sm text-red-700">
          {genError}
          <button onClick={() => setGenError(null)} className="ml-2 underline text-xs">Sluiten</button>
        </div>
      )}

      {/* Detail: loaded on expand */}
      {open && (
        <div className="border-t border-slate-100 p-4">
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-4">Laden...</p>
          ) : !stukken || stukken.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Geen items gevonden</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                    <th className="py-2 pl-3 pr-1 w-8">
                      {snijbareStukken.length > 0 && (
                        <input
                          type="checkbox"
                          checked={alleGeselecteerd}
                          onChange={toggleAlles}
                          className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                          title="Selecteer alles"
                        />
                      )}
                    </th>
                    <th className="py-2 pr-3">Maat</th>
                    <th className="py-2 pr-3">Rol</th>
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
                  {stukken.map((stuk) => (
                    <StukRow
                      key={stuk.id}
                      stuk={stuk}
                      selected={selectedIds.has(stuk.id)}
                      onToggle={toggleStuk}
                    />
                  ))}
                </tbody>
              </table>

              {/* Actie-balk bij selectie */}
              {selectedIds.size > 0 && (
                <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 border-t border-emerald-200">
                  <div className="flex items-center gap-2 text-sm text-emerald-800">
                    <CheckSquare size={15} />
                    <span>
                      <strong>{selectedIds.size}</strong> stuk{selectedIds.size !== 1 ? 'ken' : ''} geselecteerd
                    </span>
                    <button
                      onClick={() => setSelectedIds(new Set())}
                      className="text-xs text-emerald-600 hover:underline ml-1"
                    >
                      Deselecteer
                    </button>
                  </div>
                  <button
                    onClick={() => setShowSnijModal(true)}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-[var(--radius-sm)] hover:bg-emerald-700 transition-colors"
                  >
                    <Scissors size={14} />
                    Snijden
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Snijbevestiging modal */}
      {showSnijModal && selectedStukken.length > 0 && (
        <SnijBevestigingModal
          stukken={selectedStukken}
          onClose={() => setShowSnijModal(false)}
          onSuccess={() => setSelectedIds(new Set())}
        />
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

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
      {children}
    </span>
  )
}

function StukRow({ stuk, selected, onToggle }: {
  stuk: SnijplanRow
  selected: boolean
  onToggle: (id: number) => void
}) {
  const kanSnijden = stuk.status === 'Snijden'
  return (
    <tr className={cn('hover:bg-slate-50', selected && 'bg-emerald-50/60')}>
      <td className="py-2 pl-3 pr-1">
        {kanSnijden && (
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(stuk.id)}
            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
          />
        )}
      </td>
      <td className="py-2 pr-3 font-medium">
        {stuk.snij_breedte_cm}×{stuk.snij_lengte_cm} cm
      </td>
      <td className="py-2 pr-3">
        {stuk.rolnummer && stuk.rol_id ? (
          <Link
            to={`/snijplanning/productie/${stuk.rol_id}`}
            className="text-terracotta-600 hover:underline text-xs"
          >
            {stuk.rolnummer}
          </Link>
        ) : '—'}
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
