import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Loader2, Truck } from 'lucide-react'
import {
  useKlantVervoerderConfig,
  useUpsertKlantVervoerderConfig,
  useVervoerders,
} from '../hooks/use-vervoerder-config'
import { useActieveVervoerder } from '../hooks/use-vervoerders'
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
   */
  orderId?: number
}

/**
 * Pill-vormige vervoerder-selector voor de pick & ship-pagina. Toont de
 * effectieve vervoerder (per-klant config > globaal actief) en laat de
 * gebruiker per klant wisselen via klant_vervoerder_config (= zelfde tabel als
 * klant-detail). Wanneer `orderId` is meegegeven (zoals op pick & ship) wordt
 * de gekozen vervoerder ook overschreven op de lopende zending van die order
 * (status `Gepland`/`Picken`/`Ingepakt`/`Klaar voor verzending`), zodat de
 * sticker meebeweegt met de keuze. Reeds verzonden zendingen blijven
 * ongewijzigd voor het audit-spoor.
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
  const upsert = useUpsertKlantVervoerderConfig()
  const actief = useActieveVervoerder()

  // Effectieve code: klant-config wint, anders globaal actieve vervoerder.
  const klantCode = klantConfig?.vervoerder_code ?? null
  const effectiveCode = klantCode ?? actief.code
  const def = getVervoerderDef(effectiveCode)
  const isExplicitleeg = klantConfig !== undefined && klantConfig !== null && klantCode === null

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

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
        title={
          klantCode
            ? `Vaste vervoerder voor deze klant: ${def?.displayNaam ?? klantCode}`
            : def
              ? `Globaal actieve vervoerder: ${def.displayNaam}`
              : 'Klik om een vervoerder te kiezen'
        }
      >
        {upsert.isPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Truck size={12} />
        )}
        {labelText}
        <ChevronDown size={12} className="opacity-70" />
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 mt-1 w-48 rounded-[var(--radius-sm)] border border-slate-200 bg-white shadow-lg z-20 py-1 text-xs"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400">
            Vervoerder voor klant
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
            <span className="flex-1 text-slate-500">Geen voorkeur (handmatig)</span>
          </button>
        </div>
      )}
    </div>
  )
}
