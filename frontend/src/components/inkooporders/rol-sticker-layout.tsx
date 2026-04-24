import { useMemo } from 'react'
import QRCode from 'qrcode'

export interface RolStickerData {
  id: number
  rolnummer: string
  karpi_code: string | null
  omschrijving: string | null
  kwaliteit_code: string | null
  kleur_code: string | null
  lengte_cm: number | null
  breedte_cm: number | null
  oppervlak_m2: number | null
  leverancier_naam: string | null
  inkooporder_nr: string | null
}

function useQrSvg(text: string): string {
  return useMemo(() => {
    if (!text) return ''
    try {
      let svg = ''
      QRCode.toString(
        text,
        { type: 'svg', width: 96, margin: 1, errorCorrectionLevel: 'M' },
        (err, str) => {
          if (!err && str) svg = str
        },
      )
      return svg
    } catch {
      return ''
    }
  }, [text])
}

function formatLengte(cm: number | null): string {
  if (cm == null) return '-'
  return `${(cm / 100).toFixed(2)} m`
}

export function RolStickerLayout({ rol }: { rol: RolStickerData }) {
  const qrSvg = useQrSvg(rol.rolnummer)

  return (
    <div
      className="sticker-label border border-dashed border-slate-300 bg-white box-border p-4 flex flex-col justify-between"
      style={{ width: '100mm', height: '60mm' }}
    >
      {/* Header: rolnummer prominent */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] text-terracotta-500 uppercase tracking-wide">Rolnummer</div>
          <div className="text-lg font-bold tracking-tight">{rol.rolnummer}</div>
        </div>
        {rol.karpi_code && (
          <div className="text-right">
            <div className="text-[10px] text-terracotta-500 uppercase tracking-wide">Karpi-code</div>
            <div className="text-sm font-semibold">{rol.karpi_code}</div>
          </div>
        )}
      </div>

      <hr className="border-slate-300 my-1" />

      {/* Body: info + QR */}
      <div className="flex justify-between flex-1">
        <div className="flex flex-col gap-0.5 text-[11px] leading-snug">
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Kwaliteit</span>
            <span className="font-semibold">: {rol.kwaliteit_code ?? '-'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Kleur</span>
            <span className="font-semibold">: {rol.kleur_code ?? '-'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Lengte</span>
            <span className="font-semibold">: {formatLengte(rol.lengte_cm)}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Breedte</span>
            <span className="font-semibold">: {rol.breedte_cm != null ? `${rol.breedte_cm} cm` : '-'}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-terracotta-500 w-16">Oppervlak</span>
            <span className="font-semibold">
              : {rol.oppervlak_m2 != null ? `${Number(rol.oppervlak_m2).toLocaleString('nl-NL', { maximumFractionDigits: 2 })} m²` : '-'}
            </span>
          </div>
        </div>

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

      {/* Footer: inkoop-herkomst */}
      <div className="flex justify-between items-end mt-1 pt-1 text-[9px] text-slate-500">
        <span className="truncate">{rol.leverancier_naam ?? ''}</span>
        <span>{rol.inkooporder_nr ?? ''}</span>
      </div>
    </div>
  )
}
