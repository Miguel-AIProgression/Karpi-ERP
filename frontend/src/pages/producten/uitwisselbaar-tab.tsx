import { Link2 } from 'lucide-react'
import { useUitwisselbareGroepen } from '@/hooks/use-producten'
import { cn } from '@/lib/utils/cn'

function KleurBadge({ kleur, gedeeld }: { kleur: string; gedeeld: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono',
        gedeeld
          ? 'bg-blue-100 text-blue-700'
          : 'bg-slate-100 text-slate-500',
      )}
    >
      {gedeeld && <Link2 size={10} />}
      {kleur}
    </span>
  )
}

export function UitwisselbaarTab() {
  const { data: groepen, isLoading, isError } = useUitwisselbareGroepen()

  if (isLoading) {
    return <div className="text-slate-400 py-8">Uitwisselbare groepen laden...</div>
  }

  if (isError) {
    return <div className="text-rose-500 py-8">Fout bij laden van uitwisselbare groepen</div>
  }

  if (!groepen || groepen.length === 0) {
    return <div className="text-slate-400 py-8">Geen uitwisselbare groepen gevonden</div>
  }

  const totaalKwaliteiten = groepen.reduce((sum, g) => sum + g.kwaliteiten.length, 0)

  return (
    <div>
      <p className="text-sm text-slate-500 mb-1">
        {groepen.length} groepen &middot; {totaalKwaliteiten} gekoppelde kwaliteiten
      </p>
      <p className="text-xs text-slate-400 mb-6">
        Kleuren met hetzelfde nummer worden automatisch uitwisselbaar
      </p>

      <div className="space-y-4">
        {groepen.map((groep) => {
          const gedeeldSet = new Set(groep.gedeelde_kleuren)
          return (
            <div
              key={groep.collectie_id}
              className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden"
            >
              {/* Group header */}
              <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-100">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Link2 size={14} className="text-blue-500" />
                  <span className="font-medium text-slate-700">{groep.collectie_naam}</span>
                  <span>
                    ({groep.kwaliteiten.length} kwaliteiten &middot;{' '}
                    {groep.gedeelde_kleuren.length} gekoppelde kleuren &middot;{' '}
                    {groep.niet_overeenkomende_kleuren.length} niet-overeenkomend)
                  </span>
                </div>
              </div>

              {/* Kwaliteiten in this group */}
              <div className="divide-y divide-slate-50">
                {groep.kwaliteiten.map((kwal) => (
                  <div key={kwal.code} className="px-5 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-slate-900">
                        {kwal.omschrijving ?? kwal.code}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] font-mono text-slate-600 uppercase">
                        {kwal.code}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {kwal.kleuren.length > 0 ? (
                        kwal.kleuren.map((kleur) => (
                          <KleurBadge
                            key={kleur}
                            kleur={kleur}
                            gedeeld={gedeeldSet.has(kleur)}
                          />
                        ))
                      ) : (
                        <span className="text-xs text-slate-300">Geen kleuren</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
