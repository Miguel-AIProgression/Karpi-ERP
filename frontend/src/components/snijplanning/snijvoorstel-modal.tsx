import { useMemo, useState } from 'react'
import { X, Zap, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { useSnijplannenVoorGroep, useKeurSnijvoorstelGoed, useVerwerpSnijvoorstel } from '@/hooks/use-snijplanning'
import { SnijVisualisatie } from './snij-visualisatie'
import type { SnijvoorstelResponse, SnijvoorstelPlaatsing, SnijplanRow, SnijStuk } from '@/lib/types/productie'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnijvoorstelModalProps {
  voorstel: SnijvoorstelResponse
  kwaliteitCode: string
  kleurCode: string
  onClose: () => void
  readOnly?: boolean
}

interface PieceInfo extends SnijvoorstelPlaatsing {
  order_nr: string
  klant_naam: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map PieceInfo[] naar SnijStuk[] voor de SVG visualisatie */
function mapToSnijStukken(
  pieces: PieceInfo[],
  snijplanMap: Map<number, SnijplanRow>,
): SnijStuk[] {
  return pieces.map(p => {
    const sp = snijplanMap.get(p.snijplan_id)
    return {
      snijplan_id: p.snijplan_id,
      order_regel_id: sp?.order_regel_id ?? 0,
      order_nr: p.order_nr,
      klant_naam: p.klant_naam,
      lengte_cm: p.lengte_cm,
      breedte_cm: p.breedte_cm,
      vorm: sp?.maatwerk_vorm ?? 'rechthoek',
      afwerking: sp?.maatwerk_afwerking ?? null,
      x_cm: p.positie_x_cm,
      y_cm: p.positie_y_cm,
      geroteerd: p.geroteerd,
      afleverdatum: sp?.afleverdatum ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function SnijvoorstelModal({ voorstel, kwaliteitCode, kleurCode, onClose, readOnly }: SnijvoorstelModalProps) {
  const { data: snijplannen } = useSnijplannenVoorGroep(kwaliteitCode, kleurCode, true)
  const goedkeuren = useKeurSnijvoorstelGoed()
  const verwerpen = useVerwerpSnijvoorstel()
  const [error, setError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)

  const snijplanMap = useMemo(() => {
    const map = new Map<number, SnijplanRow>()
    for (const sp of snijplannen ?? []) map.set(sp.id, sp)
    return map
  }, [snijplannen])

  const rollenMetPieces = useMemo(() => {
    return voorstel.rollen.map((rol) => ({
      rol,
      pieces: rol.plaatsingen.map((p): PieceInfo => {
        const sp = snijplanMap.get(p.snijplan_id)
        return { ...p, order_nr: sp?.order_nr ?? '?', klant_naam: sp?.klant_naam ?? '?' }
      }),
    }))
  }, [voorstel.rollen, snijplanMap])

  const sam = voorstel.samenvatting

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-2xl w-[660px] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Zap size={16} className="text-amber-500" />
            <span className="font-semibold text-sm">Snijvoorstel</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              {sam.geplaatst}/{sam.totaal_stukken} stuks · {sam.totaal_rollen} rollen · {sam.gemiddeld_afval_pct}% afval
            </span>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-8">
          {rollenMetPieces.map(({ rol, pieces }) => {
            const snijStukken = mapToSnijStukken(pieces, snijplanMap)
            const visLengte = Math.min(rol.rol_lengte_cm, rol.gebruikte_lengte_cm + 100)

            return (
              <div key={rol.rol_id}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{rol.rolnummer}</span>
                    <span className="text-xs text-slate-500">
                      {rol.rol_breedte_cm} × {rol.rol_lengte_cm} cm
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                      {pieces.length} stuks
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {rol.afval_percentage}% afval · {(rol.restlengte_cm / 100).toFixed(1)}m rest
                  </span>
                </div>
                <div className="flex justify-center pb-4">
                  <SnijVisualisatie
                    rolBreedte={rol.rol_breedte_cm}
                    rolLengte={visLengte}
                    stukken={snijStukken}
                    restLengte={visLengte - rol.gebruikte_lengte_cm}
                    afvalPct={rol.afval_percentage}
                    reststukBruikbaar={rol.restlengte_cm > 100}
                    reststukken={rol.reststukken}
                    className="max-w-lg"
                  />
                </div>
              </div>
            )
          })}

          {voorstel.niet_geplaatst.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
              <AlertTriangle size={14} />
              {voorstel.niet_geplaatst.length} stukken niet geplaatst
            </div>
          )}

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{error}</div>
          )}
        </div>

        {/* Footer */}
        {readOnly ? (
          <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-200 bg-blue-50 text-blue-700 text-sm flex-shrink-0">
            <CheckCircle2 size={14} />
            Goedgekeurd snijplan — rollen zijn gereserveerd
            <button onClick={onClose} className="ml-auto underline text-xs">Sluiten</button>
          </div>
        ) : !approved ? (
          <div className="flex items-center gap-3 px-5 py-3 border-t border-slate-200 bg-slate-50 flex-shrink-0">
            <button
              onClick={() => {
                setError(null)
                goedkeuren.mutate(voorstel.voorstel_id, {
                  onSuccess: () => setApproved(true),
                  onError: (err) => setError(err instanceof Error ? err.message : 'Fout'),
                })
              }}
              disabled={goedkeuren.isPending || verwerpen.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50"
            >
              {goedkeuren.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Goedkeuren
            </button>
            <button
              onClick={() => {
                setError(null)
                verwerpen.mutate(voorstel.voorstel_id, {
                  onSuccess: () => onClose(),
                  onError: (err) => setError(err instanceof Error ? err.message : 'Fout'),
                })
              }}
              disabled={goedkeuren.isPending || verwerpen.isPending}
              className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm hover:bg-slate-100 transition-colors disabled:opacity-50"
            >
              {verwerpen.isPending ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
              Verwerpen
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-5 py-3 border-t border-emerald-200 bg-emerald-50 text-emerald-700 text-sm flex-shrink-0">
            <CheckCircle2 size={14} />
            Goedgekeurd — rollen zijn toegewezen
            <button onClick={onClose} className="ml-auto underline text-xs">Sluiten</button>
          </div>
        )}
      </div>
    </div>
  )
}
