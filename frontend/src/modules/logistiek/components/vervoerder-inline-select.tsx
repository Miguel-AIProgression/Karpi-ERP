import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, ExternalLink, Loader2, Sparkles, Truck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useVervoerderKeuzeVoorOrder, useSetOrderVervoerderOverride } from '../hooks/use-vervoerder-keuze'
import { useVervoerders } from '../hooks/use-vervoerders'
import { getVervoerderDef, type VervoerderBadgeKleur } from '../registry'
import { useAuth } from '@/hooks/use-auth'

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
  /** Toon "Afhalen"-pill in plaats van selector als de order op afhalen staat. */
  afhalen?: boolean
  /**
   * Order-ID waarvoor de bulk-override wordt ingesteld.
   * Schrijft naar alle order_regels via set_orderregel_vervoerder_override_voor_order
   * (mig 227, ADR-0008). Zonder orderId is de selector uitgeschakeld.
   */
  orderId?: number
}

/**
 * Pill-vormige vervoerder-selector voor de pick & ship-pagina.
 *
 * Effectieve-vervoerder volgorde (per-orderregel, ADR-0008):
 *   1. Override — handmatige override op order_regels.vervoerder_code
 *   2. Regel-evaluator — verzendregel-evaluator (vervoerder_selectie_regels)
 *   3. Geen — geen matchende regel gevonden
 *
 * Klikken op de pill opent een dropdown waarmee de operator een bulk-override
 * instelt op alle regels van de order. NULL = override wissen (terug naar regels).
 *
 * Inline foutbanner bij geblokkeerde regels (al in open zending) of RPC-fouten.
 * Auto-hide na 5 seconden.
 */
export function VervoerderInlineSelect({ afhalen, orderId }: VervoerderInlineSelectProps) {
  const [open, setOpen] = useState(false)
  const [foutmelding, setFoutmelding] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Externe vertegenwoordiger (mig 489): read-only — pill toont de waarde maar
  // opent geen override-dropdown.
  const { isExternRep } = useAuth()
  const { data: vervoerders = [] } = useVervoerders()
  const { aggregaat } = useVervoerderKeuzeVoorOrder(orderId ?? null)
  const setOrderOverride = useSetOrderVervoerderOverride()

  // Auto-hide foutmelding na 5s
  useEffect(() => {
    if (!foutmelding) return
    const t = setTimeout(() => setFoutmelding(null), 5000)
    return () => clearTimeout(t)
  }, [foutmelding])

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

  // Pill-weergave bepalen op basis van aggregaat
  function renderPill() {
    if (aggregaat.soort === 'leeg') {
      return <span className="text-slate-300 text-xs">—</span>
    }
    if (aggregaat.soort === 'mix') {
      const mixLabel = 'Mix · ' + aggregaat.codes.filter((c) => c).join('+')
      if (isExternRep) {
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-purple-100 text-purple-700">
            <Truck size={12} />
            {mixLabel}
          </span>
        )
      }
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          disabled={setOrderOverride.isPending || !orderId}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors bg-purple-100 text-purple-700 hover:bg-purple-200 disabled:opacity-50"
          title="Mix van vervoerders op de regels — klik om een bulk-override in te stellen"
        >
          {setOrderOverride.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Truck size={12} />
          )}
          {mixLabel}
          <ChevronDown size={12} className="opacity-70" />
        </button>
      )
    }
    // uniform
    if (aggregaat.code === null) {
      if (isExternRep) {
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-700">
            <AlertTriangle size={12} />
            Geen regel
          </span>
        )
      }
      return (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setOpen((v) => !v)
          }}
          disabled={setOrderOverride.isPending || !orderId}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors bg-amber-100 text-amber-700 hover:bg-amber-200 disabled:opacity-50"
          title="Geen verzendregel matcht — voeg een regel toe via /verzendregels"
        >
          {setOrderOverride.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <AlertTriangle size={12} />
          )}
          Geen regel
          <ChevronDown size={12} className="opacity-70" />
        </button>
      )
    }
    const def = getVervoerderDef(aggregaat.code)
    const labelKleur: VervoerderBadgeKleur = def?.badgeKleur ?? 'grijs'
    const labelText = def?.displayNaam ?? aggregaat.code
    if (isExternRep) {
      return (
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${KLEUR_STYLES[labelKleur]}`}
          title={
            aggregaat.bron === 'regel'
              ? `Regel-keuze: ${labelText}`
              : `Bulk-override: ${labelText}`
          }
        >
          {aggregaat.bron === 'regel' ? <Sparkles size={12} /> : <Truck size={12} />}
          {labelText}
        </span>
      )
    }
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        disabled={setOrderOverride.isPending || !orderId}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${KLEUR_STYLES[labelKleur]} disabled:opacity-50`}
        title={
          aggregaat.bron === 'regel'
            ? `Regel-keuze: ${labelText}`
            : `Bulk-override: ${labelText}`
        }
      >
        {setOrderOverride.isPending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : aggregaat.bron === 'regel' ? (
          <Sparkles size={12} />
        ) : (
          <Truck size={12} />
        )}
        {labelText}
        <ChevronDown size={12} className="opacity-70" />
      </button>
    )
  }

  function handleKies(code: string | null) {
    if (!orderId) return
    setOpen(false)
    setOrderOverride.mutate(
      { orderId, vervoerderCode: code },
      {
        onSuccess: (data) => {
          const geblokkeerd = data.filter((r) => r.resultaat === 'geblokkeerd_door_zending')
          if (geblokkeerd.length > 0) {
            setFoutmelding(
              `${geblokkeerd.length} regel${geblokkeerd.length === 1 ? '' : 's'} kon${geblokkeerd.length === 1 ? '' : 'den'} niet — staat al in open zending`,
            )
          }
        },
        onError: (err) => {
          setFoutmelding(err instanceof Error ? err.message : 'Vervoerder instellen mislukt')
        },
      },
    )
  }

  return (
    <div className="relative inline-block" ref={wrapperRef}>
      {renderPill()}

      {foutmelding && (
        <div
          role="alert"
          className="absolute top-full mt-1 right-0 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 max-w-xs whitespace-normal z-30"
        >
          {foutmelding}
        </div>
      )}

      {open && !isExternRep && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 mt-1 w-64 rounded-[var(--radius-sm)] border border-slate-200 bg-white shadow-lg z-20 py-1 text-xs"
        >
          {aggregaat.soort === 'uniform' && aggregaat.code === null && (
            <div className="px-3 py-2 bg-amber-50/60 border-b border-slate-100 text-[11px] text-amber-700 flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              <span>
                Geen verzendregel matcht deze order —{' '}
                <Link
                  to="/verzendregels"
                  className="underline hover:text-amber-900 inline-flex items-center gap-0.5"
                  onClick={() => setOpen(false)}
                >
                  voeg er een toe <ExternalLink size={10} />
                </Link>
              </span>
            </div>
          )}

          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400">
            Bulk-override op alle regels
          </div>
          {vervoerders.map((v) => {
            const vDef = getVervoerderDef(v.code)
            return (
              <button
                key={v.code}
                onClick={() => handleKies(v.code)}
                disabled={!v.actief}
                className="w-full text-left px-3 py-1.5 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
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
            className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2"
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-300" />
            <span className="flex-1 text-slate-500">Override wissen (terug naar regels)</span>
          </button>
        </div>
      )}
    </div>
  )
}
