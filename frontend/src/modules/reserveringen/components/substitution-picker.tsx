import { ArrowRightLeft, Clock, Package, PackagePlus, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { fetchEquivalenteProducten, type EquivalentProduct } from '@/lib/supabase/queries/product-equivalents'
import { useOpenstaandeInkoopregelsVoorArtikel } from '@/modules/inkoop'
import { isoWeek } from '@/lib/orders/verzendweek'
import { formatCurrency } from '@/lib/utils/formatters'

interface SubstitutionPickerProps {
  artikelnr: string
  omschrijving: string
  onSelect: (equivalent: EquivalentProduct) => void
  onSkip: () => void
  /** Optioneel: sluit het paneel zonder iets toe te voegen (terug naar de lijst). */
  onCancel?: () => void
}

function weekLabel(datumIso: string): string {
  const w = isoWeek(new Date(datumIso + 'T00:00:00'))
  return `wk ${w.week} · ${w.jaar}`
}

/** Eerstvolgende verwachte inkoop voor het originele artikel — zodat de
 *  verkoper bij voorraad 0 al vóór het toevoegen ziet wannéér het artikel
 *  weer binnenkomt (zelfde bron + FIFO-volgorde als `IoLevertijdHint`,
 *  die pas ná het toevoegen van de regel verschijnt). */
function InkoopVerwachtHint({ artikelnr }: { artikelnr: string }) {
  const { data: regels, isLoading } = useOpenstaandeInkoopregelsVoorArtikel(artikelnr)

  if (isLoading) return null

  const open = (regels ?? []).filter((r) => r.te_leveren_m > 0)
  const totaalBesteld = open.reduce((s, r) => s + r.te_leveren_m, 0)
  const eerste = open.find((r) => r.verwacht_datum)

  if (totaalBesteld <= 0) {
    return (
      <div className="text-xs text-rose-600">
        Geen openstaande inkoop voor dit artikel — levertijd onbekend.
      </div>
    )
  }

  return (
    <div className="text-xs text-amber-800 inline-flex items-center gap-1">
      <Clock size={12} className="shrink-0" />
      <span>
        {totaalBesteld}× besteld bij leverancier
        {eerste?.verwacht_datum ? (
          <>
            {' '}— eerstvolgende verwacht <span className="font-semibold">{weekLabel(eerste.verwacht_datum)}</span>
            {' '}({eerste.inkooporder_nr})
          </>
        ) : (
          <> — leverweek nog onbekend (geen verwachte datum op de inkooporder)</>
        )}
      </span>
    </div>
  )
}

function ToevoegenZonderVoorraadKnop({ onSkip }: { onSkip: () => void }) {
  return (
    <button
      type="button"
      onClick={onSkip}
      className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
    >
      <PackagePlus size={14} />
      Toch toevoegen — levering volgt zodra de inkoop binnen is
    </button>
  )
}

export function SubstitutionPicker({ artikelnr, omschrijving, onSelect, onSkip, onCancel }: SubstitutionPickerProps) {
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

  const annulerenKnop = onCancel && (
    <button
      type="button"
      onClick={onCancel}
      title="Annuleren — terug naar de lijst"
      className="shrink-0 text-amber-400 hover:text-amber-700"
    >
      <X size={14} />
    </button>
  )

  if (equivalents.length === 0) {
    return (
      <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-amber-700">
            <strong>{omschrijving}</strong> is niet op voorraad en er zijn geen equivalenten beschikbaar.
          </p>
          {annulerenKnop}
        </div>
        <InkoopVerwachtHint artikelnr={artikelnr} />
        <ToevoegenZonderVoorraadKnop onSkip={onSkip} />
      </div>
    )
  }

  const equivalentenOpVoorraad = equivalents.some((eq) => eq.vrije_voorraad > 0)

  return (
    <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm">
      <div className="flex items-start justify-between gap-2 text-amber-700 mb-1">
        <div className="flex items-center gap-2">
          <ArrowRightLeft size={14} className="shrink-0" />
          <span>
            <strong>{omschrijving}</strong> is niet op voorraad.
            {equivalentenOpVoorraad
              ? ' Kies een equivalent product om fysiek te leveren (wordt omgestickerd):'
              : ' Er zijn equivalente producten, maar die hebben óók geen voorraad:'}
          </span>
        </div>
        {annulerenKnop}
      </div>

      <div className="mb-3">
        <InkoopVerwachtHint artikelnr={artikelnr} />
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
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  {eq.verkoopprijs != null && (
                    <span className="text-xs font-medium text-slate-700">
                      {formatCurrency(eq.verkoopprijs)}
                    </span>
                  )}
                  <span className={`text-xs ${opVoorraad ? 'text-emerald-600' : 'text-rose-400'}`}>
                    <Package size={10} className="inline mr-1" />
                    Vrij: {eq.vrije_voorraad}
                  </span>
                  {eq.besteld_inkoop > 0 && (
                    <span className="text-xs text-slate-400" title="Verwacht uit openstaande inkoop">
                      +{eq.besteld_inkoop} besteld
                    </span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
      </div>

      <ToevoegenZonderVoorraadKnop onSkip={onSkip} />
    </div>
  )
}
