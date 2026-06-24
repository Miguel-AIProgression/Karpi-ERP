import { ArrowRightLeft, Clock, Package } from 'lucide-react'
import { useAllocatieOpties } from '../hooks/use-reserveringen'
import type { AllocatieOptie } from '../queries/allocatie-opties'
import type { AllocatieKeuze } from '@/lib/supabase/queries/order-mutations'
import { isoWeek } from '@/lib/orders/verzendweek'

interface Props {
  artikelnr: string
  /** Aantal nog tekort als er niets gekozen wordt. */
  tekortAantal: number
  /** Huidige keuzes (uitwisselbaar-voorraad én/of inkoop-claims) + aantallen. */
  keuzes: AllocatieKeuze[]
  /** Callback bij wijziging van een keuze (lege/0 wordt eruit gefilterd). */
  onChange: (keuzes: AllocatieKeuze[]) => void
}

function optieKey(o: { bron?: string; artikelnr: string; inkooporder_regel_id?: number | null }): string {
  return `${o.bron ?? 'voorraad'}:${o.artikelnr}:${o.inkooporder_regel_id ?? ''}`
}

function weekLabel(datumIso: string): string {
  const w = isoWeek(new Date(datumIso + 'T00:00:00'))
  return `wk ${w.week} · ${w.jaar}`
}

/** Sorteert op levertijd: direct leverbaar (voorraad) eerst, dan op ETA — een
 *  IO-optie zonder bekende ETA komt achteraan (onbekend is niet "het snelst"). */
function levertijdSortKey(o: AllocatieOptie): number {
  if (o.bron === 'voorraad') return -1
  return o.verwacht_datum ? new Date(o.verwacht_datum).getTime() : Number.POSITIVE_INFINITY
}

const GROEP_LABEL: Record<'voorraad' | 'eigen_inkoop' | 'equivalent_inkoop', string> = {
  voorraad: 'Equivalent — nu op voorraad',
  eigen_inkoop: 'Eigen artikel — wacht op inkoop',
  equivalent_inkoop: 'Equivalent — wacht op zijn inkoop',
}

function groepVan(o: AllocatieOptie): 'voorraad' | 'eigen_inkoop' | 'equivalent_inkoop' {
  if (o.bron === 'voorraad') return 'voorraad'
  return o.artikelnr === o.eigen_artikelnr ? 'eigen_inkoop' : 'equivalent_inkoop'
}

/**
 * Toont bij een voorraadtekort op een vaste-maat-regel drie soorten kiesbare
 * opties — gesorteerd op levertijd — i.p.v. de allocator stilletjes te laten
 * substitueren (uitbreiding van de bestaande omsticker-knop, geen automatisch
 * gedrag meer sinds mig 496). De gebruiker kiest expliciet hoeveel stuks van
 * welke optie deze regel mag dekken; bij submit roept order-form
 * `set_allocatie_keuze` aan om de claims te persisteren (Plek A). Op
 * order-detail (Plek B) gebeurt het direct via dezelfde RPC, met een eigen
 * "Bevestigen"/"Ontgrendelen"-knop (`UitwisselbaarToepassenRij`).
 *
 * Geen auto-fill: de gebruiker moet zelf klikken, nooit een stille keuze.
 */
export function UitwisselbaarTekortHint({ artikelnr, tekortAantal, keuzes, onChange }: Props) {
  const { data: opties, isLoading } = useAllocatieOpties(artikelnr)

  if (isLoading || !opties) return null
  if (opties.length === 0 && keuzes.length === 0) return null
  if (tekortAantal <= 0 && keuzes.length === 0) return null

  const gesorteerd = [...opties].sort((a, b) => levertijdSortKey(a) - levertijdSortKey(b))
  const totaalGekozen = keuzes.reduce((s, k) => s + (k.aantal || 0), 0)

  function huidigeAantal(o: AllocatieOptie): number {
    return keuzes.find(k => optieKey(k) === optieKey(o))?.aantal ?? 0
  }

  function setAantalVoor(o: AllocatieOptie, aantal: number) {
    const filtered = keuzes.filter(k => optieKey(k) !== optieKey(o))
    if (aantal > 0) {
      filtered.push({
        bron: o.bron,
        artikelnr: o.artikelnr,
        aantal,
        omschrijving: o.omschrijving,
        inkooporder_regel_id: o.inkooporder_regel_id,
        verwacht_datum: o.verwacht_datum,
      })
    }
    onChange(filtered)
  }

  return (
    <div className="mt-1 p-2 bg-amber-50 border border-amber-200 rounded text-xs">
      <div className="flex items-center gap-1.5 text-amber-700 mb-1.5">
        <ArrowRightLeft size={12} />
        <span>
          {tekortAantal > 0 ? (
            <>
              <strong>{tekortAantal}× tekort</strong> — kies hoeveel stuks via welke optie (op basis van levertijd):
            </>
          ) : (
            <>Gekozen: {totaalGekozen}× — pas hieronder aan:</>
          )}
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {gesorteerd.map(o => {
          const huidig = huidigeAantal(o)
          const max = Math.min(o.vrij_aantal, huidig + Math.max(0, tekortAantal))
          const groep = groepVan(o)
          return (
            <div
              key={optieKey(o)}
              className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-white border border-amber-100"
            >
              <span className="flex-1 truncate">
                <span className="text-[10px] uppercase tracking-wide text-slate-400 mr-1.5">
                  {GROEP_LABEL[groep]}
                </span>
                <span className="font-mono text-terracotta-500">{o.artikelnr}</span>
                <span className="ml-2 text-slate-700">{o.omschrijving}</span>
                {o.bron === 'voorraad' ? (
                  <span className="ml-2 text-emerald-600">
                    <Package size={10} className="inline mr-0.5" />
                    Vrij: {o.vrij_aantal}
                  </span>
                ) : (
                  <span className="ml-2 text-amber-700">
                    <Clock size={10} className="inline mr-0.5" />
                    {o.verwacht_datum ? weekLabel(o.verwacht_datum) : 'leverweek onbekend'} ({o.vrij_aantal} vrij)
                  </span>
                )}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setAantalVoor(o, Math.max(0, huidig - 1))}
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
                    const n = Math.max(0, Math.min(o.vrij_aantal, parseInt(e.target.value) || 0))
                    setAantalVoor(o, n)
                  }}
                  className="w-12 text-center bg-white border border-slate-200 rounded px-1 py-0.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => setAantalVoor(o, Math.min(max, huidig + 1))}
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
