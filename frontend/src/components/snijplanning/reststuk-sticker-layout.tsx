import { useMemo } from 'react'
import QRCode from 'qrcode'

interface ReststukStickerProps {
  rolnummer: string
  kwaliteit: string
  kleur: string
  lengte_cm: number
  breedte_cm: number
  datum: string
}

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

export function ReststukStickerLayout({ rolnummer, kwaliteit, kleur, lengte_cm, breedte_cm, datum }: ReststukStickerProps) {
  const qrSvg = useQrSvg(rolnummer)
  const oppervlak = Math.round((lengte_cm * breedte_cm) / 10000 * 100) / 100

  return (
    <div
      className="sticker-label border border-dashed border-slate-300 bg-white box-border p-4 flex flex-col justify-between"
      style={{ width: '100mm', height: '60mm' }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <FloorpassionLogo />
        <span className="ml-auto text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">
          RESTSTUK
        </span>
      </div>

      <hr className="border-slate-300 mb-2" />

      {/* Body */}
      <div className="flex justify-between flex-1">
        <div className="flex flex-col gap-0.5 text-[11px] leading-snug">
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Rolnummer</span>
            <span className="font-semibold">: {rolnummer}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Kwaliteit</span>
            <span className="font-semibold">: {kwaliteit}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Kleur</span>
            <span className="font-semibold">: {kleur}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Afmeting</span>
            <span className="font-semibold">: {breedte_cm} × {lengte_cm} cm</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Oppervlak</span>
            <span className="font-semibold">: {oppervlak} m²</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Datum</span>
            <span className="font-semibold">: {datum}</span>
          </div>
        </div>

        {/* QR code */}
        <div className="flex flex-col items-center justify-center">
          {qrSvg ? (
            <div className="w-20 h-20" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div className="w-20 h-20 bg-slate-100 flex items-center justify-center text-[8px] text-slate-400">
              QR
            </div>
          )}
          <span className="text-[9px] text-slate-500 mt-0.5">{rolnummer}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-between items-end mt-1 pt-1">
        <span className="text-xs font-bold">{rolnummer}</span>
        <span className="text-xs text-slate-500">Locatie: ___________</span>
      </div>
    </div>
  )
}

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
