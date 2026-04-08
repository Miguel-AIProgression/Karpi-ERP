import { useMemo, useState } from 'react'
import { X, Zap, CheckCircle2, XCircle, Loader2, AlertTriangle } from 'lucide-react'
import { useSnijplannenVoorGroep, useKeurSnijvoorstelGoed, useVerwerpSnijvoorstel } from '@/hooks/use-snijplanning'
import type { SnijvoorstelResponse, SnijvoorstelRol, SnijvoorstelPlaatsing, SnijplanRow } from '@/lib/types/productie'

// ---------------------------------------------------------------------------
// Color palette for orders
// ---------------------------------------------------------------------------

const COLORS = [
  { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' }, // blue
  { bg: '#fef3c7', border: '#f59e0b', text: '#92400e' }, // amber
  { bg: '#d1fae5', border: '#10b981', text: '#065f46' }, // emerald
  { bg: '#fee2e2', border: '#ef4444', text: '#991b1b' }, // red
  { bg: '#ede9fe', border: '#8b5cf6', text: '#5b21b6' }, // violet
  { bg: '#cffafe', border: '#06b6d4', text: '#155e75' }, // cyan
  { bg: '#ffedd5', border: '#f97316', text: '#9a3412' }, // orange
  { bg: '#fce7f3', border: '#ec4899', text: '#9d174d' }, // pink
]

function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

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
// Compact roll visualisation
// ---------------------------------------------------------------------------

function RolVisualisatie({
  rol,
  pieces,
}: {
  rol: SnijvoorstelRol
  pieces: PieceInfo[]
}) {
  const [hover, setHover] = useState<number | null>(null)

  // Scale: fit roll into container width, max 600px wide
  const maxW = 580
  const scale = Math.min(maxW / rol.rol_breedte_cm, 1)
  const w = rol.rol_breedte_cm * scale
  const h = rol.rol_lengte_cm * scale

  // Cap height for very long rolls
  const maxH = 400
  const scaleY = h > maxH ? maxH / rol.rol_lengte_cm : scale
  const finalH = Math.min(h, maxH)

  const gebruikteLengte = pieces.length > 0
    ? Math.max(...pieces.map(p => p.positie_y_cm + p.breedte_cm))
    : 0

  return (
    <div className="relative" style={{ width: w, height: finalH }}>
      {/* Roll background */}
      <div
        className="absolute inset-0 rounded border border-slate-300 bg-slate-50"
        style={{ width: w, height: finalH }}
      />

      {/* Rest area */}
      {gebruikteLengte < rol.rol_lengte_cm && (
        <div
          className="absolute border-t-2 border-dashed border-slate-300"
          style={{
            left: 0,
            top: gebruikteLengte * scaleY,
            width: w,
            height: finalH - gebruikteLengte * scaleY,
          }}
        >
          <span className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">
            {Math.round(rol.rol_lengte_cm - gebruikteLengte)} cm rest
          </span>
        </div>
      )}

      {/* Pieces */}
      {pieces.map((p, i) => {
        const color = COLORS[hashStr(p.order_nr) % COLORS.length]
        const px = p.positie_x_cm * scale
        const py = p.positie_y_cm * scaleY
        const pw = p.lengte_cm * scale
        const ph = p.breedte_cm * scaleY
        const isHovered = hover === i
        const showLabel = pw > 50 && ph > 28

        return (
          <div
            key={`${p.snijplan_id}-${i}`}
            className="absolute transition-shadow cursor-pointer"
            style={{
              left: px,
              top: py,
              width: pw,
              height: ph,
              backgroundColor: color.bg,
              border: `2px solid ${color.border}`,
              borderRadius: 3,
              zIndex: isHovered ? 20 : 1,
              boxShadow: isHovered ? '0 4px 12px rgba(0,0,0,0.15)' : 'none',
            }}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            {showLabel && (
              <div className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-1">
                <span className="text-xs font-semibold leading-tight" style={{ color: color.text }}>
                  {p.lengte_cm}×{p.breedte_cm}
                </span>
                <span className="text-[10px] leading-tight truncate max-w-full" style={{ color: color.text }}>
                  {p.klant_naam.length > 16 ? p.klant_naam.slice(0, 14) + '…' : p.klant_naam}
                </span>
              </div>
            )}

            {/* Hover tooltip */}
            {isHovered && (
              <div
                className="absolute z-30 bg-white border border-slate-200 rounded shadow-lg px-3 py-2 text-xs whitespace-nowrap pointer-events-none"
                style={{ left: pw + 8, top: 0 }}
              >
                <p className="font-semibold text-slate-900">{p.order_nr}</p>
                <p className="text-slate-600">{p.klant_naam}</p>
                <p className="text-slate-500">{p.lengte_cm} × {p.breedte_cm} cm{p.geroteerd ? ' (gedraaid)' : ''}</p>
              </div>
            )}
          </div>
        )
      })}

      {/* Width label */}
      <div className="absolute -bottom-5 left-0 w-full text-center text-[10px] text-slate-400">
        {rol.rol_breedte_cm} cm
      </div>
    </div>
  )
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
          {rollenMetPieces.map(({ rol, pieces }) => (
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
              <div className="flex justify-center pb-6">
                <RolVisualisatie rol={rol} pieces={pieces} />
              </div>
            </div>
          ))}

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
