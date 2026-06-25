import { useRef } from 'react'
import { Trash2, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { formatCurrency } from '@/lib/utils/formatters'
import { berekenRegelBedrag } from '@/lib/orders/bedrag'
import {
  berekenPrijsOppervlakM2,
  berekenOmtrekMeter,
  fetchVormen,
  fetchAfwerkingTypes,
  KwaliteitFirstSelector,
  type MaatwerkVormRow,
  type AfwerkingTypeRow,
} from '@/modules/maatwerk'
import { UitwisselbaarTekortHint, berekenRegelDekking } from '@/modules/reserveringen'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import { MaatwerkArtikelPicker } from './maatwerk-artikel-picker'
import type { SelectedArticle, SubstitutionInfo } from './article-selector'
import type { OrderRegelFormData, PrijsBron, PrijsBreakdown } from '@/lib/supabase/queries/order-mutations'
import { metProductVelden } from '@/lib/orders/order-hydratie'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'
import { formatPrijsBron } from '@/lib/utils/prijs-bron'
import { fetchEquivalenteProducten } from '@/lib/supabase/queries/product-equivalents'
import { isAdminPseudo } from '@/lib/orders/admin-pseudo'
import { syncVormToeslagRegel, verwijderRegelMetCompanion } from '@/lib/orders/vorm-toeslag-regel'
import { OverigeRegelToevoegen } from './overige-regel-toevoegen'

interface OrderLineEditorProps {
  lines: OrderRegelFormData[]
  onChange: (lines: OrderRegelFormData[]) => void
  defaultKorting: number
  prijslijstNr?: string
  /** Debiteur-nr van de geselecteerde klant — wordt doorgegeven aan
   *  `KwaliteitFirstSelector` zodat zoekopdrachten ook klant-eigen namen
   *  matchen (zie `searchKwaliteitenViaProducten`). */
  debiteurNr?: number
  /** True bij het bewerken van een bestaande order — activeert de
   *  "al gereserveerd voor dit order"-notitie bij 0 vrije voorraad. */
  isBestaandeOrder?: boolean
  onArticleSelected?: (article: SelectedArticle) => Promise<{
    prijs: number | null
    prijs_bron?: PrijsBron
    prijs_breakdown?: PrijsBreakdown
    klant_eigen_naam?: string | null
    klant_artikelnr?: string | null
  }>
}

function calcBedrag(line: OrderRegelFormData): number {
  return berekenRegelBedrag(line.prijs ?? 0, line.orderaantal ?? 0, line.korting_pct ?? 0)
}

const inputClass = 'w-full text-right bg-transparent border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400/30'
const selectClass = 'bg-transparent border border-slate-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-400/30'

function MaatwerkLineRow({
  line, index, updateLine, removeLine, vormen, afwerkingen, isBestaandeOrder,
}: {
  line: OrderRegelFormData
  index: number
  updateLine: (i: number, u: Partial<OrderRegelFormData>) => void
  removeLine: (i: number) => void
  /** DB-vormen uit `maatwerk_vormen` — geeft naam + toeslag zodat de dropdown
   *  "(+€ 75,00)" achter elke vorm kan tonen, identiek aan de aanmaak-flow in
   *  KwaliteitFirstSelector. Lege array tot de query retourneert; in dat geval
   *  valt de render terug op de statische 5 fallback-vormen zonder toeslag. */
  vormen: MaatwerkVormRow[]
  /** DB-afwerkingen uit `afwerking_types` — zelfde bron als de aanmaak-flow
   *  (KwaliteitFirstSelector/VormAfmetingSelector), zodat een nieuwe afwerking
   *  (bv. FUR) hier ook meteen kiesbaar is zonder code-wijziging. */
  afwerkingen: AfwerkingTypeRow[]
  /** True bij het bewerken van een bestaande order — in dat geval is vrije_voorraad
   *  al verminderd met de reserveringen van DEZE order, waardoor '0' misleidend
   *  lijkt terwijl de stuks al geclaimd zijn. */
  isBestaandeOrder?: boolean
}) {
  const isVasteMaatRegel = !line.is_maatwerk
    && line.artikelnr
    && line.artikelnr !== SHIPPING_PRODUCT_ID
    && !line.omstickeren
    && !isAdminPseudo(line)

  const dekking = berekenRegelDekking(line)
  const uitwisselbaarTotaal = dekking.uitwisselbaar
  const tekortAantal = dekking.ioTekort

  // Bij een bestaande order is vrije_voorraad al verminderd met deze order's
  // eigen reserveringen (voorraad- én inkoop-claims). Een ioTekort > 0 in
  // de edit-form betekent dan niet "niet gedekt" maar "gedekt via een claim
  // die de vrije voorraad al heeft opgebruikt". Toon een notitie zodat de
  // gebruiker weet dat de stuks al geclaimd zijn voor dit order.
  const reedsDgedekt = isBestaandeOrder ? tekortAantal : 0

  // Issue #35: passieve summary van uitwisselbare voorraad — toont onder
  // het vrije-voorraad getal "+N via ander type" zodra er überhaupt
  // omsticker-baar alternatief bestaat (ook als er nog geen tekort is).
  const { data: equivSummary } = useQuery({
    queryKey: ['equivalente-producten-summary', line.artikelnr],
    queryFn: () => fetchEquivalenteProducten(line.artikelnr!),
    enabled: !!isVasteMaatRegel && !!line.artikelnr,
    staleTime: 60_000,
  })
  const equivVoorraadTotaal = (equivSummary ?? []).reduce(
    (s, e) => s + (e.vrije_voorraad ?? 0),
    0,
  )

  // Issue #36: bij keuze van een product zónder eigen voorraad moet de UI
  // ondubbelzinnig laten zien WAARVANDAAN de regel geleverd kan worden —
  // uitwisselbaar (omsticker) of openstaande inkoop. We bouwen één expliciete
  // "Leverbaar via …"-summary zodat de gebruiker bij het toevoegen van de
  // regel direct weet welk pad gevolgd wordt; subtiele slate-400-tekst werd
  // gemist (zie QA-bevinding #36).
  const heeftEigenVoorraad = (line.vrije_voorraad ?? 0) > 0
  const eersteEquivOpVoorraad = (equivSummary ?? []).find((e) => (e.vrije_voorraad ?? 0) > 0)
  const equivPartnerLabel =
    eersteEquivOpVoorraad
      ? `${eersteEquivOpVoorraad.kwaliteit_code}-${eersteEquivOpVoorraad.kleur_code}`
      : null
  const toonLeverbaarVia =
    isVasteMaatRegel
    && !heeftEigenVoorraad
    && (equivVoorraadTotaal > 0 || (line.besteld_inkoop ?? 0) > 0)
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
          <input
            type="text"
            value={line.klant_referentie ?? ''}
            onChange={(e) => updateLine(index, { klant_referentie: e.target.value || null })}
            className="w-full mt-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-terracotta-400/40 focus:border-terracotta-400"
            placeholder="Ref klant..."
          />
        </td>
        <td className="px-3 py-2 text-right">
          {line.is_maatwerk && line.maatwerk_beschikbaar_m2 != null ? (
            <>
              {(() => {
                // Issue #37: bij maatwerk-regel zónder eigen voorraad maar mét
                // uitwisselbare m² is "0 m²" in rose-500 misleidend; de regel
                // is wel produceerbaar via een omsticker-rol. Toon dan een
                // emerald-500-style met expliciete "via uitwisselbaar"-label.
                const beschikbaar = line.maatwerk_beschikbaar_m2 ?? 0
                const equivM2 = line.maatwerk_equiv_m2 ?? 0
                const heeftEigen = beschikbaar > 0
                const heeftAlleenEquiv = !heeftEigen && equivM2 > 0
                const kleurClass = heeftEigen
                  ? 'text-emerald-600'
                  : heeftAlleenEquiv
                    ? 'text-slate-500'
                    : 'text-rose-500'
                return (
                  <>
                    <div className={`text-xs ${kleurClass}`}>
                      {beschikbaar} m²
                      {equivM2 > 0 && heeftEigen && (
                        <span className="text-slate-400" title="Uitwisselbare kwaliteiten"> (+{equivM2})</span>
                      )}
                    </div>
                    {heeftAlleenEquiv && (
                      <div
                        className="text-xs text-emerald-700 font-medium mt-0.5"
                        title="Te produceren via uitwisselbare kwaliteit (omsticker-rol)"
                      >
                        ↔ via uitwisselbaar ({equivM2} m²)
                      </div>
                    )}
                  </>
                )
              })()}
            </>
          ) : (
            <>
              <div className={`text-xs ${heeftEigenVoorraad ? 'text-emerald-600' : toonLeverbaarVia ? 'text-slate-500' : reedsDgedekt >= tekortAantal && tekortAantal > 0 ? 'text-amber-600' : 'text-rose-500'}`}>
                {line.vrije_voorraad ?? 0}
              </div>
              {reedsDgedekt > 0 && !heeftEigenVoorraad && (
                <div className="text-xs text-amber-600 mt-0.5 leading-tight font-medium" title={`${reedsDgedekt} stuks zijn al gereserveerd voor dit order`}>
                  {reedsDgedekt}× gereserveerd
                </div>
              )}
              {/* Issue #36: expliciete "Leverbaar via …"-summary wanneer eigen
                  voorraad = 0 maar omsticker- of inkoop-pad beschikbaar is. */}
              {toonLeverbaarVia ? (
                <div className="mt-0.5 space-y-0.5">
                  {equivVoorraadTotaal > 0 && (
                    <div
                      className="text-xs text-emerald-700 font-medium"
                      title="Leverbaar via uitwisselbaar product (omstickeren)"
                    >
                      ↔ via {equivPartnerLabel ?? 'ander type'}
                      {equivVoorraadTotaal > 0 && ` (${equivVoorraadTotaal})`}
                    </div>
                  )}
                  {(line.besteld_inkoop ?? 0) > 0 && (
                    <div
                      className="text-xs text-amber-700 font-medium"
                      title="Verwacht uit openstaande inkoop"
                    >
                      ⌛ via inkoop (+{line.besteld_inkoop})
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {(line.besteld_inkoop ?? 0) > 0 && (
                    <div className="text-xs text-slate-400" title="Verwacht (besteld inkoop)">
                      +{line.besteld_inkoop}
                    </div>
                  )}
                  {/* Issue #35: passieve indicator dat er uitwisselbare voorraad bestaat */}
                  {isVasteMaatRegel && equivVoorraadTotaal > 0 && (
                    <div
                      className="text-xs text-slate-400"
                      title="Beschikbaar via uitwisselbaar product (omstickeren)"
                    >
                      (+{equivVoorraadTotaal} via ander type)
                    </div>
                  )}
                </>
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
          {isVasteMaatRegel && line.te_leveren > (line.vrije_voorraad ?? 0) && (
            <div className="text-xs text-slate-500 mt-0.5 leading-tight">
              {(() => {
                const direct = Math.min(line.vrije_voorraad ?? 0, line.te_leveren)
                const opInkoop = tekortAantal
                const echTekort = Math.max(0, opInkoop - reedsDgedekt)
                const parts: string[] = []
                if (direct > 0) parts.push(`${direct}× direct`)
                if (uitwisselbaarTotaal > 0) parts.push(`${uitwisselbaarTotaal}× omstickeren`)
                if (echTekort > 0) parts.push(`${echTekort}× wacht op inkoop`)
                if (reedsDgedekt > 0 && opInkoop > 0) parts.push(`${reedsDgedekt}× gereserveerd voor dit order`)
                return parts.join(', ')
              })()}
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
          {/* Mig 191/253: prijs-bron + breakdown — geen hint bij "schone" bronnen */}
          {!line.is_maatwerk
            && line.prijs_bron
            && line.prijs_bron !== 'prijslijst_vast'
            && line.prijs_bron !== 'product_vaste_verkoopprijs'
            && (() => {
            const fmt = formatPrijsBron(line.prijs_bron, line.prijs_breakdown ?? {})
            return (
              <div className={`text-xs ${fmt.kleur} mt-0.5`} title={fmt.tooltip}>
                {fmt.label}
              </div>
            )
          })()}
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
      {isVasteMaatRegel && line.artikelnr && (tekortAantal > 0 || (line.uitwisselbaar_keuzes ?? []).length > 0) && (
        <tr className="border-b border-slate-50">
          <td colSpan={8} className="px-3 pb-2 pt-0">
            <UitwisselbaarTekortHint
              artikelnr={line.artikelnr}
              tekortAantal={tekortAantal}
              keuzes={line.uitwisselbaar_keuzes ?? []}
              onChange={(keuzes) => updateLine(index, { uitwisselbaar_keuzes: keuzes })}
            />
          </td>
        </tr>
      )}
      {line.is_maatwerk && (
        <tr className="border-b border-slate-50 bg-purple-50/30">
          <td colSpan={8} className="px-3 py-2">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-slate-500">Artikel</span>
                {line.artikelnr ? (
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-700 bg-white border border-slate-200 rounded px-2 py-1">
                    {line.artikelnr}{line.karpi_code ? ` · ${line.karpi_code}` : ''}
                    <button
                      type="button"
                      title="Product loskoppelen"
                      onClick={() => updateLine(index, { artikelnr: undefined, karpi_code: undefined })}
                      className="text-slate-400 hover:text-rose-500"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ) : (
                  <MaatwerkArtikelPicker
                    onSelect={(a) => updateLine(index, { artikelnr: a.artikelnr, karpi_code: a.karpi_code ?? undefined })}
                  />
                )}
              </label>

              <label className="flex items-center gap-1.5">
                <span className="text-slate-500">Afwerking</span>
                <select
                  value={line.maatwerk_afwerking ?? ''}
                  onChange={(e) => updateLine(index, { maatwerk_afwerking: e.target.value || undefined })}
                  className={selectClass}
                >
                  <option value="">Geen</option>
                  {afwerkingen.map((a) => (
                    <option key={a.code} value={a.code}>{a.code} — {a.naam}</option>
                  ))}
                </select>
              </label>

              {afwerkingen.find((a) => a.code === line.maatwerk_afwerking)?.heeft_band_kleur && (
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
                <span className="text-slate-500">Vorm</span>
                <select
                  value={line.maatwerk_vorm ?? 'rechthoek'}
                  onChange={(e) => updateLine(index, { maatwerk_vorm: e.target.value })}
                  className={selectClass}
                >
                  {vormen.length === 0
                    ? ['rechthoek', 'rond', 'ovaal', 'organisch_a', 'organisch_b_sp'].map(code => {
                        const display = getVormDisplay(code)
                        return <option key={code} value={code}>{display.label}</option>
                      })
                    : vormen.map((v) => (
                        <option key={v.code} value={v.code}>
                          {v.naam}{v.toeslag > 0 ? ` (+${formatCurrency(v.toeslag)})` : ''}
                        </option>
                      ))}
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
                  {(line.maatwerk_afwerking_prijs ?? 0) > 0 && ` + ${formatCurrency(line.maatwerk_afwerking_prijs!)} afwerking`}
                  {/* Mig 465: vorm-toeslag is een eigen orderregel (VORMTOESLAG, zie regel hieronder), niet meer in deze prijs verwerkt. */}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export function OrderLineEditor({ lines, onChange, defaultKorting, prijslijstNr, debiteurNr, isBestaandeOrder, onArticleSelected }: OrderLineEditorProps) {
  const keyCounter = useRef(0)
  const lineKeys = useRef<Map<number, string>>(new Map())

  // Lookups voor maatwerk — nodig om bij vorm/afwerking/afmeting-wijziging de
  // gekoppelde toeslag (`maatwerk_vormen.toeslag`, mig 190) en
  // afwerking-prijs (omtrek × `afwerking_types.prijs_per_meter`, mig 193)
  // opnieuw af te leiden. Vormen-dropdown toont "(+€ 75,00)"-suffix zoals
  // KwaliteitFirstSelector dat in de aanmaak-flow ook doet.
  const { data: vormen = [] } = useQuery({
    queryKey: ['maatwerk-vormen'],
    queryFn: fetchVormen,
    staleTime: 60_000,
  })
  const { data: afwerkingen = [] } = useQuery({
    queryKey: ['afwerking-types'],
    queryFn: fetchAfwerkingTypes,
    staleTime: 60_000,
  })

  const getKey = (index: number): string => {
    if (!lineKeys.current.has(index)) {
      lineKeys.current.set(index, `line-${keyCounter.current++}`)
    }
    return lineKeys.current.get(index)!
  }

  // Maatwerk-velden die de prijs (en afgeleiden) bepalen. We herberekenen de
  // prijs UITSLUITEND wanneer één hiervan in deze update zit. Een handmatige
  // prijs-, korting- of omschrijving-wijziging laat de (mogelijk overschreven)
  // prijs dus intact — voorheen ketste een handmatige prijs meteen terug naar
  // de berekende waarde, waardoor maatwerk-prijzen onbewerkbaar leken
  // (verzoek Marjon, 18-06-2026: berekening blijft de basis, maar moet daarna
  // handmatig te overschrijven zijn). Wijzigt de gebruiker later een afmeting/
  // vorm/afwerking, dan herberekent het systeem bewust opnieuw — de oude
  // override geldt dan niet meer voor de nieuwe maat.
  const MAATWERK_PRIJS_VELDEN: (keyof OrderRegelFormData)[] = [
    'maatwerk_lengte_cm', 'maatwerk_breedte_cm', 'maatwerk_diameter_cm',
    'maatwerk_vorm', 'maatwerk_afwerking', 'maatwerk_m2_prijs',
  ]

  const updateLine = (index: number, updates: Partial<OrderRegelFormData>) => {
    const raaktMaatwerkPrijs = MAATWERK_PRIJS_VELDEN.some((k) => k in updates)
    let updated = lines.map((l, i) => {
      if (i !== index) return l
      const merged = { ...l, ...updates }

      // Herbereken m²-prijs bij maatwerk wanneer afmetingen/vorm/afwerking
      // veranderen. Vorm-toeslag + afwerking-prijs worden opnieuw uit de
      // lookups afgeleid — alleen `merged.maatwerk_vorm_toeslag` gebruiken
      // zou de oude waarde bevriezen (bug t/m mig 244). Mig 465: vorm-
      // toeslag blijft WEL bewaard als metadata (voedt de VORMTOESLAG-
      // companion-regel hieronder), maar telt niet meer mee in `prijs` —
      // anders zou de regel-korting% er toch weer overheen gaan.
      if (merged.is_maatwerk && merged.maatwerk_m2_prijs && raaktMaatwerkPrijs) {
        const vormCode = merged.maatwerk_vorm ?? 'rechthoek'
        const oppervlak = berekenPrijsOppervlakM2(
          vormCode,
          merged.maatwerk_lengte_cm,
          merged.maatwerk_breedte_cm,
          merged.maatwerk_diameter_cm,
        )
        const omtrek = berekenOmtrekMeter(
          vormCode,
          merged.maatwerk_lengte_cm,
          merged.maatwerk_breedte_cm,
          merged.maatwerk_diameter_cm,
        )
        const vormToeslag = vormen.find((v) => v.code === vormCode)?.toeslag ?? 0
        const afwerking: AfwerkingTypeRow | undefined = merged.maatwerk_afwerking
          ? afwerkingen.find((a) => a.code === merged.maatwerk_afwerking)
          : undefined
        const afwerkingPrijs = afwerking ? omtrek * (afwerking.prijs_per_meter ?? 0) : 0

        merged.maatwerk_oppervlak_m2 = oppervlak
        merged.maatwerk_vorm_toeslag = vormToeslag
        merged.maatwerk_afwerking_prijs = afwerkingPrijs
        merged.prijs = oppervlak * merged.maatwerk_m2_prijs + afwerkingPrijs
      }

      merged.bedrag = calcBedrag(merged)
      return merged
    })

    // Mig 465: na elke wijziging die de prijs of het aantal raakt, de
    // VORMTOESLAG-companion-regel (toevoegen/bijwerken/verwijderen) in
    // lockstep houden met de maatwerk-regel op `index`.
    if (updated[index]?.is_maatwerk && (raaktMaatwerkPrijs || 'orderaantal' in updates)) {
      const vormCode = updated[index].maatwerk_vorm ?? 'rechthoek'
      const vormNaam = vormen.find((v) => v.code === vormCode)?.naam ?? vormCode
      updated = syncVormToeslagRegel(updated, index, vormNaam)
    }

    onChange(updated)
  }

  const removeLine = (index: number) => {
    if (!window.confirm('Weet je zeker dat je deze regel wilt verwijderen?')) return
    onChange(verwijderRegelMetCompanion(lines, index))
  }

  const addArticle = async (article: SelectedArticle, substitution?: SubstitutionInfo) => {
    let prijs = article.verkoopprijs
    let klant_eigen_naam: string | undefined
    let klant_artikelnr: string | undefined
    let prijs_bron: PrijsBron | undefined
    let prijs_breakdown: PrijsBreakdown | undefined

    if (onArticleSelected) {
      const result = await onArticleSelected(article)
      if (result.prijs !== null) {
        prijs = result.prijs
      }
      prijs_bron = result.prijs_bron
      prijs_breakdown = result.prijs_breakdown
      klant_eigen_naam = result.klant_eigen_naam ?? undefined
      klant_artikelnr = result.klant_artikelnr ?? undefined
    }

    // Als origineel niets oplevert (geen prijslijst, geen m²-fallback),
    // val terug op vervanger (omsticker-flow)
    const origineelHeeftPrijs = prijs_bron === 'prijslijst_vast'
      || prijs_bron === 'product_vaste_verkoopprijs'
      || prijs_bron === 'prijslijst_m2'
      || prijs_bron === 'maatwerk_artikel_m2'
      || prijs_bron === 'kwaliteit_m2'
    if (!origineelHeeftPrijs && substitution && onArticleSelected) {
      const fysiekArticle: SelectedArticle = {
        ...article,
        artikelnr: substitution.fysiek_artikelnr,
        kwaliteit_code: substitution.fysiek_kwaliteit_code,
        verkoopprijs: substitution.fysiek_verkoopprijs,
      }
      const fysiekResult = await onArticleSelected(fysiekArticle)
      if (fysiekResult.prijs !== null) {
        prijs = fysiekResult.prijs
        prijs_bron = fysiekResult.prijs_bron
        prijs_breakdown = fysiekResult.prijs_breakdown
      } else {
        prijs = substitution.fysiek_verkoopprijs
      }
    }

    const newLine: OrderRegelFormData = metProductVelden({
      artikelnr: article.artikelnr,
      karpi_code: article.karpi_code ?? undefined,
      // Bewaar de rijke product-omschrijving (incl. afmeting zoals
      // "MARICH Kleur 22 CA: 160x230 cm"). De klant-eigen kwaliteitsnaam
      // wordt apart als blauwe sub-tekst getoond én blijft beschikbaar in
      // `klant_eigen_naam` voor PDF/EDI-uitvoer.
      omschrijving: article.omschrijving,
      orderaantal: 1,
      te_leveren: 1,
      prijs: prijs ?? undefined,
      korting_pct: defaultKorting,
      gewicht_kg: article.gewicht_kg ?? undefined,
      bedrag: 0,
      klant_eigen_naam,
      klant_artikelnr,
      // Substitutie
      fysiek_artikelnr: substitution?.fysiek_artikelnr,
      fysiek_omschrijving: substitution?.fysiek_omschrijving,
      omstickeren: substitution?.omstickeren,
      // Maatwerk
      is_maatwerk: false,
      // Issue #35 / mig 191: prijs-bron + breakdown voor UI-hint
      prijs_uit_prijslijst: prijs_bron === 'prijslijst_vast',
      prijs_bron,
      prijs_breakdown,
    // Regel-input-contract: producten-display-velden via de gedeelde helper
    // (zelfde contract als de Order-hydratie). Substitution wint voor de
    // omsticker-flow.
    }, {
      vrije_voorraad: substitution ? substitution.fysiek_vrije_voorraad : article.vrije_voorraad,
      besteld_inkoop: article.besteld_inkoop,
    })
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

      {/* Artikel toevoegen */}
      <div className="px-5 py-3 border-b border-slate-100 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <KwaliteitFirstSelector
            defaultKorting={defaultKorting}
            prijslijstNr={prijslijstNr}
            debiteurNr={debiteurNr}
            onSelectArticle={addArticle}
            onAddMaatwerk={(newLines) => onChange([...lines, ...newLines])}
          />
        </div>
        <OverigeRegelToevoegen lines={lines} onChange={onChange} vormen={vormen} />
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
              {/* Nieuwste regel bovenaan tonen zodat een net toegevoegd artikel
                  direct onder de zoekbalk zichtbaar is en de invoerder niet hoeft
                  te scrollen (verzoek Marjon, 15-06-2026). We keren alléén de
                  wéérgave om — de `lines`-array blijft chronologisch, dus de
                  opgeslagen regelnummering (pakbon/factuur/order-detail) verandert
                  niet. `index` blijft de echte array-index zodat updateLine/
                  removeLine de juiste regel raken; `getKey(i)` houdt focus/state
                  per regel stabiel bij het herordenen. */}
              {lines
                .map((line, i) => ({ line, i }))
                .reverse()
                .map(({ line, i }) => (
                  <MaatwerkLineRow
                    key={getKey(i)}
                    line={line}
                    index={i}
                    updateLine={updateLine}
                    removeLine={removeLine}
                    vormen={vormen}
                    afwerkingen={afwerkingen}
                    isBestaandeOrder={isBestaandeOrder}
                  />
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
