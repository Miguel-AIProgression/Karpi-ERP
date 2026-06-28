import { Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useWerklijst } from '@/modules/snijplanning/hooks/use-werklijst'
import { WerklijstKwaliteitGroepItem } from '@/components/snijplanning/werklijst-kwaliteit-groep'

export function WerklijstPage() {
  const { groepen, isLoading, error } = useWerklijst()

  const totaalStukken = groepen.reduce(
    (s, g) => s + g.aantalOpRol + g.aantalWachtOpInkoop + g.aantalTekort,
    0,
  )
  const totaalTekort = groepen.reduce((s, g) => s + g.aantalTekort, 0)
  const totaalInkoop = groepen.reduce((s, g) => s + g.aantalWachtOpInkoop, 0)

  const beschrijving = isLoading
    ? 'Laden...'
    : `${totaalStukken} stukken in ${groepen.length} kwaliteiten` +
      (totaalTekort > 0 ? ` — ${totaalTekort} tekort` : '') +
      (totaalInkoop > 0 ? ` — ${totaalInkoop} wacht op inkoop` : '')

  return (
    <div>
      <PageHeader title="Snijderij werklijst" description={beschrijving} />

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={22} className="animate-spin mr-3" />
          Werklijst laden…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Fout bij laden: {error.message}
        </div>
      )}

      {!isLoading && !error && groepen.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-6 py-12 text-center">
          <p className="text-slate-400 text-sm">Geen openstaande maatwerk-stukken gevonden.</p>
        </div>
      )}

      {!isLoading && !error && groepen.length > 0 && (
        <div className="space-y-3">
          {groepen.map((groep, i) => (
            <WerklijstKwaliteitGroepItem
              key={groep.sleutel}
              groep={groep}
              defaultOpen={i === 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}
