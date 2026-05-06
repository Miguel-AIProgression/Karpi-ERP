import { useMemo, useState, type FormEvent } from 'react'
import { X, Search, Check, ArrowLeft, Trash2 } from 'lucide-react'
import {
  useKoppelbareProductenVoorPrijslijst,
  useAddProductenAanPrijslijst,
} from '@/hooks/use-prijslijsten'
import { formatCurrency } from '@/lib/utils/formatters'
import type { KoppelbaarProduct } from '@/lib/supabase/queries/prijslijsten'

interface Props {
  prijslijstNr: string
  prijslijstNaam: string
  onClose: () => void
}

const MAX_VISIBLE = 200

type Step = 'select' | 'review'

export function PrijslijstAddProductDialog({ prijslijstNr, prijslijstNaam, onClose }: Props) {
  const [step, setStep] = useState<Step>('select')
  const [search, setSearch] = useState('')
  // Snapshot per geselecteerd product zodat het in stap 2 zichtbaar blijft
  // ook als de zoekterm verandert en het uit de zichtbare lijst valt.
  const [selectedMap, setSelectedMap] = useState<Map<string, KoppelbaarProduct>>(new Map())
  // Per-artikel handmatige prijs-input (string voor komma-invoer).
  const [prijsInputs, setPrijsInputs] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)

  const { data: producten, isLoading } = useKoppelbareProductenVoorPrijslijst(prijslijstNr, search)
  const mutation = useAddProductenAanPrijslijst(prijslijstNr)

  const visible = useMemo(() => (producten ?? []).slice(0, MAX_VISIBLE), [producten])
  const hasMore = (producten?.length ?? 0) > MAX_VISIBLE

  const selectedList = useMemo(() => Array.from(selectedMap.values()), [selectedMap])

  const toggle = (p: KoppelbaarProduct) => {
    setSelectedMap((prev) => {
      const next = new Map(prev)
      if (next.has(p.artikelnr)) next.delete(p.artikelnr)
      else next.set(p.artikelnr, p)
      return next
    })
  }

  const removeFromSelection = (artikelnr: string) => {
    setSelectedMap((prev) => {
      const next = new Map(prev)
      next.delete(artikelnr)
      return next
    })
    setPrijsInputs((prev) => {
      const next = new Map(prev)
      next.delete(artikelnr)
      return next
    })
  }

  const toggleAllVisible = () => {
    const allSelected = visible.every((p) => selectedMap.has(p.artikelnr))
    setSelectedMap((prev) => {
      const next = new Map(prev)
      if (allSelected) {
        for (const p of visible) next.delete(p.artikelnr)
      } else {
        for (const p of visible) next.set(p.artikelnr, p)
      }
      return next
    })
  }

  const setPrijsInput = (artikelnr: string, value: string) => {
    setPrijsInputs((prev) => {
      const next = new Map(prev)
      next.set(artikelnr, value)
      return next
    })
  }

  const goToReview = () => {
    setError(null)
    if (selectedMap.size === 0) {
      setError('Kies eerst minimaal één product')
      return
    }
    // Vul defaults in voor producten waar nog geen handmatige prijs is ingevoerd
    setPrijsInputs((prev) => {
      const next = new Map(prev)
      for (const p of selectedList) {
        if (!next.has(p.artikelnr)) {
          const defaultPrijs = p.verkoopprijs ?? 0
          next.set(p.artikelnr, defaultPrijs.toFixed(2))
        }
      }
      return next
    })
    setStep('review')
  }

  const parsePrijs = (raw: string | undefined): number | null => {
    if (raw == null || raw.trim() === '') return null
    const v = parseFloat(raw.replace(',', '.'))
    if (isNaN(v) || v < 0) return null
    return v
  }

  const ongeldigePrijzen = useMemo(() => {
    if (step !== 'review') return [] as string[]
    return selectedList
      .filter((p) => parsePrijs(prijsInputs.get(p.artikelnr)) === null)
      .map((p) => p.artikelnr)
  }, [step, selectedList, prijsInputs])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    // Veiligheid: in stap 1 mag een impliciete form-submit (bv. omdat de
    // "Toevoegen"-knop net via setStep('review') is verschenen op dezelfde
    // positie als waar net op "Volgende" geklikt is) NOOIT regels wegschrijven.
    if (step !== 'review') return
    setError(null)
    if (selectedList.length === 0) {
      setError('Kies eerst minimaal één product')
      return
    }
    if (ongeldigePrijzen.length > 0) {
      setError(`Vul een geldige prijs in voor ${ongeldigePrijzen.length} product(en)`)
      return
    }
    const rows = selectedList.map((p) => ({
      artikelnr: p.artikelnr,
      prijs: parsePrijs(prijsInputs.get(p.artikelnr)) ?? 0,
      omschrijving: p.omschrijving ?? null,
      // Voor rol/maatwerk-producten heeft `producten.gewicht_kg` vaak geen
      // waarde — gebruik dan de kwaliteit-density (kg/m²) als fallback,
      // dat is wat de bestaande regels in andere prijslijsten ook tonen.
      gewicht: p.gewicht_kg ?? p.gewicht_per_m2_kwaliteit ?? null,
      ean_code: p.ean_code ?? null,
    }))
    try {
      await mutation.mutateAsync(rows)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Er ging iets mis')
    }
  }

  const allVisibleSelected =
    visible.length > 0 && visible.every((p) => selectedMap.has(p.artikelnr))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <h2 className="font-medium text-lg">
              {step === 'select' ? 'Product toevoegen aan ' : 'Prijzen controleren — '}
              <span className="text-terracotta-600">{prijslijstNaam}</span>
            </h2>
            <span className="text-xs text-slate-400 font-medium">
              Stap {step === 'select' ? '1' : '2'} van 2
            </span>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          {step === 'select' ? (
            <>
              <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Zoek op artikelnr, karpi-code of omschrijving..."
                    autoFocus
                    className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                  />
                </div>
                {visible.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleAllVisible}
                    className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium whitespace-nowrap"
                  >
                    {allVisibleSelected ? 'Deselecteer zichtbare' : 'Selecteer zichtbare'}
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {isLoading ? (
                  <div className="p-5 text-sm text-slate-400">Laden...</div>
                ) : visible.length === 0 ? (
                  <div className="p-5 text-sm text-slate-400">
                    {search.trim()
                      ? 'Geen producten gevonden die nog niet in deze prijslijst zitten'
                      : 'Type in de zoekbalk om producten te vinden'}
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-50">
                    {visible.map((p) => (
                      <ProductRow
                        key={p.artikelnr}
                        product={p}
                        isSelected={selectedMap.has(p.artikelnr)}
                        onToggle={() => toggle(p)}
                      />
                    ))}
                  </ul>
                )}
                {hasMore && (
                  <div className="px-6 py-2 text-xs text-slate-400 text-center border-t border-slate-50">
                    Eerste {MAX_VISIBLE} weergegeven — verfijn de zoekterm voor meer.
                  </div>
                )}
              </div>
            </>
          ) : (
            <ReviewStep
              selectedList={selectedList}
              prijsInputs={prijsInputs}
              onChangePrijs={setPrijsInput}
              onRemove={removeFromSelection}
              ongeldig={new Set(ongeldigePrijzen)}
            />
          )}

          {error && (
            <div className="px-6 py-3 bg-rose-50 border-t border-rose-100 text-sm text-rose-700">
              {error}
            </div>
          )}

          <footer className="px-6 py-3 border-t border-slate-200 flex items-center justify-between gap-2">
            <span className="text-sm text-slate-500">
              {selectedMap.size === 0
                ? 'Niets geselecteerd'
                : `${selectedMap.size} geselecteerd`}
            </span>
            <div className="flex items-center gap-2">
              {step === 'review' ? (
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
                >
                  <ArrowLeft size={14} />
                  Terug
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
                >
                  Annuleren
                </button>
              )}
              {step === 'select' ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    goToReview()
                  }}
                  disabled={selectedMap.size === 0}
                  className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
                >
                  {`Volgende${selectedMap.size > 0 ? ` (${selectedMap.size})` : ''}`}
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={selectedMap.size === 0 || mutation.isPending}
                  className="px-4 py-2 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
                >
                  {mutation.isPending
                    ? 'Toevoegen...'
                    : `Toevoegen (${selectedMap.size})`}
                </button>
              )}
            </div>
          </footer>
        </form>
      </div>
    </div>
  )
}

function ProductRow({
  product,
  isSelected,
  onToggle,
}: {
  product: KoppelbaarProduct
  isSelected: boolean
  onToggle: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full text-left px-6 py-2.5 text-sm flex items-center gap-3 ${
          isSelected ? 'bg-terracotta-50' : 'hover:bg-slate-50'
        }`}
      >
        <span
          className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center ${
            isSelected
              ? 'bg-terracotta-500 border-terracotta-500 text-white'
              : 'border-slate-300 bg-white'
          }`}
        >
          {isSelected && <Check size={12} strokeWidth={3} />}
        </span>
        <span className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-slate-400">{product.artikelnr}</span>
            <span className="font-medium text-slate-700 truncate">
              {product.omschrijving || product.karpi_code || '—'}
            </span>
          </div>
          {product.karpi_code && product.karpi_code !== product.omschrijving && (
            <span className="text-xs text-slate-400">{product.karpi_code}</span>
          )}
        </span>
        <span className="flex-shrink-0 text-xs text-slate-500 text-right">
          {product.verkoopprijs != null && product.verkoopprijs > 0 ? (
            <span className="font-medium">{formatCurrency(product.verkoopprijs)}</span>
          ) : (
            <span className="text-amber-600">geen prijs</span>
          )}
        </span>
      </button>
    </li>
  )
}

function ReviewStep({
  selectedList,
  prijsInputs,
  onChangePrijs,
  onRemove,
  ongeldig,
}: {
  selectedList: KoppelbaarProduct[]
  prijsInputs: Map<string, string>
  onChangePrijs: (artikelnr: string, value: string) => void
  onRemove: (artikelnr: string) => void
  ongeldig: Set<string>
}) {
  return (
    <>
      <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 text-xs text-slate-500">
        Controleer de prijzen voordat je toevoegt. Default = verkoopprijs uit producttabel,
        € 0,00 als die niet ingesteld is. Je kunt straks ook nog inline aanpassen in de regel-tabel.
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-white border-b border-slate-100 sticky top-0">
            <tr className="text-left text-xs text-slate-400">
              <th className="px-6 py-2 font-medium">Artikel</th>
              <th className="px-3 py-2 font-medium text-right w-32">Prijs (€)</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {selectedList.map((p) => {
              const value = prijsInputs.get(p.artikelnr) ?? ''
              const isOngeldig = ongeldig.has(p.artikelnr)
              const heeftDefault =
                p.verkoopprijs != null && p.verkoopprijs > 0
              return (
                <tr key={p.artikelnr} className="hover:bg-slate-50">
                  <td className="px-6 py-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{p.artikelnr}</span>
                      <span className="font-medium text-slate-700 truncate">
                        {p.omschrijving || p.karpi_code || '—'}
                      </span>
                    </div>
                    {!heeftDefault && (
                      <span className="text-xs text-amber-600">geen verkoopprijs in product</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={value}
                      onChange={(e) => onChangePrijs(p.artikelnr, e.target.value)}
                      className={`w-28 px-2 py-1 text-right text-sm rounded-[var(--radius-sm)] border focus:outline-none focus:ring-1 ${
                        isOngeldig
                          ? 'border-rose-400 focus:ring-rose-300'
                          : 'border-slate-200 focus:ring-terracotta-300 focus:border-terracotta-300'
                      }`}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onRemove(p.artikelnr)}
                      className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded"
                      title="Uit selectie halen"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
