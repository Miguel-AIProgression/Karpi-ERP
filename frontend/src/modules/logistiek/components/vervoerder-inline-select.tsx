import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, Sparkles, Truck } from 'lucide-react'
import {
  useKlantVervoerderConfig,
  useUpsertKlantVervoerderConfig,
  useVervoerders,
} from '../hooks/use-vervoerder-config'
import { useActieveVervoerder } from '../hooks/use-vervoerders'
import { useVervoerderPreview } from '../hooks/use-verzendregels'
import { getVervoerderDef, type VervoerderBadgeKleur } from '../registry'

const KLEUR_STYLES: Record<VervoerderBadgeKleur, string> = {
  blauw: 'bg-blue-100 text-blue-700 hover:bg-blue-200',
  oranje: 'bg-orange-100 text-orange-700 hover:bg-orange-200',
  paars: 'bg-purple-100 text-purple-700 hover:bg-purple-200',
  grijs: 'bg-slate-100 text-slate-500 hover:bg-slate-200',
}

// Statisch (zodat Tailwind ze meeneemt in de bundle) — wordt gebruikt voor de
// kleurpunt links naast vervoerder-naam in de dropdown.
const DOT_STYLES: Record<VervoerderBadgeKleur, string> = {
  blauw: 'bg-blue-500',
  oranje: 'bg-orange-500',
  paars: 'bg-purple-500',
  grijs: 'bg-slate-400',
}

interface VervoerderInlineSelectProps {
  debiteurNr: number
  /** Toon "Afhalen"-pill in plaats van selector als de order op afhalen staat. */
  afhalen?: boolean
  /**
   * Optioneel: als gezet wordt naast de klant-default ook de lopende zending
   * van deze order bijgewerkt, zodat de verzendset-sticker meteen de nieuwe
   * vervoerder toont. Zonder `orderId` werkt de selector alleen als
   * klant-default voor toekomstige zendingen.
   *
   * Sinds mig 215: met `orderId` wordt ook `preview_vervoerder_voor_order`
   * geraadpleegd zodat de pill toont welke vervoerder de regels zouden kiezen
   * — zonder zending te hoeven aanmaken.
   */
  orderId?: number
}

/**
 * Pill-vormige vervoerder-selector voor de pick & ship-pagina.
 *
 * Effectieve-vervoerder volgorde (hoogste wint):
 *   1. Regel-evaluator preview — wat de regels zouden kiezen voor deze order
 *   2. Klant-fallback           — vaste keuze voor wanneer geen regel matcht
 *   3. Globaal-actief fallback — als er precies 1 vervoerder actief is
 *
 * Wijzigingen via de dropdown gaan naar `klant_vervoerder_config`. Met de
 * nieuwe prio is dat een **fallback** (in plaats van een harde override):
 * hij wordt alleen gebruikt als geen regel matcht voor deze order. Wanneer
 * `orderId` is meegegeven wordt bovendien de lopende zending van die order
 * bijgewerkt zodat de sticker meebeweegt.
 */
export function VervoerderInlineSelect({
  debiteurNr,
  afhalen,
  orderId,
}: VervoerderInlineSelectProps) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const { data: vervoerders = [] } = useVervoerders()
  const { data: klantConfig } = useKlantVervoerderConfig(debiteurNr)
  const { data: preview } = useVervoerderPreview(orderId)
  const upsert = useUpsertKlantVervoerderConfig()
  const actief = useActieveVervoerder()

  const klantCode = klantConfig?.vervoerder_code ?? null
  const previewCode = preview?.gekozen_vervoerder_code ?? null
  const isExplicitleeg = klantConfig !== undefined && klantConfig !== null && klantCode === null

  // Effectieve keuze: regel-preview > klant-fallback > globaal-actief.
  // De bron bepaalt label en tooltip — een regel-keuze toont een sparkles-icoon
  // zodat de gebruiker direct ziet dat dit een automatische match is. De klant-
  // fallback is alleen zichtbaar wanneer geen regel matcht.
  const bron: 'regel' | 'klant' | 'actief' | 'geen' =
    previewCode ? 'regel' : klantCode ? 'klant' : actief.code ? 'actief' : 'geen'
  const effectiveCode =
    bron === 'regel' ? previewCode : bron === 'klant' ? klantCode : bron === 'actief' ? actief.code : null
  const def = getVervoerderDef(effectiveCode)

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const tooltip = useMemo(() => {
    if (bron === 'regel' && preview) {
      const u = preview.keuze_uitleg ?? {}
      const parts: string[] = [`Regel-keuze: ${def?.displayNaam ?? previewCode}`]
      if (u.match_prio != null) parts.push(`prio ${u.match_prio}`)
      if (preview.gekozen_service_code) parts.push(`service ${preview.gekozen_service_code}`)
      if (u.match_notitie) parts.push(`— ${u.match_notitie}`)
      return parts.join(' · ')
    }
    if (bron === 'klant') {
      return `Klant-fallback (geen regel matcht): ${def?.displayNaam ?? klantCode}`
    }
    if (bron === 'actief') {
      return `Globaal actieve vervoerder: ${def?.displayNaam}`
    }
    if (isExplicitleeg) return 'Handmatig — kies een vervoerder per zending'
    if (preview?.keuze_uitleg?.reden === 'geen_matchende_regel') {
      return 'Geen regel matcht deze order — kies handmatig of voeg een regel toe'
    }
    return 'Klik om een vervoerder te kiezen'
  }, [bron, def, klantCode, previewCode, preview, isExplicitleeg])

  if (afhalen) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-800">
        <Truck size={12} />
        Afhalen
      </span>
    )
  }

  const labelKleur: VervoerderBadgeKleur = def?.badgeKleur ?? 'grijs'
  const labelText = def
    ? def.displayNaam
    : isExplicitleeg
      ? 'Handmatig'
      : actief.selectie_status === 'meerdere_actieve_vervoerders'
        ? 'Kies'
        : 'Geen'

  function handleKies(code: string | null) {
    upsert.mutate(
      { debiteur_nr: debiteurNr, vervoerder_code: code, order_id: orderId },
      { onSuccess: () => setOpen(false) }
    )
  }

  return (
    <div className="relative inline-block" ref={wrapperRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        disabled={upsert.isPending}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${KLEUR_STYLES[labelKleur]} disabled:opacity-50`}
        title={tooltip}
      >
        {upsert.isPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : bron === 'regel' ? (
          <Sparkles size={12} />
        ) : (
          <Truck size={12} />
        )}
        {labelText}
        <ChevronDown size={12} className="opacity-70" />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 mt-1 w-64 rounded-[var(--radius-sm)] border border-slate-200 bg-white shadow-lg z-20 py-1 text-xs"
        >
          {bron === 'regel' && preview && (
            <div className="px-3 py-2 bg-purple-50/60 border-b border-slate-100">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-purple-700 font-semibold">
                <Sparkles size={10} /> Regel-keuze
              </div>
              <div className="text-slate-700 mt-0.5">
                {def?.displayNaam ?? previewCode}
                {preview.gekozen_service_code && (
                  <span className="text-slate-500"> ({preview.gekozen_service_code})</span>
                )}
              </div>
              {preview.keuze_uitleg?.match_notitie && (
                <div className="text-[11px] text-slate-500 italic mt-0.5">
                  {preview.keuze_uitleg.match_notitie}
                </div>
              )}
            </div>
          )}

          {bron !== 'regel' && preview?.keuze_uitleg?.reden === 'geen_matchende_regel' && (
            <div className="px-3 py-2 bg-amber-50/60 border-b border-slate-100 text-[11px] text-amber-700">
              Geen verzendregel matcht deze order — voeg er een toe op de
              vervoerderpagina, of kies hieronder een klant-fallback.
            </div>
          )}

          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400">
            Klant-fallback (gebruikt bij geen regel-match)
          </div>
          {vervoerders.map((v) => {
            const isHuidig = klantCode === v.code
            const vDef = getVervoerderDef(v.code)
            return (
              <button
                key={v.code}
                onClick={() => handleKies(v.code)}
                disabled={!v.actief}
                className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 ${
                  isHuidig ? 'bg-slate-50 font-medium' : ''
                }`}
              >
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    vDef ? DOT_STYLES[vDef.badgeKleur] : DOT_STYLES.grijs
                  }`}
                />
                <span className="flex-1">{v.display_naam}</span>
                {!v.actief && <span className="text-[10px] text-slate-400">inactief</span>}
              </button>
            )
          })}
          <div className="border-t border-slate-100 my-1" />
          <button
            onClick={() => handleKies(null)}
            className={`w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2 ${
              isExplicitleeg ? 'bg-slate-50 font-medium' : ''
            }`}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300" />
            <span className="flex-1 text-slate-500">Geen voorkeur (regels gebruiken)</span>
          </button>
        </div>
      )}
    </div>
  )
}
