import { useState } from 'react'
import { Ean13Barcode } from '@/components/ui/ean13-barcode'
import { formatVerzendweekShort, type StickerData } from '@/modules/snijplanning'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL

/**
 * Klant-facing maatwerk-sticker (mig 295 + 300, 148×106 mm landschap).
 *
 * Komt op het opgerolde maatwerk-tapijt vlak vóór verzending. Bevat
 * alleen wat de eindafnemer ziet: debiteur-logo + 4 product-velden +
 * EAN-13 + verzendweek-batch-code. Geen QR, scancode, klantnaam, vorm of
 * afwerking — die operator-info loopt via de werkbon/scanstation-scherm.
 *
 * **Layout: vaste mm-posities via `position: absolute`.** Alle blokken zijn
 * gepind aan de sticker-randen (8mm marges), zodat een ongewoon groot of
 * klein debiteur-logo de overige elementen NIET verschuift. Logo-zone heeft
 * `overflow: hidden` als safety net — een logo dat zijn `max-height` over-
 * schrijdt wordt geclipped i.p.v. omliggende velden weg te duwen.
 *
 *   ┌─ 148mm ───────────────────────────────┐
 *   │        [debiteur-logo, 20mm]          │
 *   │  Kwaliteit    : LORANDA   [EAN-13]    │
 *   │  Poolmateriaal: 100% PP               │
 *   │  Kleur        : 13           : 2620   │
 *   │  Afmeting     : ca. 310 x 225 cm.     │
 *   │                                       │
 *   │              (witruimte)              │
 *   └───────────────────────────────────────┘
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
  const verzendweek = formatVerzendweekShort(sticker.verzendweek_iso)
  return (
    <div
      className="sticker-label bg-white box-border"
      style={{
        position: 'relative',
        width: '148mm',
        height: '106mm',
        fontFamily: "'Helvetica Neue', Arial, sans-serif",
        color: '#111',
        overflow: 'hidden',
      }}
    >
      {/* Logo-zone — fixed top center, 20mm hoog. overflow:hidden + max-height op
          de img garanderen dat een onverwacht groot logo de velden eronder
          niet wegduwt. Compacte hoogte matched Room108/lifestyle-proportie. */}
      <div
        style={{
          position: 'absolute',
          top: '5mm',
          left: 0,
          right: 0,
          height: '20mm',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <KlantLogo debiteurNr={sticker.debiteur_nr} klantNaam={sticker.klant_naam} />
      </div>

      {/* Productvelden links — vaste positie 30mm vanaf boven, 8mm van links.
          Row-gap 1mm + 11pt regelhoogte geeft ~6mm row pitch (Kwaliteit ~33mm,
          Poolmateriaal ~39mm, Kleur ~45mm baselines). Poolmateriaal-regel
          verschijnt altijd; waarde blijft leeg als kwaliteiten.poolmateriaal
          NULL is. */}
      <div
        style={{
          position: 'absolute',
          top: '30mm',
          left: '8mm',
          display: 'flex',
          flexDirection: 'column',
          gap: '1mm',
          fontSize: '11pt',
        }}
      >
        <Veld label="Kwaliteit"     waarde={sticker.kwaliteit_naam} />
        <Veld label="Poolmateriaal" waarde={sticker.poolmateriaal ?? ''} />
        <Veld label="Kleur"         waarde={sticker.kleur_code} />
      </div>

      {/* EAN-13 rechts — 38mm x 12mm, top:30mm zodat hij naast Kwaliteit/
          Poolmateriaal-rijen valt en eindigt rond Kleur-baseline (~42mm).
          Matched de proportie van Room108/lifestyle-stickers. */}
      <div
        style={{
          position: 'absolute',
          top: '30mm',
          right: '8mm',
          width: '38mm',
        }}
      >
        {sticker.ean_code ? (
          <Ean13Barcode
            value={sticker.ean_code}
            height={40}
            className="block"
            style={{ width: '38mm', height: '12mm' }}
          />
        ) : (
          <div className="text-[8pt] text-slate-400 text-right">geen EAN</div>
        )}
      </div>

      {/* Verzendweek — op de Kleur-rij rechts (~42mm), ':' prefix matched het
          oude sticker-formaat. Weggelaten bij orders zonder afleverdatum. */}
      {verzendweek && (
        <div
          style={{
            position: 'absolute',
            top: '42mm',
            right: '8mm',
            fontSize: '11pt',
          }}
        >
          : {verzendweek}
        </div>
      )}

      {/* Afmeting links — ~8mm onder Kleur-baseline op 50mm. Onderkant van de
          sticker blijft bewust witruimte zoals in de Room108/lifestyle-stickers. */}
      <div
        style={{
          position: 'absolute',
          top: '50mm',
          left: '8mm',
          fontSize: '11pt',
        }}
      >
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
      <span style={{ display: 'inline-block', width: '26mm' }}>{label}</span>
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
        style={{ maxHeight: '20mm', maxWidth: '90mm' }}
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
        style={{ maxHeight: '20mm', maxWidth: '90mm' }}
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
