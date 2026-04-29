import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Search, ChevronLeft, Plus } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import {
  searchKwaliteitenViaProducten,
  fetchKleurenVoorKwaliteit,
  fetchVormen,
  fetchAfwerkingTypes,
  fetchStandaardAfwerking,
  fetchAfwerkingVoorKleur,
  fetchStandaardBandKleur,
  fetchStandaardMatenVoorKwaliteit,
  fetchMaatwerkArtikelNr,
  fetchKwaliteitM2Prijs,
  type KwaliteitOptie,
  type KleurOptie,
} from '@/lib/supabase/queries/op-maat'
import { VormAfmetingSelector, type VormAfmetingData } from './vorm-afmeting-selector'
import { SubstitutionPicker } from './substitution-picker'
import {
  berekenPrijsOppervlakM2,
  berekenMaatwerkPrijs,
  berekenMaatwerkGewicht,
} from '@/lib/utils/maatwerk-prijs'
import { formatCurrency } from '@/lib/utils/formatters'
import type { SelectedArticle, SubstitutionInfo } from './article-selector'
import { lookupPrice } from '@/lib/supabase/queries/order-mutations'
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import type { EquivalentProduct } from '@/lib/supabase/queries/product-equivalents'

type Step = 'kwaliteit' | 'maten' | 'op_maat'

interface KwaliteitFirstSelectorProps {
  defaultKorting: number
  prijslijstNr?: string
  onSelectArticle: (article: SelectedArticle, substitution?: SubstitutionInfo) => void
  onAddMaatwerk: (line: OrderRegelFormData) => void
}

/** Normaliseert kleurcodes voor vergelijking: "11.0" → "11", "11" → "11" */
function normalizeKleur(code: string): string {
  return code.replace(/\.0$/, '').toLowerCase()
}

/** Parseert "Cisco 11" → { kwaliteitTerm: "Cisco", kleurHint: "11" } */
function parseSearch(input: string): { kwaliteitTerm: string; kleurHint: string } {
  const parts = input.trim().split(/\s+/)
  if (parts.length >= 2) {
    const last = parts[parts.length - 1]
    // Als het laatste woord een korte code is (kleurcode), splits
    if (last.length <= 6) {
      return {
        kwaliteitTerm: parts.slice(0, -1).join(' '),
        kleurHint: last,
      }
    }
  }
  return { kwaliteitTerm: input.trim(), kleurHint: '' }
}

export function KwaliteitFirstSelector({
  defaultKorting,
  prijslijstNr,
  onSelectArticle,
  onAddMaatwerk,
}: KwaliteitFirstSelectorProps) {
  const [step, setStep] = useState<Step>('kwaliteit')
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selectedKwaliteit, setSelectedKwaliteit] = useState<KwaliteitOptie | null>(null)
  const [selectedKleurCode, setSelectedKleurCode] = useState('')   // voor maten-filter EN op_maat
  const [selectedKleur, setSelectedKleur] = useState<KleurOptie | null>(null) // alleen op_maat
  const [kleurHint, setKleurHint] = useState('')                   // hint vanuit zoekveld
  const [pendingArticle, setPendingArticle] = useState<SelectedArticle | null>(null)
  const [klantM2Prijs, setKlantM2Prijs] = useState<number | null>(null)
  const [standaardBandKleur, setStandaardBandKleur] = useState<string | null>(null)

  // Op maat state
  const [vormData, setVormData] = useState<VormAfmetingData>({
    vormCode: '',
    lengteCm: undefined,
    breedteCm: undefined,
    diameterCm: undefined,
    afwerkingCode: '',
    bandKleur: '',
    instructies: '',
  })

  const searchRef = useRef<HTMLDivElement>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  // Debounce zoekterm voor server-side kwaliteiten zoekopdracht
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(t)
  }, [search])

  // ── Queries ──────────────────────────────────────────────────
  const { kwaliteitTerm: debouncedKwaliteitTerm } = useMemo(
    () => parseSearch(debouncedSearch),
    [debouncedSearch]
  )

  const { data: kwaliteiten = [], isLoading: kwaliteitenLoading } = useQuery({
    queryKey: ['kwaliteiten-search', debouncedKwaliteitTerm],
    queryFn: () => searchKwaliteitenViaProducten(debouncedKwaliteitTerm || ''),
    enabled: debouncedKwaliteitTerm.length >= 2,
    staleTime: 30_000,
  })

  const { data: standaardMaten = [], isLoading: matenLoading } = useQuery({
    queryKey: ['standaard-maten', selectedKwaliteit?.code],
    queryFn: () => fetchStandaardMatenVoorKwaliteit(selectedKwaliteit!.code),
    enabled: !!selectedKwaliteit,
  })

  const { data: kleuren = [], isLoading: kleurenLoading } = useQuery({
    queryKey: ['kleuren', selectedKwaliteit?.code],
    queryFn: () => fetchKleurenVoorKwaliteit(selectedKwaliteit!.code),
    enabled: !!selectedKwaliteit,
  })

  const { data: vormen = [] } = useQuery({
    queryKey: ['maatwerk-vormen'],
    queryFn: fetchVormen,
    enabled: step === 'op_maat',
  })

  const { data: afwerkingen = [] } = useQuery({
    queryKey: ['afwerking-types'],
    queryFn: fetchAfwerkingTypes,
    enabled: step === 'op_maat',
  })

  const { data: standaardAfwerking } = useQuery({
    queryKey: ['standaard-afwerking', selectedKwaliteit?.code, selectedKleur?.kleur_code],
    queryFn: async () => {
      const perKleur = selectedKleur
        ? await fetchAfwerkingVoorKleur(selectedKwaliteit!.code, selectedKleur.kleur_code)
        : null
      return perKleur ?? fetchStandaardAfwerking(selectedKwaliteit!.code)
    },
    enabled: !!selectedKwaliteit && step === 'op_maat',
  })

  // ── Auto-selecteer kleur vanuit kleurHint zodra kleuren geladen zijn ──
  useEffect(() => {
    if (!kleurHint || beschikbareKleuren.length === 0 || selectedKleurCode) return
    const hint = normalizeKleur(kleurHint)
    const match = beschikbareKleuren.find((k) => normalizeKleur(k.kleur_code) === hint || normalizeKleur(k.kleur_label) === hint)
    if (match) {
      setSelectedKleurCode(match.kleur_code)
      setSelectedKleur(match)
    }
  }, [kleuren, kleurHint, selectedKleurCode])

  // ── Zoekterm (live, voor hint-weergave) ──────────────────────
  const { kwaliteitTerm, kleurHint: parsedKleurHint } = useMemo(
    () => parseSearch(search),
    [search]
  )

  // Resultaten komen direct uit de server-query (al gefilterd)
  const filtered = kwaliteiten

  // ── Gefilterde maten ──────────────────────────────────────────
  const gefilterdeMatem = useMemo(() => {
    if (!selectedKleurCode) return standaardMaten
    const norm = normalizeKleur(selectedKleurCode)
    return standaardMaten.filter(
      (m) => m.kleur_code != null && normalizeKleur(m.kleur_code) === norm
    )
  }, [standaardMaten, selectedKleurCode])

  // ── Beschikbare kleuren: union van m²-geconfigureerde kleuren én kleuren die
  //    alleen als product bestaan (bv. VELV15MAATWERK zonder m²-prijs in DB).
  //    Zo kunnen ook kleuren zonder voorraad of m²-prijs geselecteerd worden.
  const beschikbareKleuren = useMemo((): KleurOptie[] => {
    const map = new Map<string, KleurOptie>()
    for (const k of kleuren) map.set(k.kleur_code, k)
    for (const m of standaardMaten) {
      if (m.kleur_code && !map.has(m.kleur_code)) {
        // Gebruik de prijs van het MAATWERK-product als basis m²-prijs fallback.
        const maatwerkProduct = standaardMaten.find(
          (s) => s.kleur_code === m.kleur_code &&
          (s.omschrijving?.toUpperCase().includes('MAATWERK') || s.karpi_code?.toUpperCase().includes('MAATWERK'))
        )
        map.set(m.kleur_code, {
          kleur_code: m.kleur_code,
          kleur_label: m.kleur_code.replace(/\.0$/, ''),
          omschrijving: '',
          verkoopprijs_m2: maatwerkProduct?.verkoopprijs ?? null,
          kostprijs_m2: null,
          gewicht_per_m2_kg: null,
          max_breedte_cm: null,
          artikelnr: maatwerkProduct?.artikelnr ?? null,
          karpi_code: maatwerkProduct?.karpi_code ?? null,
          aantal_rollen: 0,
          beschikbaar_m2: 0,
          totaal_m2: 0,
          equiv_rollen: 0,
          equiv_m2: 0,
          equiv_kwaliteit_code: null,
          equiv_artikelnr: null,
          equiv_m2_prijs: null,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.kleur_code.localeCompare(b.kleur_code))
  }, [kleuren, standaardMaten])

  const hasOpMaat = beschikbareKleuren.length > 0

  // ── Klantspecifieke m²-prijs ophalen uit prijslijst ──────────
  // Maatwerk heeft een apart artikel met 'maatwerk' in de omschrijving
  // (bijv. DANT23MAATWERK, LORA13MAATWERK). Zoek dat direct in de DB.
  const fetchKlantPrijs = useCallback(async (kleur: KleurOptie | null) => {
    if (!kleur || !selectedKwaliteit) {
      setKlantM2Prijs(null)
      return
    }
    // Zoek altijd eerst het kleur-specifieke maatwerk-artikel — die prijs is
    // autoritatiever dan de kwaliteitsbrede maatwerk_m2_prijzen-fallback.
    const maatwerkArtikelNr = await fetchMaatwerkArtikelNr(
      selectedKwaliteit.code,
      kleur.kleur_code,
    )
    const artikelnr = maatwerkArtikelNr ?? kleur.artikelnr
    console.log('[maatwerk prijs]', {
      kwaliteit: selectedKwaliteit.code,
      kleur: kleur.kleur_code,
      prijslijstNr,
      maatwerkArtikelNr,
      artikelnr,
    })

    // 1. Klant-prijslijst heeft voorrang (indien klant een prijslijst heeft)
    if (prijslijstNr && artikelnr) {
      const prijs = await lookupPrice(prijslijstNr, artikelnr)
      console.debug('[maatwerk prijs] prijslijst lookup:', { artikelnr, prijs })
      if (prijs != null) {
        setKlantM2Prijs(prijs)
        return
      }
    }

    // 2. Verkoopprijs van het kleur-specifieke maatwerk-artikel (bijv.
    //    VELV16MAATWERK €24,26). Dit dekt zowel klanten zonder prijslijst
    //    als klanten mét prijslijst waarin dit artikel ontbreekt.
    if (artikelnr) {
      const { data: prodData } = await supabase
        .from('producten')
        .select('verkoopprijs')
        .eq('artikelnr', artikelnr)
        .maybeSingle()
      if (prodData?.verkoopprijs != null) {
        console.debug('[maatwerk prijs] product verkoopprijs fallback:', prodData.verkoopprijs)
        setKlantM2Prijs(prodData.verkoopprijs)
        return
      }
    }

    // 3. Generieke kwaliteits-m²-prijs uit maatwerk_m2_prijzen (laatste redmiddel)
    const kwaliteitPrijs = await fetchKwaliteitM2Prijs(selectedKwaliteit.code)
    console.log('[maatwerk prijs] kwaliteit fallback:', kwaliteitPrijs)
    setKlantM2Prijs(kwaliteitPrijs)
  }, [prijslijstNr, selectedKwaliteit])

  useEffect(() => {
    setKlantM2Prijs(null)
    if (selectedKleur) {
      fetchKlantPrijs(selectedKleur).catch((e) => console.error('[maatwerk prijs] fout:', e))
    }
  }, [selectedKleur, fetchKlantPrijs])

  // Standaard bandkleur ophalen zodra kwaliteit + kleur bekend zijn
  useEffect(() => {
    setStandaardBandKleur(null)
    if (!selectedKwaliteit || !selectedKleur) return
    fetchStandaardBandKleur(selectedKwaliteit.code, selectedKleur.kleur_code)
      .then((r) => {
        console.log('[bandkleur]', selectedKwaliteit.code, selectedKleur.kleur_code, r)
        setStandaardBandKleur(r ? [r.band_merk ?? 'Piero', r.band_omschrijving, r.band_kleur].filter(Boolean).join(' ') : null)
      })
      .catch((e) => console.error('[bandkleur error]', e))
  }, [selectedKwaliteit, selectedKleur])

  // Uitwisselbaar-modus: eigen kleur heeft geen rollen maar een uitwisselbare
  // kwaliteit wel. Factuur behoudt de bestelde kwaliteit (omstickeer-model),
  // snijplan pakt fysiek de uitwisselbare rol.
  const gebruiktUitwisselbaar =
    !!selectedKleur &&
    selectedKleur.aantal_rollen === 0 &&
    (selectedKleur.equiv_rollen ?? 0) > 0 &&
    !!selectedKleur.equiv_kwaliteit_code

  // Effectieve m²-prijs: klantprijs uit prijslijst heeft prioriteit; valt
  // terug op maatwerk_m2_prijzen van de uitwisselbare (bij swap) of van de
  // eigen kleur.
  const effectieveM2Prijs =
    klantM2Prijs
    ?? (gebruiktUitwisselbaar ? (selectedKleur?.equiv_m2_prijs ?? 0) : (selectedKleur?.verkoopprijs_m2 ?? 0))

  // ── Op maat prijsberekeningen ─────────────────────────────────
  const selectedVorm = vormen.find((v) => v.code === vormData.vormCode)
  const isDiameter = selectedVorm?.afmeting_type === 'diameter'
  const selectedAfwerking = afwerkingen.find((a) => a.code === vormData.afwerkingCode)

  const oppervlakM2 = useMemo(
    () => berekenPrijsOppervlakM2(vormData.vormCode, vormData.lengteCm, vormData.breedteCm, vormData.diameterCm),
    [vormData]
  )
  const vormToeslag = selectedVorm?.toeslag ?? 0
  const afwerkingPrijs = selectedAfwerking?.prijs ?? 0

  const totaalPrijs = useMemo(
    () =>
      berekenMaatwerkPrijs({
        oppervlakM2,
        m2Prijs: effectieveM2Prijs,
        vormToeslag,
        afwerkingPrijs,
        korting_pct: defaultKorting,
      }),
    [oppervlakM2, effectieveM2Prijs, vormToeslag, afwerkingPrijs, defaultKorting]
  )

  const canAdd = !!selectedKleur && effectieveM2Prijs > 0 && oppervlakM2 > 0

  // ── Click outside ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Handlers ──────────────────────────────────────────────────
  function handleKwaliteitSelect(k: KwaliteitOptie) {
    setSelectedKwaliteit(k)
    setKleurHint(parsedKleurHint)
    setSearch('')
    setSearchOpen(false)
    setStep('maten')
  }

  function handleKleurFilter(kleurCode: string) {
    setSelectedKleurCode(kleurCode)
    // Bij op maat ook de KleurOptie bijhouden
    setSelectedKleur(beschikbareKleuren.find((k) => k.kleur_code === kleurCode) ?? null)
  }

  function handleMaatClick(maat: typeof standaardMaten[0]) {
    const article: SelectedArticle = {
      artikelnr: maat.artikelnr,
      karpi_code: maat.karpi_code,
      omschrijving: maat.omschrijving,
      verkoopprijs: maat.verkoopprijs,
      gewicht_kg: maat.gewicht_kg,
      vrije_voorraad: maat.vrije_voorraad,
      besteld_inkoop: maat.besteld_inkoop,
      kwaliteit_code: maat.kwaliteit_code,
      product_type: maat.product_type,
    }
    if (maat.vrije_voorraad <= 0) {
      setPendingArticle(article)
    } else {
      onSelectArticle(article)
      handleReset()
    }
  }

  function handleSubstitutionSelect(equivalent: EquivalentProduct) {
    if (!pendingArticle) return
    onSelectArticle(pendingArticle, {
      fysiek_artikelnr: equivalent.artikelnr,
      fysiek_omschrijving: equivalent.omschrijving,
      fysiek_karpi_code: equivalent.karpi_code,
      fysiek_kwaliteit_code: equivalent.kwaliteit_code,
      fysiek_vrije_voorraad: equivalent.vrije_voorraad,
      fysiek_verkoopprijs: equivalent.verkoopprijs,
      omstickeren: true,
    })
    setPendingArticle(null)
    handleReset()
  }

  function handleOpMaatClick() {
    // Kleur is al geselecteerd via het filter → meteen naar op_maat
    if (selectedKleurCode) {
      setSelectedKleur(beschikbareKleuren.find((k) => k.kleur_code === selectedKleurCode) ?? null)
    }
    setStep('op_maat')
  }

  function handleAdd() {
    if (!canAdd || !selectedKleur || !selectedKwaliteit) return
    const totalRollen = selectedKleur.aantal_rollen + selectedKleur.equiv_rollen
    // Bij swap: factuur toont bestelde kwaliteit; intern wijst fysiek_artikelnr
    // naar de MAATWERK-artikelref van de uitwisselbare kwaliteit zodat snijplan/
    // voorraadreservering op de juiste rol landt (omstickeer-model).
    const line: OrderRegelFormData = {
      artikelnr: selectedKleur.artikelnr ?? undefined,
      karpi_code: selectedKleur.karpi_code ?? `${selectedKwaliteit.code}${selectedKleur.kleur_code}`,
      omschrijving: `${selectedKwaliteit.omschrijving ?? selectedKwaliteit.code} ${selectedKleur.kleur_label} - Op maat ${selectedVorm?.naam ?? vormData.vormCode}`,
      orderaantal: 1,
      te_leveren: 1,
      prijs: oppervlakM2 * effectieveM2Prijs + vormToeslag + afwerkingPrijs,
      korting_pct: defaultKorting,
      bedrag: totaalPrijs,
      gewicht_kg: berekenMaatwerkGewicht(oppervlakM2, selectedKleur.gewicht_per_m2_kg),
      vrije_voorraad: totalRollen,
      besteld_inkoop: selectedKleur.equiv_rollen > 0 ? selectedKleur.equiv_rollen : 0,
      fysiek_artikelnr: gebruiktUitwisselbaar ? (selectedKleur.equiv_artikelnr ?? undefined) : undefined,
      fysiek_omschrijving: gebruiktUitwisselbaar && selectedKleur.equiv_kwaliteit_code
        ? `${selectedKleur.equiv_kwaliteit_code} ${selectedKleur.kleur_label} MAATWERK`
        : undefined,
      omstickeren: gebruiktUitwisselbaar ? true : undefined,
      is_maatwerk: true,
      maatwerk_vorm: vormData.vormCode,
      maatwerk_lengte_cm: isDiameter ? vormData.diameterCm : vormData.lengteCm,
      maatwerk_breedte_cm: isDiameter ? vormData.diameterCm : vormData.breedteCm,
      maatwerk_diameter_cm: isDiameter ? vormData.diameterCm : undefined,
      maatwerk_afwerking: vormData.afwerkingCode || undefined,
      maatwerk_band_kleur: vormData.bandKleur || undefined,
      maatwerk_instructies: vormData.instructies || undefined,
      maatwerk_m2_prijs: effectieveM2Prijs,
      maatwerk_kostprijs_m2: selectedKleur.kostprijs_m2 ?? undefined,
      maatwerk_oppervlak_m2: oppervlakM2,
      maatwerk_vorm_toeslag: vormToeslag,
      maatwerk_afwerking_prijs: afwerkingPrijs,
      maatwerk_kwaliteit_code: selectedKwaliteit.code,
      maatwerk_kleur_code: selectedKleur.kleur_code,
      maatwerk_beschikbaar_m2: selectedKleur.beschikbaar_m2,
      maatwerk_equiv_m2: selectedKleur.equiv_m2,
    }
    onAddMaatwerk(line)
    handleReset()
  }

  function handleReset() {
    setStep('kwaliteit')
    setSelectedKwaliteit(null)
    setSearch('')
    setSearchOpen(false)
    setSelectedKleurCode('')
    setSelectedKleur(null)
    setKleurHint('')
    setPendingArticle(null)
    setKlantM2Prijs(null)
    setStandaardBandKleur(null)
  }

  if (kwaliteitenLoading) {
    return <div className="text-sm text-slate-400 py-2">Laden...</div>
  }

  // ── Stap 1: Kwaliteit zoeken ──────────────────────────────────
  if (step === 'kwaliteit') {
    return (
      <div ref={searchRef} className="relative">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Zoek kwaliteit, bijv. Cisco of Cisco 11..."
            className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>

        {searchOpen && kwaliteitenLoading && kwaliteitTerm.length >= 2 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg p-3 text-sm text-slate-400">
            Zoeken...
          </div>
        )}

        {searchOpen && !kwaliteitenLoading && debouncedKwaliteitTerm.length >= 2 && filtered.length === 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg p-3 text-sm text-slate-400">
            Geen kwaliteiten gevonden voor "{debouncedKwaliteitTerm}"
          </div>
        )}

        {searchOpen && filtered.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg max-h-60 overflow-y-auto">
            {filtered.map((k) => (
              <button
                key={k.code}
                type="button"
                onClick={() => handleKwaliteitSelect(k)}
                className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0"
              >
                <span className="font-mono text-xs text-terracotta-500">{k.code}</span>
                <span className="ml-2">{k.omschrijving}</span>
                {parsedKleurHint && (
                  <span className="ml-2 text-xs text-slate-400">→ kleur {parsedKleurHint}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Stap 2: Standaard maten (+ kleurfilter) ───────────────────
  if (step === 'maten') {
    return (
      <div className="space-y-2">
        {/* Header */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleReset} className="text-slate-400 hover:text-slate-600 transition-colors">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-medium">
            <span className="font-mono text-xs text-terracotta-500 mr-1">{selectedKwaliteit?.code}</span>
            {selectedKwaliteit?.omschrijving}
          </span>
        </div>

        {/* Kleurfilter (chips) */}
        {beschikbareKleuren.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => handleKleurFilter('')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                !selectedKleurCode
                  ? 'bg-terracotta-500 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Alle
            </button>
            {beschikbareKleuren.map((k) => (
              <button
                key={k.kleur_code}
                type="button"
                onClick={() => handleKleurFilter(k.kleur_code)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  selectedKleurCode === k.kleur_code
                    ? 'bg-terracotta-500 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {k.kleur_label}
              </button>
            ))}
          </div>
        )}

        {/* Maten lijst */}
        {matenLoading ? (
          <div className="text-sm text-slate-400 py-2">Laden...</div>
        ) : (
          <div className="border border-slate-200 rounded-[var(--radius-sm)] divide-y divide-slate-100 overflow-hidden">
            {gefilterdeMatem.length === 0 && !hasOpMaat && (
              <div className="px-4 py-3 text-sm text-slate-400">Geen maten beschikbaar</div>
            )}

            {gefilterdeMatem.map((maat) => (
              <button
                key={maat.artikelnr}
                type="button"
                onClick={() => handleMaatClick(maat)}
                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-mono text-xs text-slate-400">{maat.artikelnr}</span>
                    <span className="ml-2 text-sm">{maat.omschrijving}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs shrink-0">
                    {maat.verkoopprijs != null && (
                      <span className="text-slate-600 font-medium">{formatCurrency(maat.verkoopprijs)}</span>
                    )}
                    <span className={maat.vrije_voorraad > 0 ? 'text-emerald-600' : 'text-rose-500'}>
                      Vrij: {maat.vrije_voorraad}
                    </span>
                    {maat.besteld_inkoop > 0 && (
                      <span className="text-slate-400">+{maat.besteld_inkoop}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}

            {/* Op maat optie */}
            {hasOpMaat && (() => {
              const opMaatKleur = selectedKleurCode
                ? beschikbareKleuren.find((k) => k.kleur_code === selectedKleurCode)
                : null
              // totaal_m2 bestaat na migratie 049; vóór migratie: fallback op beschikbaar_m2
              const displayM2 = opMaatKleur
                ? (opMaatKleur.totaal_m2 ?? opMaatKleur.beschikbaar_m2 ?? 0)
                : null
              const aantalRollen = opMaatKleur
                ? opMaatKleur.aantal_rollen + opMaatKleur.equiv_rollen
                : null
              return (
                <button
                  type="button"
                  onClick={handleOpMaatClick}
                  className="w-full text-left px-4 py-2.5 hover:bg-purple-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-purple-700">Op maat</span>
                      <span className="text-xs text-purple-400">
                        {opMaatKleur
                          ? `Kleur ${opMaatKleur.kleur_label} — kies afmeting en afwerking`
                          : 'Kies kleur, afmeting en afwerking'}
                      </span>
                    </div>
                    {opMaatKleur && displayM2 != null && (
                      <div className="flex items-center gap-2 text-xs shrink-0">
                        {aantalRollen != null && (
                          <span className="text-slate-500">
                            {aantalRollen} rol{aantalRollen !== 1 ? 'len' : ''}
                          </span>
                        )}
                        <span className={(displayM2) > 0 ? 'text-emerald-600' : 'text-rose-500'}>
                          {displayM2} m²
                        </span>
                        {opMaatKleur.beschikbaar_m2 < (opMaatKleur.totaal_m2 ?? opMaatKleur.beschikbaar_m2) && (
                          <span className="text-slate-400" title="Vrij — niet in snijplan">
                            vrij: {opMaatKleur.beschikbaar_m2} m²
                          </span>
                        )}
                        {(opMaatKleur.equiv_m2 ?? 0) > 0 && (
                          <span className="text-slate-400" title="Uitwisselbare kwaliteiten">
                            +{opMaatKleur.equiv_m2} m²
                          </span>
                        )}
                        <span className="text-slate-400">
                          {opMaatKleur.verkoopprijs_m2 != null ? `${formatCurrency(opMaatKleur.verkoopprijs_m2)}/m²` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                </button>
              )
            })()}
          </div>
        )}

        {/* Substitution picker bij geen voorraad */}
        {pendingArticle && (
          <SubstitutionPicker
            artikelnr={pendingArticle.artikelnr}
            omschrijving={pendingArticle.omschrijving}
            onSelect={handleSubstitutionSelect}
            onSkip={() => {
              onSelectArticle(pendingArticle)
              setPendingArticle(null)
              handleReset()
            }}
          />
        )}
      </div>
    )
  }

  // ── Stap 3: Op maat ──────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setStep('maten')} className="text-slate-400 hover:text-slate-600 transition-colors">
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium">
          Op maat —{' '}
          <span className="font-mono text-xs text-terracotta-500">{selectedKwaliteit?.code}</span>{' '}
          {selectedKwaliteit?.omschrijving}
        </span>
      </div>

      {/* Kleur kiezen */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Kleur</label>
        <select
          value={selectedKleurCode}
          onChange={(e) => handleKleurFilter(e.target.value)}
          disabled={kleurenLoading}
          className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400/30 focus:border-purple-400 disabled:bg-slate-100 disabled:text-slate-400"
        >
          <option value="">
            {kleurenLoading ? 'Laden...' : `Selecteer een kleur (${beschikbareKleuren.length} beschikbaar)`}
          </option>
          {beschikbareKleuren.map((k) => {
            const heeftEquiv = (k.equiv_rollen ?? 0) > 0
            const prijs = k.verkoopprijs_m2 ?? (k.aantal_rollen === 0 && heeftEquiv ? k.equiv_m2_prijs : null)
            return (
              <option key={k.kleur_code} value={k.kleur_code}>
                {k.kleur_label} — {k.omschrijving}
                {' | '}{prijs != null ? formatCurrency(prijs) : '—'}/m²
                {' | '}{(k.totaal_m2 ?? k.beschikbaar_m2 ?? 0)} m² totaal
                {k.beschikbaar_m2 < (k.totaal_m2 ?? k.beschikbaar_m2) ? ` (vrij: ${k.beschikbaar_m2} m²)` : ''}
                {heeftEquiv ? ` +${k.equiv_m2} m² via ${k.equiv_kwaliteit_code}` : ''}
              </option>
            )
          })}
        </select>
      </div>

      {/* Banner: uitwisselbare rol wordt gebruikt (omstickeer-model) */}
      {gebruiktUitwisselbaar && selectedKleur && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] text-sm">
          <div className="font-medium text-amber-800">
            {selectedKwaliteit?.code} {selectedKleur.kleur_label} heeft geen eigen voorraad — wordt gesneden uit {selectedKleur.equiv_kwaliteit_code} {selectedKleur.kleur_label}
          </div>
          <div className="text-xs text-amber-700 mt-0.5">
            {selectedKleur.equiv_rollen} rol{selectedKleur.equiv_rollen !== 1 ? 'len' : ''} · {selectedKleur.equiv_m2} m² beschikbaar · factuur toont bestelde kwaliteit ({selectedKwaliteit?.code})
          </div>
        </div>
      )}

      {/* Vorm + afmeting (alleen na kleurkeuze) */}
      {selectedKleur && (
        <>
          <div className="pt-2 border-t border-slate-100">
            <VormAfmetingSelector
              vormen={vormen}
              afwerkingen={afwerkingen}
              standaardAfwerking={standaardAfwerking ?? null}
              standaardBandKleur={standaardBandKleur}
              maxBreedteCm={selectedKleur.max_breedte_cm}
              onChange={setVormData}
            />
          </div>

          {/* Prijsbalk + toevoegen */}
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-purple-50 rounded-[var(--radius-sm)]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-purple-900">
              <span>
                {oppervlakM2.toLocaleString('nl-NL', { maximumFractionDigits: 2 })} m²
                {' '}× {formatCurrency(effectieveM2Prijs)}/m²
              </span>
              {vormToeslag > 0 && <span>+ {formatCurrency(vormToeslag)} (vorm)</span>}
              {afwerkingPrijs > 0 && <span>+ {formatCurrency(afwerkingPrijs)} (afwerking)</span>}
              {defaultKorting > 0 && <span>− {defaultKorting}% korting</span>}
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
