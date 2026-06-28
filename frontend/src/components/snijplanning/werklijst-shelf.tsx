import { cn } from '@/lib/utils/cn'
import type { WerklijstShelf, WerklijstShelfStuk } from '@/modules/snijplanning/lib/werklijst-groepering'

// Kleur-palette per stuk-index binnen een shelf (onderscheidt naast-elkaar-stukken visueel)
const STUK_KLEUREN = [
  { bg: 'bg-indigo-100', border: 'border-indigo-300', text: 'text-indigo-700' },
  { bg: 'bg-blue-100', border: 'border-blue-300', text: 'text-blue-700' },
  { bg: 'bg-cyan-100', border: 'border-cyan-300', text: 'text-cyan-700' },
  { bg: 'bg-teal-100', border: 'border-teal-300', text: 'text-teal-700' },
  { bg: 'bg-violet-100', border: 'border-violet-300', text: 'text-violet-700' },
  { bg: 'bg-emerald-100', border: 'border-emerald-300', text: 'text-emerald-700' },
]

interface StukProps {
  stuk: WerklijstShelfStuk
  rolBreedteCm: number
  index: number
}

function ShelfStukBlok({ stuk, rolBreedteCm, index }: StukProps) {
  const pct = (stuk.geplaatsteBreedteCm / rolBreedteCm) * 100
  const kleur = STUK_KLEUREN[index % STUK_KLEUREN.length]
  const maatLabel =
    stuk.maatwerk_lengte_cm && stuk.maatwerk_breedte_cm
      ? `${stuk.maatwerk_lengte_cm}×${stuk.maatwerk_breedte_cm}`
      : ''
  const margeLabel = stuk.margeCm > 0 ? ` +${stuk.margeCm}cm` : ''

  return (
    <div
      className={cn(
        'flex flex-col justify-center px-1.5 overflow-hidden shrink-0 border',
        kleur.bg,
        kleur.border,
        kleur.text,
      )}
      style={{ width: `${pct}%` }}
      title={`${stuk.klantNaam} — ${maatLabel}cm${margeLabel} marge`}
    >
      <div className="text-[10px] font-medium truncate leading-tight">{stuk.klantNaam}</div>
      {maatLabel && (
        <div className="text-[9px] opacity-70 truncate leading-tight">{maatLabel}</div>
      )}
    </div>
  )
}

interface Props {
  shelf: WerklijstShelf
  rolBreedteCm: number
}

export function WerklijstShelfVisualisatie({ shelf, rolBreedteCm }: Props) {
  const restBreedte = Math.max(0, rolBreedteCm - shelf.gebruikteBreedteCm)
  const restPct = (restBreedte / rolBreedteCm) * 100
  const positieLabel = `${shelf.positieYCm}–${shelf.eindYCm}cm`

  return (
    <div className="flex items-stretch gap-2">
      {/* Y-positie label */}
      <div className="text-[10px] text-slate-400 tabular-nums w-[90px] shrink-0 flex items-center">
        {positieLabel}
      </div>
      {/* Visuele balk */}
      <div className="flex-1 flex h-8 rounded overflow-hidden border border-slate-200">
        {shelf.stukken.map((stuk, i) => (
          <ShelfStukBlok key={stuk.snijplanId} stuk={stuk} rolBreedteCm={rolBreedteCm} index={i} />
        ))}
        {restPct > 0.5 && (
          <div
            className="flex items-center justify-center text-[9px] text-slate-300 border-l border-slate-200 bg-slate-50"
            style={{ width: `${restPct}%` }}
          >
            {restBreedte >= 10 ? `${Math.round(restBreedte)}` : ''}
          </div>
        )}
      </div>
      {/* Restlengte */}
      <div className="text-[10px] text-slate-400 tabular-nums w-[52px] shrink-0 flex items-center justify-end">
        {Math.round(restBreedte)}cm
      </div>
    </div>
  )
}
