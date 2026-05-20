import { useState } from 'react'
import { Ean13Barcode } from '@/components/ui/ean13-barcode'
import type { StickerData } from '@/modules/snijplanning'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

/**
 * Klant-facing maatwerk-sticker (mig 295, 148×106 mm landschap).
 *
 * Komt op het opgerolde maatwerk-tapijt vlak vóór verzending. Bevat
 * alleen wat de eindafnemer ziet: debiteur-logo + 4 product-velden +
 * EAN-13. Geen QR, scancode, klantnaam, vorm of afwerking — die
 * operator-info loopt via de werkbon/scanstation-scherm.
 *
 * Layout (vaste posities):
 *   ┌───────────────────────────────────┐
 *   │           [debiteur-logo]         │
 *   │                                   │
 *   │  Kwaliteit    : LORANDA           │
 *   │  Poolmateriaal: 100% Polypropyleen│ [EAN-13]
 *   │  Kleur        : 13                │
 *   │                                   │
 *   │  Afmeting     : ca. 310 x 225 cm. │
 *   └───────────────────────────────────┘
 */
interface StickerLayoutProps {
  sticker: StickerData
  /** Screen-only hint (bv. "Sticker tapijt" / "Sticker orderdossier"). Verschijnt boven de sticker, niet op print. */
  label?: string
}

function formatAfmeting(s: StickerData): string {
  return `ca. ${s.lengte_cm} x ${s.breedte_cm} cm.`
}

export function StickerLayout({ sticker, label }: StickerLayoutProps) {
  return (
    <div className="flex flex-col">
      {label && (
        <span className="print:hidden text-xs text-slate-400 mb-1">{label}</span>
      )}
      <StickerCard sticker={sticker} />
    </div>
  )
}

function StickerCard({ sticker }: { sticker: StickerData }) {
  return (
    <div
      className="sticker-label bg-white box-border flex flex-col"
      style={{
        width: '148mm',
        height: '106mm',
        padding: '5mm 8mm',
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
        color: '#111',
      }}
    >
      {/* Header: logo gecentreerd */}
      <div className="flex items-center justify-center" style={{ height: '26mm' }}>
        <KlantLogo debiteurNr={sticker.debiteur_nr} klantNaam={sticker.klant_naam} />
      </div>

      {/* Middenblok: 3 product-velden links, EAN-13 rechts (parallel, top-aligned).
          Poolmateriaal-regel verschijnt altijd (label + ":"); waarde blijft leeg
          als kwaliteiten.poolmateriaal nog NULL is — bewust visueel consistent
          ongeacht of het veld al gevuld is. */}
      <div className="flex justify-between items-start" style={{ marginTop: '3mm' }}>
        <div className="flex flex-col gap-[1.5mm]" style={{ fontSize: '11pt' }}>
          <Veld label="Kwaliteit"     waarde={sticker.kwaliteit_naam} />
          <Veld label="Poolmateriaal" waarde={sticker.poolmateriaal ?? ''} />
          <Veld label="Kleur"         waarde={sticker.kleur_code} />
        </div>

        <div style={{ width: '52mm' }}>
          {sticker.ean_code ? (
            <Ean13Barcode
              value={sticker.ean_code}
              height={60}
              className="block"
              style={{ width: '52mm', height: '22mm' }}
            />
          ) : (
            <div className="text-[8pt] text-slate-400 text-right">geen EAN</div>
          )}
        </div>
      </div>

      {/* Onderblok: alleen Afmeting, met witruimte ervoor (zoals foto's) */}
      <div className="flex flex-col gap-[1.5mm]" style={{ marginTop: '8mm', fontSize: '11pt' }}>
        <Veld label="Afmeting" waarde={formatAfmeting(sticker)} />
      </div>
    </div>
  )
}

interface VeldProps {
  label: string
  waarde: string | number
}

function Veld({ label, waarde }: VeldProps) {
  return (
    <div className="flex items-baseline">
      <span style={{ display: 'inline-block', width: '32mm' }}>{label}</span>
      <span>: {waarde}</span>
    </div>
  )
}

/** Debiteur-logo uit Supabase storage; fallback naar Karpi-default logo, daarna naar klantnaam-text. */
function KlantLogo({ debiteurNr, klantNaam }: { debiteurNr: number; klantNaam: string }) {
  const [primaryFailed, setPrimaryFailed] = useState(false)
  const [fallbackFailed, setFallbackFailed] = useState(false)

  if (!SUPABASE_URL) {
    return (
      <span className="text-2xl font-bold uppercase tracking-tight">
        {klantNaam}
      </span>
    )
  }

  const debiteurLogo = `${SUPABASE_URL}/storage/v1/object/public/logos/${debiteurNr}.jpg`
  const karpiDefault = `${SUPABASE_URL}/storage/v1/object/public/logos/default.jpg`

  if (!primaryFailed) {
    return (
      <img
        src={debiteurLogo}
        alt={klantNaam}
        className="object-contain"
        style={{ maxHeight: '28mm', maxWidth: '100mm' }}
        onError={() => setPrimaryFailed(true)}
      />
    )
  }

  if (!fallbackFailed) {
    return (
      <img
        src={karpiDefault}
        alt="Karpi"
        className="object-contain"
        style={{ maxHeight: '28mm', maxWidth: '100mm' }}
        onError={() => setFallbackFailed(true)}
      />
    )
  }

  return (
    <span className="text-2xl font-bold uppercase tracking-tight">
      {klantNaam}
    </span>
  )
}
