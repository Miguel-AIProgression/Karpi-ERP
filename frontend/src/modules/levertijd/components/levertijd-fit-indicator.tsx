// Inline fit-indicator voor order-form (ADR-0020 stap 6).
//
// Toont de geaggregeerde fit-status over alle meegegeven regels t.o.v. de
// `gewensteWeek` (ISO 'YYYY-Www', afgeleid uit `orders.afleverdatum`). Pure
// presentatie: geen side-effects, geen mutaties, geen form-validation-block
// (per grilling-beslissing 1a — operator beslist zelf, indicator waarschuwt
// alleen visueel).
//
// Hookt op `useFitCheck(regelIds, gewensteWeek)` uit `@/modules/levertijd`,
// die intern 300ms debounce + 30s staleTime + cache-key normalisatie regelt.
//
// Render-regels:
//   - regelIds leeg, of gewensteWeek leeg → niets renderen (er valt niets te
//     controleren). Voorkomt valse-positieve "alles ok"-melding bij lege form.
//   - loading → discrete spinner-stip ("· · ·") in slate-zonder-randje.
//   - alle haalbaar → groen vinkje + "Levertijd haalbaar".
//   - ≥1 niet haalbaar → oranje waarschuwing + "Niet haalbaar — eerstvolgende:
//     wk {N}" op basis van de eerste niet-haalbare regel met een
//     `eerstvolgend_haalbaar`-suggestie.

import { Check, AlertTriangle } from 'lucide-react'
import { useFitCheck } from '../hooks/use-fit-check'
import { cn } from '@/lib/utils/cn'

interface Props {
  /** Alle regels van de huidige order waarvoor fit gecheckt moet worden. */
  regelIds: number[]
  /** ISO-week 'YYYY-Www' afgeleid uit afleverdatum. Leeg = niets renderen. */
  gewensteWeek: string
}

/** Pak het week-getal uit 'YYYY-Www' voor compact UI-label. */
function weekNummer(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = iso.match(/^\d{4}-W(\d{1,2})$/)
  return m ? m[1].replace(/^0+/, '') || '0' : null
}

export function LevertijdFitIndicator({ regelIds, gewensteWeek }: Props) {
  const enabled = regelIds.length > 0 && !!gewensteWeek
  const { data, isLoading, isFetching, error } = useFitCheck(
    regelIds,
    enabled ? gewensteWeek : null,
  )

  if (!enabled) return null

  if (isLoading || isFetching) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)]',
          'text-xs text-slate-400',
        )}
        aria-live="polite"
      >
        <span className="inline-flex gap-0.5">
          <span className="w-1 h-1 rounded-full bg-slate-300 animate-pulse" />
          <span className="w-1 h-1 rounded-full bg-slate-300 animate-pulse [animation-delay:120ms]" />
          <span className="w-1 h-1 rounded-full bg-slate-300 animate-pulse [animation-delay:240ms]" />
        </span>
        <span>Levertijd controleren…</span>
      </div>
    )
  }

  if (error || !data) {
    // Defensief: bij RPC-fout niets blokkeren — operator ziet wel de fout in
    // de console. Geen rode banner; Levertijd-Module is een hint, geen poort.
    return null
  }

  const nietHaalbaar = data.filter((r) => !r.haalbaar)

  if (nietHaalbaar.length === 0) {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)]',
          'text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200',
        )}
        aria-live="polite"
      >
        <Check size={14} aria-hidden />
        <span>Levertijd haalbaar</span>
      </div>
    )
  }

  // Eerste niet-haalbare regel met een suggestie bepaalt het label.
  const eerste =
    nietHaalbaar.find((r) => r.eerstvolgend_haalbaar) ?? nietHaalbaar[0]
  const weekLabel = weekNummer(eerste.eerstvolgend_haalbaar)
  const suffix = weekLabel
    ? ` — eerstvolgende: wk ${weekLabel}`
    : eerste.reden
      ? ` — ${eerste.reden}`
      : ''

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-sm)]',
        'text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200',
      )}
      title={
        nietHaalbaar.length > 1
          ? `${nietHaalbaar.length} regels niet haalbaar in week ${weekNummer(gewensteWeek) ?? gewensteWeek}`
          : undefined
      }
      aria-live="polite"
    >
      <AlertTriangle size={14} aria-hidden />
      <span>Niet haalbaar{suffix}</span>
    </div>
  )
}
