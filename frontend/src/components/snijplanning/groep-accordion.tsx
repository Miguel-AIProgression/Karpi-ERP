import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Printer, Scissors, Loader2, Eye } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import { useSnijplannenVoorGroep, useGenereerSnijvoorstel, useBeschikbareCapaciteit, useGoedgekeurdVoorstel } from '@/hooks/use-snijplanning'
import { SnijvoorstelModal } from './snijvoorstel-modal'
import type { SnijplanRow, SnijvoorstelResponse, SnijvoorstelRol } from '@/lib/types/productie'

/**
 * Reconstruct a SnijvoorstelResponse from loaded snijplannen data (fallback when no voorstel record exists).
 *
 * Optimizer convention: lengte_cm = X (across roll width), breedte_cm = Y (along roll length).
 * Raw piece data has snij_lengte_cm/snij_breedte_cm without rotation info.
 * We infer rotation by checking which orientation fits the stored position on the roll.
 */
function buildPlanFromStukken(stukken: SnijplanRow[]): SnijvoorstelResponse | null {
  const gepland = stukken.filter(s => s.status === 'Gepland' && s.rolnummer)
  if (gepland.length === 0) return null

  const rolMap = new Map<string, { stukken: SnijplanRow[]; rol_lengte_cm: number; rol_breedte_cm: number; rol_status: string }>()
  for (const s of gepland) {
    const key = s.rolnummer!
    if (!rolMap.has(key)) {
      rolMap.set(key, {
        stukken: [],
        rol_lengte_cm: s.rol_lengte_cm ?? 0,
        rol_breedte_cm: s.rol_breedte_cm ?? 0,
        rol_status: s.rol_status ?? 'in_snijplan',
      })
    }
    rolMap.get(key)!.stukken.push(s)
  }

  const rollen: SnijvoorstelRol[] = Array.from(rolMap.entries()).map(([rolnummer, info]) => {
    // Determine shelf heights from Y positions to correctly infer piece rotation.
    // FFDH places pieces on shelves: all pieces with the same positie_y_cm are on one shelf.
    // Shelf height = gap to the next shelf's Y (or remaining roll length for the last shelf).
    const uniqueYs = [...new Set(info.stukken.map(s => s.positie_y_cm ?? 0))].sort((a, b) => a - b)
    const shelfHeightAt = new Map<number, number>()
    for (let i = 0; i < uniqueYs.length; i++) {
      const nextY = i + 1 < uniqueYs.length ? uniqueYs[i + 1] : info.rol_lengte_cm
      shelfHeightAt.set(uniqueYs[i], nextY - uniqueYs[i])
    }

    const plaatsingen = info.stukken.map(s => {
      const x = s.positie_x_cm ?? 0
      const y = s.positie_y_cm ?? 0
      const shelfH = shelfHeightAt.get(y) ?? info.rol_lengte_cm

      // Pick orientation whose Y-extent fits the shelf height
      // Default (not rotated): X = snij_lengte, Y = snij_breedte
      // Rotated: X = snij_breedte, Y = snij_lengte
      const defaultYFits = s.snij_breedte_cm <= shelfH && x + s.snij_lengte_cm <= info.rol_breedte_cm
      const rotatedYFits = s.snij_lengte_cm <= shelfH && x + s.snij_breedte_cm <= info.rol_breedte_cm
      const isRotated = !defaultYFits && rotatedYFits

      return {
        snijplan_id: s.id,
        positie_x_cm: x,
        positie_y_cm: y,
        lengte_cm: isRotated ? s.snij_breedte_cm : s.snij_lengte_cm,  // X dimension
        breedte_cm: isRotated ? s.snij_lengte_cm : s.snij_breedte_cm, // Y dimension
        geroteerd: isRotated,
      }
    })

    const gebruikte = plaatsingen.length > 0
      ? Math.max(...plaatsingen.map(p => p.positie_y_cm + p.breedte_cm))
      : 0
    const pieceArea = plaatsingen.reduce((s, p) => s + p.lengte_cm * p.breedte_cm, 0)
    const usedArea = info.rol_breedte_cm * gebruikte
    const afval = usedArea > 0 ? Math.round((1 - pieceArea / usedArea) * 1000) / 10 : 0

    return {
      rol_id: 0,
      rolnummer,
      rol_lengte_cm: info.rol_lengte_cm,
      rol_breedte_cm: info.rol_breedte_cm,
      rol_status: info.rol_status as SnijvoorstelRol['rol_status'],
      plaatsingen,
      gebruikte_lengte_cm: gebruikte,
      afval_percentage: afval,
      restlengte_cm: info.rol_lengte_cm - gebruikte,
    }
  })

  const totaalGeplaatst = rollen.reduce((s, r) => s + r.plaatsingen.length, 0)
  const totaalM2Gebruikt = rollen.reduce((s, r) => s + (r.rol_breedte_cm * r.gebruikte_lengte_cm) / 10000, 0)
  const totaalM2Afval = rollen.reduce((s, r) => {
    const used = (r.rol_breedte_cm * r.gebruikte_lengte_cm) / 10000
    return s + used * (r.afval_percentage / 100)
  }, 0)
  const gemAfval = rollen.length > 0
    ? Math.round(rollen.reduce((s, r) => s + r.afval_percentage, 0) / rollen.length * 10) / 10
    : 0

  return {
    voorstel_id: 0,
    voorstel_nr: 'Huidig plan',
    rollen,
    niet_geplaatst: [],
    samenvatting: {
      totaal_stukken: gepland.length,
      geplaatst: totaalGeplaatst,
      niet_geplaatst: 0,
      totaal_rollen: rollen.length,
      gemiddeld_afval_pct: gemAfval,
      totaal_m2_gebruikt: Math.round(totaalM2Gebruikt * 10) / 10,
      totaal_m2_afval: Math.round(totaalM2Afval * 10) / 10,
    },
  }
}

interface GroepAccordionProps {
  kwaliteitCode: string
  kleurCode: string
  totaalStukken: number
  totaalOrders: number
  totaalM2: number
  totaalGesneden: number
  totaalGepland: number
  totaalWacht: number
}


export function GroepAccordion({
  kwaliteitCode,
  kleurCode,
  totaalStukken,
  totaalOrders,
  totaalM2,
  totaalGesneden,
  totaalGepland,
  totaalWacht,
}: GroepAccordionProps) {
  const [open, setOpen] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [voorstelResult, setVoorstelResult] = useState<SnijvoorstelResponse | null>(null)
  const [showPlan, setShowPlan] = useState(false)
  const genereer = useGenereerSnijvoorstel()
  const { data: capaciteit } = useBeschikbareCapaciteit(kwaliteitCode, kleurCode)

  // Load stukken when accordion is open OR when showing plan (fallback needs it)
  const { data: stukken, isLoading } = useSnijplannenVoorGroep(kwaliteitCode, kleurCode, open || showPlan)

  // Use parent props for button visibility (no need to expand accordion first)
  const heeftGepland = totaalGepland > 0
  const heeftWacht = totaalWacht > 0

  // Try loading the approved voorstel (has correct placed dimensions from optimizer)
  const { data: goedgekeurdPlan } = useGoedgekeurdVoorstel(kwaliteitCode, kleurCode, showPlan && !voorstelResult)

  // Fallback: reconstruct from snijplannen data (infers rotation from position)
  const reconstructedPlan = useMemo(() => {
    if (!showPlan || !stukken || goedgekeurdPlan) return null
    return buildPlanFromStukken(stukken)
  }, [showPlan, stukken, goedgekeurdPlan])

  // Priority: new voorstel > approved voorstel > reconstructed plan
  const modalData = voorstelResult ?? goedgekeurdPlan ?? reconstructedPlan

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
              <span className={cn(
                'text-xs px-2 py-0.5 rounded-full',
                capaciteit.totaalM2 >= totaalM2
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-red-50 text-red-700'
              )}>
                {capaciteit.totaalRollen} rollen · {capaciteit.totaalM2} m² beschikbaar
                {capaciteit.heeftUitwisselbaar && (
                  <span className="text-[10px] opacity-70"> (+{capaciteit.uitwisselbaarM2} m² uitw.)</span>
                )}
              </span>
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

          {/* Genereren button — only when there are Wacht items */}
          {heeftWacht && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setGenError(null)
                genereer.mutate(
                  { kwaliteitCode, kleurCode },
                  {
                    onSuccess: (result) => setVoorstelResult(result),
                    onError: (err) => setGenError(err instanceof Error ? err.message : 'Onbekende fout'),
                  },
                )
              }}
              disabled={genereer.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-xs font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50"
            >
              {genereer.isPending ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
              Genereren
            </button>
          )}

          <Printer size={16} className="text-slate-400 hover:text-slate-600" />
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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                  <th className="py-2 pr-3">Maat</th>
                  <th className="py-2 pr-3">Vorm</th>
                  <th className="py-2 pr-3">Klant</th>
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Afwerking</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stukken.map((stuk) => (
                  <StukRow key={stuk.id} stuk={stuk} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Snijvoorstel modal */}
      {modalData && (
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
        {stuk.maatwerk_afwerking && AFWERKING_MAP[stuk.maatwerk_afwerking] ? (
          <span className={cn('text-xs px-1.5 py-0.5 rounded', AFWERKING_MAP[stuk.maatwerk_afwerking].bg, AFWERKING_MAP[stuk.maatwerk_afwerking].text)}>
            {stuk.maatwerk_afwerking}
          </span>
        ) : '—'}
      </td>
      <td className="py-2 pr-3">
        <span className={cn(
          'text-xs px-1.5 py-0.5 rounded',
          stuk.status === 'Wacht' ? 'bg-slate-100 text-slate-600'
            : stuk.status === 'Gepland' ? 'bg-blue-100 text-blue-700'
            : stuk.status === 'Gesneden' ? 'bg-emerald-100 text-emerald-700'
            : 'bg-slate-100 text-slate-600'
        )}>
          {stuk.status}
        </span>
      </td>
    </tr>
  )
}
