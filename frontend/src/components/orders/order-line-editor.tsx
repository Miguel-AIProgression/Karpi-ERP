import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { formatCurrency } from '@/lib/utils/formatters'
import { berekenPrijsOppervlakM2 } from '@/lib/utils/maatwerk-prijs'
import { AFWERKING_OPTIES } from '@/lib/utils/constants'
import { ArticleSelector } from './article-selector'
import { ProductTypeToggle } from './product-type-toggle'
import { OpMaatSelector } from './op-maat-selector'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
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

const inputClass = 'w-full text-right bg-transparent border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400/30'
const selectClass = 'bg-transparent border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400/30'

function MaatwerkLineRow({
  line, index, updateLine, removeLine,
}: {
  line: OrderRegelFormData
  index: number
  updateLine: (i: number, u: Partial<OrderRegelFormData>) => void
  removeLine: (i: number) => void
}) {
  return (
    <>
      <tr className={line.is_maatwerk ? 'border-b-0' : 'border-b border-slate-50'}>
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
          {line.is_maatwerk && (
            <div className="text-xs text-purple-600 font-medium mt-0.5">Maatwerk</div>
          )}
        </td>
        <td className="px-3 py-2">
          <input
            type="text"
            value={line.omschrijving}
            onChange={(e) => updateLine(index, { omschrijving: e.target.value })}
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
          {line.is_maatwerk && line.maatwerk_beschikbaar_m2 != null ? (
            <>
              <div className={`text-xs ${line.maatwerk_beschikbaar_m2 > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {line.maatwerk_beschikbaar_m2} m²
                {(line.maatwerk_equiv_m2 ?? 0) > 0 && (
                  <span className="text-slate-400" title="Uitwisselbare kwaliteiten"> (+{line.maatwerk_equiv_m2})</span>
                )}
              </div>
            </>
          ) : (
            <>
              <div className={`text-xs ${(line.vrije_voorraad ?? 0) > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                {line.vrije_voorraad ?? 0}
              </div>
              {(line.besteld_inkoop ?? 0) > 0 && (
                <div className="text-xs text-slate-400" title="Verwacht (besteld inkoop)">
                  +{line.besteld_inkoop}
                </div>
              )}
            </>
          )}
        </td>
        <td className="px-3 py-2">
          <input
            type="number"
            value={line.orderaantal}
            onChange={(e) => {
              const val = parseInt(e.target.value) || 0
              updateLine(index, { orderaantal: val, te_leveren: val })
            }}
            className={inputClass}
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
            onChange={(e) => updateLine(index, { prijs: parseFloat(e.target.value) || 0 })}
            className={inputClass}
            step="0.01"
          />
        </td>
        <td className="px-3 py-2">
          <input
            type="number"
            value={line.korting_pct}
            onChange={(e) => updateLine(index, { korting_pct: parseFloat(e.target.value) || 0 })}
            className={inputClass}
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
            onClick={() => removeLine(index)}
            className="text-slate-400 hover:text-rose-500"
          >
            <Trash2 size={14} />
          </button>
        </td>
      </tr>
      {line.is_maatwerk && (
        <tr className="border-b border-slate-50 bg-purple-50/30">
          <td colSpan={8} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-slate-500">Afwerking</span>
                <select
                  value={line.maatwerk_afwerking ?? ''}
                  onChange={(e) => updateLine(index, { maatwerk_afwerking: e.target.value || undefined })}
                  className={selectClass}
                >
                  <option value="">Geen</option>
                  {AFWERKING_OPTIES.map((a) => (
                    <option key={a.code} value={a.code}>{a.code} — {a.label}</option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-slate-500">Vorm</span>
                <select
                  value={line.maatwerk_vorm ?? 'rechthoek'}
                  onChange={(e) => updateLine(index, { maatwerk_vorm: e.target.value })}
                  className={selectClass}
                >
                  {['rechthoek', 'rond', 'ovaal', 'organisch_a', 'organisch_b_sp'].map(code => {
                    const display = getVormDisplay(code)
                    return <option key={code} value={code}>{display.label}</option>
                  })}
                </select>
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-slate-500">Lengte (cm)</span>
                <input
                  type="number"
                  value={line.maatwerk_lengte_cm ?? ''}
                  onChange={(e) => updateLine(index, { maatwerk_lengte_cm: parseInt(e.target.value) || undefined })}
                  className={inputClass + ' !w-20 !text-left'}
                  min={1}
                />
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-slate-500">Breedte (cm)</span>
                <input
                  type="number"
                  value={line.maatwerk_breedte_cm ?? ''}
                  onChange={(e) => updateLine(index, { maatwerk_breedte_cm: parseInt(e.target.value) || undefined })}
                  className={inputClass + ' !w-20 !text-left'}
                  min={1}
                />
              </label>

              {(line.maatwerk_afwerking === 'B' || line.maatwerk_afwerking === 'SB') && (
                <label className="flex items-center gap-1.5">
                  <span className="text-slate-500">Bandkleur</span>
                  <input
                    type="text"
                    value={line.maatwerk_band_kleur ?? ''}
                    onChange={(e) => updateLine(index, { maatwerk_band_kleur: e.target.value || undefined })}
                    className={selectClass + ' w-24'}
                    placeholder="bijv. zwart"
                  />
                </label>
              )}

              <label className="flex items-center gap-1.5">
                <span className="text-slate-500">Instructies</span>
                <input
                  type="text"
                  value={line.maatwerk_instructies ?? ''}
                  onChange={(e) => updateLine(index, { maatwerk_instructies: e.target.value || undefined })}
                  className={selectClass + ' w-48'}
                  placeholder="Extra instructies..."
                />
              </label>

              {line.maatwerk_m2_prijs != null && line.maatwerk_m2_prijs > 0 && (
                <span className="text-purple-600 font-medium">
                  {line.maatwerk_oppervlak_m2?.toFixed(2)} m² x {formatCurrency(line.maatwerk_m2_prijs)}/m²
                  {(line.maatwerk_vorm_toeslag ?? 0) > 0 && ` + ${formatCurrency(line.maatwerk_vorm_toeslag!)} vorm`}
                  {(line.maatwerk_afwerking_prijs ?? 0) > 0 && ` + ${formatCurrency(line.maatwerk_afwerking_prijs!)} afwerking`}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function OrderLineEditor({ lines, onChange, defaultKorting, onArticleSelected }: OrderLineEditorProps) {
  const [productType, setProductType] = useState<'standaard' | 'op_maat'>('standaard')
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

      // Herbereken m²-prijs bij maatwerk wanneer afmetingen/vorm veranderen
      if (merged.is_maatwerk && merged.maatwerk_m2_prijs) {
        const oppervlak = berekenPrijsOppervlakM2(
          merged.maatwerk_vorm ?? 'rechthoek',
          merged.maatwerk_lengte_cm,
          merged.maatwerk_breedte_cm,
          merged.maatwerk_diameter_cm,
        )
        merged.maatwerk_oppervlak_m2 = oppervlak
        merged.prijs = oppervlak * merged.maatwerk_m2_prijs
          + (merged.maatwerk_vorm_toeslag ?? 0)
          + (merged.maatwerk_afwerking_prijs ?? 0)
      }

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

    const isMaatwerk = article.product_type === 'rol'
      || /MAATWERK|BREED/i.test(article.artikelnr)

    if (isMaatwerk) {
      // Redirect naar op-maat flow — gebruiker kiest daar kwaliteit/kleur/vorm/afmeting
      setProductType('op_maat')
      return
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
      // Maatwerk
      is_maatwerk: false,
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

      {/* Product type keuze + invoer */}
      <div className="px-5 py-3 border-b border-slate-100 space-y-3">
        <ProductTypeToggle value={productType} onChange={setProductType} />
        {productType === 'standaard' ? (
          <ArticleSelector onSelect={addArticle} />
        ) : (
          <OpMaatSelector
            defaultKorting={defaultKorting}
            onAdd={(line) => {
              onChange([...lines, line])
              setProductType('standaard')  // Reset na toevoegen
            }}
          />
        )}
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
                <MaatwerkLineRow
                  key={getKey(i)}
                  line={line}
                  index={i}
                  updateLine={updateLine}
                  removeLine={removeLine}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
