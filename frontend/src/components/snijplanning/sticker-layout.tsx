import { useMemo } from 'react'
import QRCode from 'qrcode'
import type { SnijplanRow } from '@/lib/types/productie'
import { AFWERKING_MAP } from '@/lib/utils/constants'

interface StickerLayoutProps {
  snijplan: SnijplanRow
  label?: string
}

function formatMaat(row: SnijplanRow): string {
  const b = row.maatwerk_breedte_cm ?? row.snij_breedte_cm
  const l = row.maatwerk_lengte_cm ?? row.snij_lengte_cm
  return `ca. ${b} × ${l} cm.`
}

function formatVorm(row: SnijplanRow): string {
  if (!row.maatwerk_vorm) return '-'
  const labels: Record<string, string> = {
    rechthoek: 'Rechthoek',
    rond: 'Rond',
    ovaal: 'Ovaal',
  }
  return labels[row.maatwerk_vorm] ?? row.maatwerk_vorm
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

/** Genereer QR SVG string synchroon — geen flash bij eerste render/print */
function useQrSvg(text: string): string {
  return useMemo(() => {
    if (!text) return ''
    try {
      let svg = ''
      QRCode.toString(text, { type: 'svg', width: 96, margin: 1, errorCorrectionLevel: 'M' },
        (err, str) => { if (!err && str) svg = str })
      return svg
    } catch {
      return ''
    }
  }, [text])
}

export function StickerLayout({ snijplan, label }: StickerLayoutProps) {
  const qrSvg = useQrSvg(snijplan.scancode)

  return (
    <div
      className="sticker-label border border-dashed border-slate-300 bg-white box-border p-4 flex flex-col justify-between"
      style={{ width: '100mm', height: '60mm' }}
    >
      {label && (
        <div className="text-[8px] text-slate-400 mb-0.5 print:hidden">{label}</div>
      )}

      {/* Header: Logo */}
      <div className="flex items-center gap-2 mb-1">
        <FloorpassionLogo />
      </div>

      <hr className="border-slate-300 mb-2" />

      {/* Body: info + QR */}
      <div className="flex justify-between flex-1">
        {/* Left: Product details */}
        <div className="flex flex-col gap-0.5 text-[11px] leading-snug">
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Kwaliteit</span>
            <span className="font-semibold">: {snijplan.kwaliteit_code}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Kleur</span>
            <span className="font-semibold">: {snijplan.kleur_code}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Afmeting</span>
            <span className="font-semibold">: {formatMaat(snijplan)}</span>
          </div>
          {snijplan.maatwerk_vorm && snijplan.maatwerk_vorm !== 'rechthoek' && (
            <div className="flex gap-2">
              <span className="text-terracotta-500 w-16">Vorm</span>
              <span className="font-semibold">: {formatVorm(snijplan)}</span>
            </div>
          )}
          {snijplan.maatwerk_afwerking && (
            <div className="flex gap-2">
              <span className="text-terracotta-500 w-16">Afwerking</span>
              <span className="font-semibold">: {formatAfwerking(snijplan)}</span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Klant</span>
            <span className="font-semibold">: {snijplan.klant_naam}</span>
          </div>
        </div>

        {/* Right: QR code */}
        <div className="flex flex-col items-center justify-center">
          {qrSvg ? (
            <div className="w-20 h-20" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div className="w-20 h-20 bg-slate-100 flex items-center justify-center text-[8px] text-slate-400">
              QR
            </div>
          )}
          <span className="text-[9px] text-slate-500 mt-0.5">{snijplan.scancode}</span>
        </div>
      </div>

      {/* Footer: snijplan_nr + order_nr */}
      <div className="flex justify-between items-end mt-1 pt-1">
        <span className="text-xs font-bold">{snijplan.snijplan_nr}</span>
        <span className="text-xs text-slate-500">{snijplan.order_nr}</span>
      </div>
    </div>
  )
}

/** Inline SVG Floorpassion logo — simpele tekst-versie */
function FloorpassionLogo() {
  return (
    <div className="flex items-center gap-1.5">
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="4" y="4" width="16" height="16" rx="1" transform="rotate(45 12 12)" />
        <text x="12" y="14" textAnchor="middle" fontSize="8" fill="currentColor" stroke="none" fontWeight="bold">FP</text>
      </svg>
      <span className="text-sm font-bold tracking-tight">FLOORPASSION.</span>
    </div>
  )
}
