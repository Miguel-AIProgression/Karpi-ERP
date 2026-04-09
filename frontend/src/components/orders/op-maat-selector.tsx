import { useReducer, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import {
  KwaliteitKleurSelector,
  type KwaliteitKleurData,
} from './kwaliteit-kleur-selector'
import {
  VormAfmetingSelector,
  type VormAfmetingData,
} from './vorm-afmeting-selector'
import {
  fetchVormen,
  fetchAfwerkingTypes,
  fetchStandaardAfwerking,
} from '@/lib/supabase/queries/op-maat'
import {
  berekenPrijsOppervlakM2,
  berekenMaatwerkPrijs,
  berekenMaatwerkGewicht,
} from '@/lib/utils/maatwerk-prijs'
import { formatCurrency } from '@/lib/utils/formatters'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'

// ─── State & Actions ────────────────────────────────────────────

interface OpMaatState {
  // Kwaliteit + kleur (stap 1)
  kwaliteitCode: string
  kwaliteitNaam: string
  kleurCode: string
  kleurLabel: string
  kleurOmschrijving: string
  verkoopprijsM2: number
  kostprijsM2: number | null
  gewichtPerM2Kg: number | null
  maxBreedteCm: number | null
  artikelnr: string | null
  karpiCode: string | null
  aantalRollen: number
  beschikbaarM2: number
  equivRollen: number
  equivM2: number
  // Vorm + afmeting (stap 2)
  vormCode: string
  lengteCm?: number
  breedteCm?: number
  diameterCm?: number
  afwerkingCode: string
  bandKleur: string
  instructies: string
  // UI state
  step: 'kwaliteit_kleur' | 'vorm_afmeting'
}

type OpMaatAction =
  | { type: 'KWALITEIT_KLEUR_SELECTED'; payload: KwaliteitKleurData }
  | { type: 'VORM_AFMETING_CHANGED'; payload: VormAfmetingData }
  | { type: 'RESET' }

const initialState: OpMaatState = {
  kwaliteitCode: '',
  kwaliteitNaam: '',
  kleurCode: '',
  kleurLabel: '',
  kleurOmschrijving: '',
  verkoopprijsM2: 0,
  kostprijsM2: null,
  gewichtPerM2Kg: null,
  maxBreedteCm: null,
  artikelnr: null,
  karpiCode: null,
  aantalRollen: 0,
  beschikbaarM2: 0,
  equivRollen: 0,
  equivM2: 0,
  vormCode: '',
  lengteCm: undefined,
  breedteCm: undefined,
  diameterCm: undefined,
  afwerkingCode: '',
  bandKleur: '',
  instructies: '',
  step: 'kwaliteit_kleur',
}

function reducer(state: OpMaatState, action: OpMaatAction): OpMaatState {
  switch (action.type) {
    case 'KWALITEIT_KLEUR_SELECTED':
      return {
        ...state,
        kwaliteitCode: action.payload.kwaliteitCode,
        kwaliteitNaam: action.payload.kwaliteitNaam,
        kleurCode: action.payload.kleurCode,
        kleurLabel: action.payload.kleurLabel,
        kleurOmschrijving: action.payload.kleurOmschrijving,
        verkoopprijsM2: action.payload.verkoopprijsM2,
        kostprijsM2: action.payload.kostprijsM2,
        gewichtPerM2Kg: action.payload.gewichtPerM2Kg,
        maxBreedteCm: action.payload.maxBreedteCm,
        artikelnr: action.payload.artikelnr,
        karpiCode: action.payload.karpiCode,
        aantalRollen: action.payload.aantalRollen,
        beschikbaarM2: action.payload.beschikbaarM2,
        equivRollen: action.payload.equivRollen,
        equivM2: action.payload.equivM2,
        step: 'vorm_afmeting',
      }
    case 'VORM_AFMETING_CHANGED':
      return {
        ...state,
        vormCode: action.payload.vormCode,
        lengteCm: action.payload.lengteCm,
        breedteCm: action.payload.breedteCm,
        diameterCm: action.payload.diameterCm,
        afwerkingCode: action.payload.afwerkingCode,
        bandKleur: action.payload.bandKleur,
        instructies: action.payload.instructies,
      }
    case 'RESET':
      return { ...initialState }
    default:
      return state
  }
}

// ─── Props ──────────────────────────────────────────────────────

interface OpMaatSelectorProps {
  defaultKorting: number
  onAdd: (line: OrderRegelFormData) => void
}

// ─── Component ──────────────────────────────────────────────────

export function OpMaatSelector({ defaultKorting, onAdd }: OpMaatSelectorProps) {
  const [state, dispatch] = useReducer(reducer, initialState)

  // Queries
  const { data: vormen = [] } = useQuery({
    queryKey: ['maatwerk-vormen'],
    queryFn: fetchVormen,
  })
  const { data: afwerkingen = [] } = useQuery({
    queryKey: ['afwerking-types'],
    queryFn: fetchAfwerkingTypes,
  })
  const { data: standaardAfwerking } = useQuery({
    queryKey: ['standaard-afwerking', state.kwaliteitCode],
    queryFn: () => fetchStandaardAfwerking(state.kwaliteitCode),
    enabled: !!state.kwaliteitCode,
  })

  // Afgeleide berekeningen
  const selectedVorm = vormen.find((v) => v.code === state.vormCode)
  const isDiameter = selectedVorm?.afmeting_type === 'diameter'
  const selectedAfwerking = afwerkingen.find((a) => a.code === state.afwerkingCode)

  const oppervlakM2 = useMemo(
    () => berekenPrijsOppervlakM2(state.vormCode, state.lengteCm, state.breedteCm, state.diameterCm),
    [state.vormCode, state.lengteCm, state.breedteCm, state.diameterCm]
  )

  const vormToeslag = selectedVorm?.toeslag ?? 0
  const afwerkingPrijs = selectedAfwerking?.prijs ?? 0

  const totaalPrijs = useMemo(
    () =>
      berekenMaatwerkPrijs({
        oppervlakM2,
        m2Prijs: state.verkoopprijsM2,
        vormToeslag,
        afwerkingPrijs,
        korting_pct: defaultKorting,
      }),
    [oppervlakM2, state.verkoopprijsM2, vormToeslag, afwerkingPrijs, defaultKorting]
  )

  const canAdd =
    state.kwaliteitCode !== '' &&
    state.kleurCode !== '' &&
    state.verkoopprijsM2 > 0 &&
    oppervlakM2 > 0

  function handleAdd() {
    if (!canAdd) return

    const totalRollen = state.aantalRollen + state.equivRollen

    const line: OrderRegelFormData = {
      artikelnr: state.artikelnr ?? undefined,
      karpi_code: state.karpiCode ?? `${state.kwaliteitCode}${state.kleurCode}`,
      omschrijving: `${state.kwaliteitNaam} ${state.kleurLabel} - Op maat ${selectedVorm?.naam ?? state.vormCode}`,
      orderaantal: 1,
      te_leveren: 1,
      prijs: oppervlakM2 * state.verkoopprijsM2 + vormToeslag + afwerkingPrijs,
      korting_pct: defaultKorting,
      bedrag: totaalPrijs,
      gewicht_kg: berekenMaatwerkGewicht(oppervlakM2, state.gewichtPerM2Kg),
      vrije_voorraad: totalRollen,
      besteld_inkoop: state.equivRollen > 0 ? state.equivRollen : 0,
      is_maatwerk: true,
      maatwerk_vorm: state.vormCode,
      maatwerk_lengte_cm: isDiameter ? state.diameterCm : state.lengteCm,
      maatwerk_breedte_cm: isDiameter ? state.diameterCm : state.breedteCm,
      maatwerk_diameter_cm: isDiameter ? state.diameterCm : undefined,
      maatwerk_afwerking: state.afwerkingCode || undefined,
      maatwerk_band_kleur: state.bandKleur || undefined,
      maatwerk_instructies: state.instructies || undefined,
      maatwerk_m2_prijs: state.verkoopprijsM2,
      maatwerk_kostprijs_m2: state.kostprijsM2 ?? undefined,
      maatwerk_oppervlak_m2: oppervlakM2,
      maatwerk_vorm_toeslag: vormToeslag,
      maatwerk_afwerking_prijs: afwerkingPrijs,
      maatwerk_kwaliteit_code: state.kwaliteitCode,
      maatwerk_kleur_code: state.kleurCode,
      maatwerk_beschikbaar_m2: state.beschikbaarM2,
      maatwerk_equiv_m2: state.equivM2,
    }

    onAdd(line)
    dispatch({ type: 'RESET' })
  }

  return (
    <div className="space-y-4">
      {/* Stap 1: Kwaliteit + Kleur */}
      <KwaliteitKleurSelector
        onSelect={(data) => dispatch({ type: 'KWALITEIT_KLEUR_SELECTED', payload: data })}
      />

      {/* Stap 2: Vorm + Afmeting + Afwerking (alleen als kwaliteit geselecteerd) */}
      {state.step === 'vorm_afmeting' && (
        <>
          <div className="pt-2 border-t border-slate-100">
            <VormAfmetingSelector
              vormen={vormen}
              afwerkingen={afwerkingen}
              standaardAfwerking={standaardAfwerking ?? null}
              maxBreedteCm={state.maxBreedteCm}
              onChange={(data) => dispatch({ type: 'VORM_AFMETING_CHANGED', payload: data })}
            />
          </div>

          {/* Prijsoverzicht balk */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-purple-50 rounded-[var(--radius-sm)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-purple-900">
              <span>
                {oppervlakM2.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} m²
                {' '}x {formatCurrency(state.verkoopprijsM2)}/m²
              </span>
              {vormToeslag > 0 && (
                <span>+ {formatCurrency(vormToeslag)} (vorm)</span>
              )}
              {afwerkingPrijs > 0 && (
                <span>+ {formatCurrency(afwerkingPrijs)} (afwerking)</span>
              )}
              {defaultKorting > 0 && (
                <span>- {defaultKorting}% korting</span>
              )}
              <span className="font-semibold">= {formatCurrency(totaalPrijs)}</span>
            </div>

            <button
              type="button"
              disabled={!canAdd}
              onClick={handleAdd}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-[var(--radius-sm)] hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Plus size={16} />
              Toevoegen
            </button>
          </div>
        </>
      )}
    </div>
  )
}
