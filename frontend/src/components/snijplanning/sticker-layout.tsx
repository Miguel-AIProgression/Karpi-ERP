import type { SnijplanRow } from '@/lib/types/productie'
import { AFWERKING_MAP } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'

interface StickerLayoutProps {
  snijplan: SnijplanRow
  label?: string
}

function formatMaat(row: SnijplanRow): string {
  const b = row.maatwerk_breedte_cm ?? row.snij_breedte_cm
  const l = row.maatwerk_lengte_cm ?? row.snij_lengte_cm
  return `${b} \u00d7 ${l} cm`
}

function formatVorm(row: SnijplanRow): string {
  if (!row.maatwerk_vorm) return '-'
  return getVormDisplay(row.maatwerk_vorm).label
}

function formatAfwerking(row: SnijplanRow): string {
  if (!row.maatwerk_afwerking) return 'Geen'
  const info = AFWERKING_MAP[row.maatwerk_afwerking]
  const base = info ? `${info.code} ${info.label}` : row.maatwerk_afwerking
  if ((row.maatwerk_afwerking === 'B' || row.maatwerk_afwerking === 'SB') && row.maatwerk_band_kleur) {
    return `${base} - ${row.maatwerk_band_kleur}`
  }
  return base
}

export function StickerLayout({ snijplan, label }: StickerLayoutProps) {
  return (
    <div
      className="sticker-label border border-dashed border-slate-300 p-3 box-border"
      style={{ width: '100mm', height: '60mm' }}
    >
      {label && (
        <div className="text-[8px] text-slate-400 mb-0.5 print:hidden">{label}</div>
      )}

      {/* Scancode */}
      <div className="text-lg font-bold tracking-wide mb-1">{snijplan.scancode}</div>

      {/* Barcode placeholder */}
      <div className="font-mono text-xs bg-slate-50 border border-slate-200 px-2 py-1 mb-2 text-center tracking-[0.25em]">
        {snijplan.scancode}
      </div>

      {/* Product info */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] leading-tight">
        <div>
          <span className="text-slate-400">Product: </span>
          <span className="font-medium">
            {snijplan.kwaliteit_code} {snijplan.kleur_code}
          </span>
        </div>
        <div>
          <span className="text-slate-400">Maat: </span>
          <span className="font-medium">{formatMaat(snijplan)}</span>
        </div>
        <div>
          <span className="text-slate-400">Vorm: </span>
          <span className="font-medium">{formatVorm(snijplan)}</span>
        </div>
        <div>
          <span className="text-slate-400">Afwerking: </span>
          <span className="font-medium">{formatAfwerking(snijplan)}</span>
        </div>
        <div>
          <span className="text-slate-400">Klant: </span>
          <span className="font-medium">{snijplan.klant_naam}</span>
        </div>
        <div>
          <span className="text-slate-400">Order: </span>
          <span className="font-medium">{snijplan.order_nr}</span>
        </div>
      </div>
    </div>
  )
}
