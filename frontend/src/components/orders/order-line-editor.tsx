import { useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/formatters'
import { ArticleSelector } from './article-selector'
import type { SelectedArticle, SubstitutionInfo } from './article-selector'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'

interface OrderLineEditorProps {
  lines: OrderRegelFormData[]
  onChange: (lines: OrderRegelFormData[]) => void
  defaultKorting: number
  onArticleSelected?: (article: SelectedArticle) => Promise<{
    prijs: number | null
    klant_eigen_naam?: string | null
    klant_artikelnr?: string | null
  }>
}

function calcBedrag(line: OrderRegelFormData): number {
  const base = (line.orderaantal ?? 0) * (line.prijs ?? 0)
  return Math.round(base * (1 - (line.korting_pct ?? 0) / 100) * 100) / 100
}

export function OrderLineEditor({ lines, onChange, defaultKorting, onArticleSelected }: OrderLineEditorProps) {
  const keyCounter = useRef(0)
  const lineKeys = useRef<Map<number, string>>(new Map())

  const getKey = (index: number): string => {
    if (!lineKeys.current.has(index)) {
      lineKeys.current.set(index, `line-${keyCounter.current++}`)
    }
    return lineKeys.current.get(index)!
  }

  const updateLine = (index: number, updates: Partial<OrderRegelFormData>) => {
    const updated = lines.map((l, i) => {
      if (i !== index) return l
      const merged = { ...l, ...updates }
      merged.bedrag = calcBedrag(merged)
      return merged
    })
    onChange(updated)
  }

  const removeLine = (index: number) => {
    if (!window.confirm('Weet je zeker dat je deze regel wilt verwijderen?')) return
    onChange(lines.filter((_, i) => i !== index))
  }

  const addArticle = async (article: SelectedArticle, substitution?: SubstitutionInfo) => {
    let prijs = article.verkoopprijs
    let klant_eigen_naam: string | undefined
    let klant_artikelnr: string | undefined
    let prijsUitPrijslijst = false

    if (onArticleSelected) {
      const result = await onArticleSelected(article)
      if (result.prijs !== null) {
        prijs = result.prijs
        prijsUitPrijslijst = true
      }
      klant_eigen_naam = result.klant_eigen_naam ?? undefined
      klant_artikelnr = result.klant_artikelnr ?? undefined
    }

    // Als origineel geen prijs heeft in de prijslijst, zoek de vervanger op
    if (!prijsUitPrijslijst && substitution && onArticleSelected) {
      const fysiekArticle: SelectedArticle = {
        ...article,
        artikelnr: substitution.fysiek_artikelnr,
        kwaliteit_code: substitution.fysiek_kwaliteit_code,
        verkoopprijs: substitution.fysiek_verkoopprijs,
      }
      const fysiekResult = await onArticleSelected(fysiekArticle)
      if (fysiekResult.prijs !== null) {
        prijs = fysiekResult.prijs
      } else {
        prijs = substitution.fysiek_verkoopprijs
      }
    }

    const newLine: OrderRegelFormData = {
      artikelnr: article.artikelnr,
      karpi_code: article.karpi_code ?? undefined,
      omschrijving: article.omschrijving,
      orderaantal: 1,
      te_leveren: 1,
      prijs: prijs ?? undefined,
      korting_pct: defaultKorting,
      gewicht_kg: article.gewicht_kg ?? undefined,
      bedrag: 0,
      vrije_voorraad: substitution ? substitution.fysiek_vrije_voorraad : article.vrije_voorraad,
      besteld_inkoop: article.besteld_inkoop,
      klant_eigen_naam,
      klant_artikelnr,
      // Substitutie
      fysiek_artikelnr: substitution?.fysiek_artikelnr,
      fysiek_omschrijving: substitution?.fysiek_omschrijving,
      omstickeren: substitution?.omstickeren,
    }
    newLine.bedrag = calcBedrag(newLine)
    onChange([...lines, newLine])
  }

  const hasShippingLine = lines.some(l => l.artikelnr === SHIPPING_PRODUCT_ID)
  const subtotaal = lines.filter(l => l.artikelnr !== SHIPPING_PRODUCT_ID).reduce((sum, l) => sum + (l.bedrag ?? 0), 0)
  const totaal = lines.reduce((sum, l) => sum + (l.bedrag ?? 0), 0)

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
        <h3 className="font-medium">Orderregels ({lines.length})</h3>
        <span className="font-medium">
          {hasShippingLine ? (
            <>Subtotaal: {formatCurrency(subtotaal)} | Totaal: {formatCurrency(totaal)}</>
          ) : (
            <>Totaal: {formatCurrency(totaal)}</>
          )}
          <span className="text-xs font-normal text-slate-400 ml-1">ex BTW</span>
        </span>
      </div>

      {/* Add article */}
      <div className="px-5 py-3 border-b border-slate-100">
        <ArticleSelector onSelect={addArticle} />
      </div>

      {/* Lines table */}
      {lines.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-sm">
          Zoek een artikel hierboven om een orderregel toe te voegen
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                <th className="text-left px-3 py-2 font-medium text-slate-600">Artikel</th>
                <th className="text-left px-3 py-2 font-medium text-slate-600">Omschrijving</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-20">Voorraad</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-20">Aantal</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-24">Prijs</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-20">Korting%</th>
                <th className="text-right px-3 py-2 font-medium text-slate-600 w-24">Bedrag</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={getKey(i)} className="border-b border-slate-50">
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs text-slate-500">
                      {line.artikelnr ?? '—'}
                    </div>
                    {line.klant_artikelnr && (
                      <div className="text-xs text-blue-500" title="Klant artikelnr">
                        {line.klant_artikelnr}
                      </div>
                    )}
                    {line.omstickeren && line.fysiek_artikelnr && (
                      <div className="text-xs text-amber-600 flex items-center gap-1 mt-0.5" title="Wordt omgestickerd">
                        ↔ Fysiek: {line.fysiek_artikelnr}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={line.omschrijving}
                      onChange={(e) => updateLine(i, { omschrijving: e.target.value })}
                      className="w-full bg-transparent border-0 p-0 text-sm focus:outline-none focus:ring-0"
                    />
                    {line.klant_eigen_naam && (
                      <div className="text-xs text-blue-500" title="Klanteigen naam">
                        {line.klant_eigen_naam}
                      </div>
                    )}
                    {line.omstickeren && line.fysiek_omschrijving && (
                      <div className="text-xs text-amber-600 mt-0.5">
                        Omstickeren van: {line.fysiek_omschrijving}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className={`text-xs ${(line.vrije_voorraad ?? 0) > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {line.vrije_voorraad ?? 0}
                    </div>
                    {(line.besteld_inkoop ?? 0) > 0 && (
                      <div className="text-xs text-slate-400" title="Verwacht (besteld inkoop)">
                        +{line.besteld_inkoop}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={line.orderaantal}
                      onChange={(e) => {
                        const val = parseInt(e.target.value) || 0
                        updateLine(i, { orderaantal: val, te_leveren: val })
                      }}
                      className="w-full text-right bg-transparent border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400/30"
                      min={1}
                    />
                    {line.omstickeren && (line.vrije_voorraad ?? 0) > 0 && line.orderaantal > (line.vrije_voorraad ?? 0) && (
                      <div className="text-xs text-amber-600 mt-0.5">
                        Max {line.vrije_voorraad} vrij
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={line.prijs ?? ''}
                      onChange={(e) => updateLine(i, { prijs: parseFloat(e.target.value) || 0 })}
                      className="w-full text-right bg-transparent border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400/30"
                      step="0.01"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="number"
                      value={line.korting_pct}
                      onChange={(e) => updateLine(i, { korting_pct: parseFloat(e.target.value) || 0 })}
                      className="w-full text-right bg-transparent border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400/30"
                      step="0.1"
                      min={0}
                      max={100}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatCurrency(line.bedrag)}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
