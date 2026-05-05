import { useMemo, useState } from 'react'
import QRCode from 'qrcode'
import type { SnijplanRow } from '@/lib/types/productie'
import { AFWERKING_MAP } from '@/lib/utils/constants'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

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

export function StickerLayout({ snijplan, label: _label }: StickerLayoutProps) {
  const qrSvg = useQrSvg(snijplan.scancode)

  return (
    <div
      className="sticker-label border border-dashed border-slate-300 bg-white box-border p-4 flex flex-col justify-between"
      style={{ width: '100mm', height: '60mm' }}
    >
      {/* Header: Klantlogo */}
      <div className="flex items-center gap-2 mb-1">
        <KlantLogo debiteurNr={snijplan.debiteur_nr} klantNaam={snijplan.klant_naam} />
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
        </div>
      </div>

      {/* Footer: order_nr */}
      <div className="flex justify-end items-end mt-1 pt-1">
        <span className="text-xs text-slate-500">{snijplan.order_nr}</span>
      </div>
    </div>
  )
}

/** Klantlogo uit Supabase storage; fallback naar klantnaam als tekst */
function KlantLogo({ debiteurNr, klantNaam }: { debiteurNr: number; klantNaam: string }) {
  const [failed, setFailed] = useState(false)
  const logoUrl = SUPABASE_URL
    ? `${SUPABASE_URL}/storage/v1/object/public/logos/${debiteurNr}.jpg`
    : null

  if (!logoUrl || failed) {
    return (
      <span className="text-sm font-bold tracking-tight uppercase truncate">
        {klantNaam}
      </span>
    )
  }

  return (
    <img
      src={logoUrl}
      alt={klantNaam}
      className="h-8 max-w-[60mm] object-contain"
      onError={() => setFailed(true)}
    />
  )
}
