import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { useProducten, useMaatwerkVormen } from '@/hooks/use-producten'
import { useActieveAfwerkingKleuren } from '@/hooks/use-afwerking-kleuren'
import {
  fetchAfwerkingTypes,
  fetchStandaardAfwerking,
  fetchBandDefaultsVoorKwaliteit,
  fetchMaatwerkKleurenVoorKwaliteit,
  setBandKleurDefault,
} from '@/modules/maatwerk'
import { ProductRow } from './product-row'
import type { ProductType } from '@/lib/supabase/queries/producten'

const COL_COUNT = 11

interface Props {
  kwaliteitCode: string
  productType: ProductType | 'alle'
}

export function KwaliteitKleurenUitvouw({ kwaliteitCode, productType }: Props) {
  const qc = useQueryClient()
  const { data: producten, isLoading: prodLoading } = useProducten({
    kwaliteitCode,
    productType,
    pageSize: 1000,
    sortBy: 'omschrijving',
    sortDir: 'asc',
  })
  const { data: afwerkingen } = useQuery({
    queryKey: ['afwerking-types', 'actief'],
    queryFn: fetchAfwerkingTypes,
    staleTime: 5 * 60 * 1000,
  })
  const { data: standaardAfw } = useQuery({
    queryKey: ['standaard-afwerking', kwaliteitCode],
    queryFn: () => fetchStandaardAfwerking(kwaliteitCode),
  })
  const { data: bandDefaults } = useQuery({
    queryKey: ['band-defaults', kwaliteitCode],
    queryFn: () => fetchBandDefaultsVoorKwaliteit(kwaliteitCode),
  })
  const { data: maatwerkKleuren } = useQuery({
    queryKey: ['maatwerk-kleuren', kwaliteitCode],
    queryFn: () => fetchMaatwerkKleurenVoorKwaliteit(kwaliteitCode),
    staleTime: 5 * 60 * 1000,
  })

  const [savingKleur, setSavingKleur] = useState<string | null>(null)
  const [errorPerKleur, setErrorPerKleur] = useState<Record<string, string>>({})

  const setBandMut = useMutation({
    mutationFn: ({ kleur, kleurId }: { kleur: string; kleurId: number | null }) =>
      setBandKleurDefault(kwaliteitCode, kleur, kleurId),
    onMutate: ({ kleur }) => {
      setSavingKleur(kleur)
      setErrorPerKleur((m) => { const { [kleur]: _, ...rest } = m; return rest })
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['band-defaults', kwaliteitCode] })
      if (savingKleur === vars.kleur) setSavingKleur(null)
    },
    onError: (err, vars) => {
      const msg = err instanceof Error ? err.message : 'Opslaan mislukt'
      setErrorPerKleur((m) => ({ ...m, [vars.kleur]: msg }))
      if (savingKleur === vars.kleur) setSavingKleur(null)
    },
  })

  // Aggregeer kleuren uit producten — distinct kleur_code, met representatieve omschrijving uit bandDefaults
  const kleuren = useMemo(() => {
    const list = producten?.producten ?? []
    const map = new Map<string, { code: string; aantal: number; band_omschrijving: string | null }>()
    for (const p of list) {
      if (!p.kleur_code) continue
      const k = p.kleur_code
      if (!map.has(k)) {
        const bd = (bandDefaults ?? []).find((b) => b.kleur_code === k || b.kleur_code === k.replace(/\.0$/, ''))
        map.set(k, { code: k, aantal: 0, band_omschrijving: bd?.band_omschrijving ?? null })
      }
      map.get(k)!.aantal++
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
  }, [producten, bandDefaults])

  const huidigeAfw = standaardAfw ?? ''
  const heeftBandKleur = !!afwerkingen?.find((a) => a.code === huidigeAfw)?.heeft_band_kleur

  return (
    <tr className="bg-slate-50/60">
      <td colSpan={COL_COUNT} className="px-0 py-0">
        {!huidigeAfw && (
          <div className="px-8 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
            Geen afwerking ingesteld — bandkleur kan pas gekozen worden zodra je in de kwaliteit-rij hierboven een afwerking kiest.
          </div>
        )}

        {prodLoading ? (
          <div className="px-8 py-3 text-sm text-slate-400">Producten laden…</div>
        ) : kleuren.length === 0 ? (
          <div className="px-8 py-3 text-sm text-slate-400">Geen kleuren in deze kwaliteit voor de filter.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-white/40">
                <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs pl-12 w-32">Kleur</th>
                <th className="text-left px-4 py-2 font-medium text-slate-500 text-xs">Bandkleur (default)</th>
                <th className="text-right px-4 py-2 font-medium text-slate-500 text-xs w-24">Artikels</th>
              </tr>
            </thead>
            <tbody>
              {kleuren.map((k) => {
                const isMaatwerkKleur = maatwerkKleuren?.has(k.code) ?? maatwerkKleuren?.has(k.code.replace(/\.0$/, '')) ?? false
                const bandFK = (bandDefaults ?? []).find((b) => b.kleur_code === k.code || b.kleur_code === k.code.replace(/\.0$/, ''))?.afwerking_kleur_id ?? null
                return (
                  <KleurRow
                    key={k.code}
                    kwaliteitCode={kwaliteitCode}
                    kleur={k}
                    heeftBandKleur={heeftBandKleur}
                    afwerkingCode={huidigeAfw || null}
                    bandDefaultId={bandFK}
                    productType={productType}
                    onChangeBandKleur={(kleurId) => setBandMut.mutate({ kleur: k.code, kleurId })}
                    saving={savingKleur === k.code}
                    errorMsg={errorPerKleur[k.code] ?? null}
                    isMaatwerkKleur={isMaatwerkKleur}
                  />
                )
              })}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  )
}

interface KleurRowProps {
  kwaliteitCode: string
  kleur: { code: string; aantal: number; band_omschrijving: string | null }
  heeftBandKleur: boolean
  afwerkingCode: string | null
  bandDefaultId: number | null
  productType: ProductType | 'alle'
  onChangeBandKleur: (kleurId: number | null) => void
  saving: boolean
  errorMsg: string | null
  isMaatwerkKleur: boolean
}

function KleurRow({
  kwaliteitCode,
  kleur,
  heeftBandKleur,
  afwerkingCode,
  bandDefaultId,
  productType,
  onChangeBandKleur,
  saving,
  errorMsg,
  isMaatwerkKleur,
}: KleurRowProps) {
  const [expanded, setExpanded] = useState(false)
  const { data: kleurOpties } = useActieveAfwerkingKleuren(heeftBandKleur ? afwerkingCode : null)

  return (
    <Fragment>
      <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded((e) => !e)}>
        <td className="px-4 py-2 pl-12">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
              {kleur.code}
            </span>
            {kleur.band_omschrijving && (
              <span className="text-xs text-slate-500 italic">{kleur.band_omschrijving}</span>
            )}
          </div>
        </td>
        <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
          {!isMaatwerkKleur ? (
            <span className="text-xs text-slate-300" title="Geen maatwerk-product voor deze kleur">—</span>
          ) : !heeftBandKleur ? (
            <span className="text-xs text-slate-400">— afwerking heeft geen bandkleur —</span>
          ) : !afwerkingCode ? (
            <span className="text-xs text-slate-400">— stel eerst een afwerking in —</span>
          ) : (kleurOpties?.length ?? 0) === 0 ? (
            <span className="text-xs text-amber-600">
              Geen bandkleuren onder {afwerkingCode} — beheer onder /afwerkingen
            </span>
          ) : (
            <div className="flex flex-col gap-1">
              <select
                value={bandDefaultId ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  onChangeBandKleur(v === '' ? null : Number(v))
                }}
                disabled={saving}
                className="px-2 py-1 border border-slate-300 rounded text-sm bg-white max-w-md"
              >
                <option value="">— niet ingesteld —</option>
                {(kleurOpties ?? []).map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {saving && <span className="text-xs text-slate-400">opslaan…</span>}
              {errorMsg && <span className="text-xs text-rose-600 max-w-md">{errorMsg}</span>}
            </div>
          )}
        </td>
        <td className="px-4 py-2 text-right">
          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs font-medium tabular-nums">
            {kleur.aantal}
          </span>
        </td>
      </tr>
      {expanded && (
        <ArtikelsVoorKleur kwaliteitCode={kwaliteitCode} kleurCode={kleur.code} productType={productType} />
      )}
    </Fragment>
  )
}

function ArtikelsVoorKleur({
  kwaliteitCode,
  kleurCode,
  productType,
}: { kwaliteitCode: string; kleurCode: string; productType: ProductType | 'alle' }) {
  const { data, isLoading } = useProducten({
    kwaliteitCode,
    productType,
    pageSize: 1000,
    sortBy: 'omschrijving',
    sortDir: 'asc',
  })
  const { data: maatwerkVormen } = useMaatwerkVormen()
  const [expandedArtikel, setExpandedArtikel] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const rows = (data?.producten ?? []).filter(
      (p) => p.kleur_code === kleurCode || p.kleur_code === kleurCode.replace(/\.0$/, ''),
    )
    // Vorm-groep eerst, daarna binnen elke groep oplopend op oppervlak —
    // klein naar groot, i.p.v. de alfabetische omschrijving-sortering (die
    // "OMBR ..." vóór "OMBRE ..." zette en geen idee had van afmeting).
    // Groepering volgt `maatwerk_vormen.afmeting_type`, niet "rechthoek vs.
    // de rest": afgeronde_hoeken/ovaal/organisch/pebble/ellips meten net als
    // rechthoek in lengte×breedte en horen dus in dezelfde groep; alleen
    // rond/cloud meten op diameter en vormen een eigen groep (kunnen niet
    // zinvol op dezelfde oppervlak-as vergeleken worden).
    const afmetingType = new Map(maatwerkVormen?.map(v => [v.code, v.afmeting_type]))
    const vormPrioriteit = (code: string | null) => afmetingType.get(code ?? 'rechthoek') === 'diameter' ? 1 : 0
    const oppervlak = (p: typeof rows[number]) =>
      p.lengte_cm != null && p.breedte_cm != null ? p.lengte_cm * p.breedte_cm : Infinity
    return [...rows].sort((a, b) => {
      const va = vormPrioriteit(a.maatwerk_vorm_code), vb = vormPrioriteit(b.maatwerk_vorm_code)
      if (va !== vb) return va - vb
      return oppervlak(a) - oppervlak(b)
    })
  }, [data, kleurCode, maatwerkVormen])

  if (isLoading) {
    return (
      <tr><td colSpan={3} className="pl-20 py-2 text-xs text-slate-400">Artikels laden…</td></tr>
    )
  }
  if (filtered.length === 0) {
    return (
      <tr><td colSpan={3} className="pl-20 py-2 text-xs text-slate-400">Geen artikels.</td></tr>
    )
  }

  const showRollen = productType !== 'vast' && productType !== 'staaltje'

  return (
    <tr className="bg-slate-100/40">
      <td colSpan={3} className="px-0 py-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-white/40">
              <th className="text-left px-4 py-1.5 font-medium text-slate-500 text-xs pl-20">Artikelnr</th>
              <th className="text-left px-4 py-1.5 font-medium text-slate-500 text-xs">Karpi-code</th>
              <th className="text-left px-4 py-1.5 font-medium text-slate-500 text-xs">Omschrijving</th>
              <th className="text-left px-4 py-1.5 font-medium text-slate-500 text-xs">Type</th>
              <th className="text-left px-4 py-1.5 font-medium text-slate-500 text-xs">Kwaliteit</th>
              <th className="text-left px-4 py-1.5 font-medium text-slate-500 text-xs">Locatie</th>
              {showRollen && <th className="text-right px-4 py-1.5 font-medium text-slate-500 text-xs">Rollen</th>}
              <th className="text-right px-4 py-1.5 font-medium text-slate-500 text-xs">Voorraad</th>
              <th className="text-right px-4 py-1.5 font-medium text-slate-500 text-xs">Vrij</th>
              <th className="text-right px-4 py-1.5 font-medium text-slate-500 text-xs">Prijs</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <ProductRow
                key={p.artikelnr}
                p={p}
                expanded={expandedArtikel === p.artikelnr}
                onToggle={() => setExpandedArtikel((cur) => (cur === p.artikelnr ? null : p.artikelnr))}
                showRollen={showRollen}
                colSpan={COL_COUNT}
                indent={2}
              />
            ))}
          </tbody>
        </table>
        <div className="pl-20 pr-4 py-2 border-t border-slate-200 bg-white/40">
          <Link
            to={`/producten/nieuw?kwaliteit=${encodeURIComponent(kwaliteitCode)}&kleur=${encodeURIComponent(kleurCode)}`}
            className="inline-flex items-center gap-1.5 text-xs text-terracotta-500 hover:text-terracotta-600 font-medium transition-colors"
          >
            <Plus size={13} /> Variant toevoegen aan {kwaliteitCode} kleur {kleurCode}
          </Link>
        </div>
      </td>
    </tr>
  )
}
