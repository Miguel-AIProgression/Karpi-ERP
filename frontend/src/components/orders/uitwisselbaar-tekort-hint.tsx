import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRightLeft, Package } from 'lucide-react'
import {
  fetchEquivalenteProducten,
} from '@/lib/supabase/queries/product-equivalents'

export interface UitwisselbaarKeuze {
  artikelnr: string
  aantal: number
  omschrijving?: string
}

interface Props {
  artikelnr: string
  /** Aantal nog tekort als er niets uit uitwisselbaar wordt gepakt. */
  tekortAantal: number
  /** Huidige keuzes van uitwisselbaar producten + aantallen. */
  keuzes: UitwisselbaarKeuze[]
  /** Callback bij wijziging van een keuze (lege/0 wordt eruit gefilterd). */
  onChange: (keuzes: UitwisselbaarKeuze[]) => void
}

/**
 * Toont per uitwisselbaar product met voorraad een +/- aantal-picker.
 * De gebruiker kiest expliciet hoeveel stuks van welk alternatief meegenomen
 * worden — multi-source allocatie binnen één orderregel.
 *
 * Geen DB-allocatie hier: dit is puur form-state. Bij submit roept order-form
 * `set_uitwisselbaar_claims` RPC aan om de claims te persisteren.
 */
export function UitwisselbaarTekortHint({ artikelnr, tekortAantal, keuzes, onChange }: Props) {
  const { data: equivalenten, isLoading } = useQuery({
    queryKey: ['equivalente-producten', artikelnr],
    queryFn: () => fetchEquivalenteProducten(artikelnr),
    enabled: !!artikelnr,
  })

  // Auto-fill: bij eerste data-load + tekort + nog geen keuzes, vul de eerste
  // (beste) uitwisselbare op tot tekort gedekt is. Gebruiker kan daarna +/- aanpassen.
  const autofilledRef = useRef(false)
  useEffect(() => {
    if (autofilledRef.current) return
    if (!equivalenten) return
    if (keuzes.length > 0) {
      autofilledRef.current = true
      return
    }
    if (tekortAantal <= 0) return

    const opVrij = equivalenten.filter(e => e.vrije_voorraad > 0)
    if (opVrij.length === 0) return

    let resterend = tekortAantal
    const auto: { artikelnr: string; aantal: number; omschrijving?: string }[] = []
    for (const eq of opVrij) {
      if (resterend <= 0) break
      const pak = Math.min(eq.vrije_voorraad, resterend)
      if (pak > 0) {
        auto.push({ artikelnr: eq.artikelnr, aantal: pak, omschrijving: eq.omschrijving })
        resterend -= pak
      }
    }
    if (auto.length > 0) {
      autofilledRef.current = true
      onChange(auto)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [equivalenten, tekortAantal])

  if (isLoading || !equivalenten) return null

  const opVoorraad = equivalenten.filter(e => e.vrije_voorraad > 0)
  const totaalGekozen = keuzes.reduce((s, k) => s + (k.aantal || 0), 0)

  // Hint alleen tonen als er tekort is OF als er al keuzes zijn (om ze te kunnen aanpassen)
  if (opVoorraad.length === 0 && keuzes.length === 0) return null
  if (tekortAantal <= 0 && keuzes.length === 0) return null

  function setAantalVoor(eq: { artikelnr: string; omschrijving: string }, aantal: number) {
    const filtered = keuzes.filter(k => k.artikelnr !== eq.artikelnr)
    if (aantal > 0) {
      filtered.push({ artikelnr: eq.artikelnr, aantal, omschrijving: eq.omschrijving })
    }
    onChange(filtered)
  }

  function huidigeAantal(art: string): number {
    return keuzes.find(k => k.artikelnr === art)?.aantal ?? 0
  }

  return (
    <div className="mt-1 p-2 bg-amber-50 border border-amber-200 rounded text-xs">
      <div className="flex items-center gap-1.5 text-amber-700 mb-1.5">
        <ArrowRightLeft size={12} />
        <span>
          {tekortAantal > 0 ? (
            <>
              <strong>{tekortAantal}× tekort</strong> — kies hoeveel stuks via uitwisselbaar product (omstickeren):
            </>
          ) : (
            <>Uitwisselbaar gepakt: {totaalGekozen}× — pas hieronder aan:</>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {opVoorraad.map(eq => {
          const huidig = huidigeAantal(eq.artikelnr)
          // Max = wat al gekozen is + tekort dat nog open staat (max van eigen voorraad)
          const max = Math.min(eq.vrije_voorraad, huidig + Math.max(0, tekortAantal))
          return (
            <div
              key={eq.artikelnr}
              className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white border border-amber-100"
            >
              <span className="flex-1 truncate">
                <span className="font-mono text-terracotta-500">{eq.artikelnr}</span>
                <span className="ml-2 text-slate-700">{eq.omschrijving}</span>
                <span className="ml-2 text-emerald-600">
                  <Package size={10} className="inline mr-0.5" />
                  Vrij: {eq.vrije_voorraad}
                </span>
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setAantalVoor(eq, Math.max(0, huidig - 1))}
                  disabled={huidig === 0}
                  className="w-6 h-6 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                >
                  −
                </button>
                <input
                  type="number"
                  value={huidig}
                  min={0}
                  max={max}
                  onChange={e => {
                    const n = Math.max(0, Math.min(eq.vrije_voorraad, parseInt(e.target.value) || 0))
                    setAantalVoor(eq, n)
                  }}
                  className="w-12 text-center bg-white border border-slate-200 rounded px-1 py-0.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setAantalVoor(eq, Math.min(max, huidig + 1))}
                  disabled={huidig >= max}
                  className="w-6 h-6 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
