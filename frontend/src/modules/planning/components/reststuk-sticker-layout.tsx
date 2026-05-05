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

function formatKleur(kleur: string): string {
  return kleur.replace(/\.0+$/, '')
}

export function ReststukStickerLayout({ rolnummer, kwaliteit, kleur, lengte_cm, breedte_cm }: ReststukStickerProps) {
  const qrSvg = useQrSvg(rolnummer)

  return (
    <div
      className="sticker-label border border-dashed border-slate-300 bg-white box-border p-4 flex flex-col justify-between"
      style={{ width: '100mm', height: '60mm' }}
    >
      {/* Body */}
      <div className="flex justify-between flex-1">
        <div className="flex flex-col gap-1 text-[13px] leading-snug justify-center">
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-20">Kwaliteit</span>
            <span className="font-semibold">: {kwaliteit}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-20">Kleur</span>
            <span className="font-semibold">: {formatKleur(kleur)}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-20">Afmeting</span>
            <span className="font-semibold">: {breedte_cm} × {lengte_cm} cm</span>
          </div>
        </div>

        {/* QR code */}
        <div className="flex flex-col items-center justify-center">
          {qrSvg ? (
            <div className="w-24 h-24" dangerouslySetInnerHTML={{ __html: qrSvg }} />
          ) : (
            <div className="w-24 h-24 bg-slate-100 flex items-center justify-center text-[8px] text-slate-400">
              QR
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
