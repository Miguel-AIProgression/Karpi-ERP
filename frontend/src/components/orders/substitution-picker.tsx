import { ArrowRightLeft, Package } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchEquivalenteProducten, type EquivalentProduct } from '@/lib/supabase/queries/product-equivalents'

interface SubstitutionPickerProps {
  artikelnr: string
  omschrijving: string
  onSelect: (equivalent: EquivalentProduct) => void
  onSkip: () => void
}

export function SubstitutionPicker({ artikelnr, omschrijving, onSelect, onSkip }: SubstitutionPickerProps) {
  const { data: equivalents = [], isLoading } = useQuery({
    queryKey: ['equivalente-producten', artikelnr],
    queryFn: () => fetchEquivalenteProducten(artikelnr),
  })

  if (isLoading) {
    return (
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm text-amber-700">
        Equivalente producten zoeken...
      </div>
    )
  }

  if (equivalents.length === 0) {
    return (
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm">
        <p className="text-amber-700 mb-2">
          <strong>{omschrijving}</strong> is niet op voorraad en er zijn geen equivalenten beschikbaar.
        </p>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs text-amber-600 underline hover:text-amber-800"
        >
          Toch toevoegen zonder voorraad
        </button>
      </div>
    )
  }

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm">
      <div className="flex items-center gap-2 text-amber-700 mb-3">
        <ArrowRightLeft size={14} />
        <span>
          <strong>{omschrijving}</strong> is niet op voorraad.
          Kies een equivalent product om fysiek te leveren (wordt omgestickerd):
        </span>
      </div>

      <div className="space-y-1">
        {equivalents.map((eq) => {
          const opVoorraad = eq.vrije_voorraad > 0
          return (
            <button
              key={eq.artikelnr}
              type="button"
              onClick={() => opVoorraad && onSelect(eq)}
              disabled={!opVoorraad}
              className={`w-full text-left px-3 py-2 rounded border transition-colors ${
                opVoorraad
                  ? 'bg-white border-amber-100 hover:border-amber-300 cursor-pointer'
                  : 'bg-slate-50 border-slate-100 cursor-default opacity-70'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className={!opVoorraad ? 'italic text-slate-400' : ''}>
                  <span className={`font-mono text-xs ${opVoorraad ? 'text-terracotta-500' : 'text-slate-400'}`}>
                    {eq.artikelnr}
                  </span>
                  <span className="ml-2">{eq.omschrijving}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <span className={`text-xs ${opVoorraad ? 'text-emerald-600' : 'text-rose-400'}`}>
                    <Package size={10} className="inline mr-1" />
                    Vrij: {eq.vrije_voorraad}
                  </span>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={onSkip}
        className="mt-2 text-xs text-amber-600 underline hover:text-amber-800"
      >
        Toch origineel toevoegen zonder voorraad
      </button>
    </div>
  )
}
