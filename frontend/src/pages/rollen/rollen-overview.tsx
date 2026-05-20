import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Search, Plus, Cylinder, Package, Scissors, AlertCircle } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { RollenGroepRow } from '@/components/rollen/rollen-groep-row'
import { useRollenStats } from '@/hooks/use-rollen'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import {
  fetchGhostBesteldParen,
  normaliseerKleurcode,
  useVoorraadposities,
  type GhostBesteldRij,
  type Voorraadpositie,
} from '@/modules/voorraadpositie'

function formatM2(value: number): string {
  return value.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/**
 * Sorteer-modi voor de Rollen-pagina (ADR-0026, UI-stap 1).
 * `kwaliteit` = default, behoudt de RPC-volgorde (kwaliteit_code ASC).
 */
type SortMode = 'kwaliteit' | 'voorraad_desc' | 'vrij_asc' | 'vraag_desc'

const SORT_OPTIES: { value: SortMode; label: string }[] = [
  { value: 'kwaliteit', label: 'Kwaliteit (A→Z)' },
  { value: 'voorraad_desc', label: 'Voorraad (hoog → laag)' },
  { value: 'vrij_asc', label: 'Vrij voor maatwerk (laag → hoog)' },
  { value: 'vraag_desc', label: 'Bruto-maatwerkvraag (hoog → laag)' },
]

/**
 * Stabiele tiebreaker per (kwaliteit_code, kleur_code) zodat de volgorde
 * binnen elke sort-modus deterministisch is.
 */
function tiebreakKwKl(a: Voorraadpositie, b: Voorraadpositie): number {
  const kw = a.kwaliteit_code.localeCompare(b.kwaliteit_code)
  if (kw !== 0) return kw
  return a.kleur_code.localeCompare(b.kleur_code)
}

/**
 * Construeert een "ghost"-Voorraadpositie voor een (kw, kl) zonder eigen
 * voorraad. Alleen `besteld` is gevuld; `voorraad`/`rollen`/`partners` zijn
 * leeg. RollenGroepRow rendert dit als `isEmpty=true`-rij — dezelfde
 * "alleen besteld"-zichtbaarheid als in main vóór de Module-cutover.
 *
 * Bron: `fetchGhostBesteldParen` uit de Module — Module's bestaans-regel
 * (batch-modus geeft alleen eigen-voorraad-paren) blijft onveranderd; deze
 * page-niveau-merge is een view-laag-aanvulling.
 */
function maakGhostPositie(row: GhostBesteldRij): Voorraadpositie {
  return {
    kwaliteit_code: row.kwaliteit_code,
    kleur_code: row.kleur_code,
    product_naam: null,
    voorraad: {
      volle_rollen: 0,
      aangebroken_rollen: 0,
      reststuk_rollen: 0,
      totaal_m2: 0,
    },
    rollen: [],
    partners: [],
    beste_partner: null,
    besteld: {
      besteld_m: row.besteld_m,
      besteld_m2: row.besteld_m2,
      orders_count: row.orders_count,
      eerstvolgende_leverweek: row.eerstvolgende_leverweek,
      eerstvolgende_verwacht_datum: row.eerstvolgende_verwacht_datum,
      eerstvolgende_m: row.eerstvolgende_m,
      eerstvolgende_m2: row.eerstvolgende_m2,
    },
    // Ghost-paren hebben geen eigen voorraad en geen open maatwerk-druk —
    // 0 is per definitie correct (ADR-0026).
    bruto_maatwerkvraag_m2: 0,
    vrij_voor_nieuw_maatwerk_m2: 0,
  }
}

export function RollenOverviewPage() {
  const [params] = useSearchParams()
  const kwaliteitFilter = params.get('kwaliteit') || undefined
  const kleurFilter = params.get('kleur') || undefined
  const hasFilter = !!kwaliteitFilter
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('kwaliteit')

  const { data: stats } = useRollenStats()

  // Batch+filter via Voorraadpositie-Module — server-side filtering.
  // Lege filter-velden worden in de Module zelf naar null vertaald.
  const { data: posities, isLoading } = useVoorraadposities({
    kwaliteit: kwaliteitFilter,
    kleur: kleurFilter,
    search: search || undefined,
  })

  // Ghost-bron: alle besteld-aggregaten via Module-seam. Wordt gemerged op
  // page-niveau zodat het Module-concept zuiver blijft (Voorraadpositie =
  // "iets dat bestaat"). De RPC zelf zit achter `fetchGhostBesteldParen`.
  const { data: besteldAggregaten } = useQuery({
    queryKey: ['voorraadpositie', 'ghost-besteld'],
    queryFn: fetchGhostBesteldParen,
    staleTime: 60_000,
  })

  // Merge: voor elke besteld-aggregaat-rij die NIET in de batch-respons zit,
  // construeer een ghost-positie. Respecteer dezelfde filters als de batch-call.
  const groepenMetGhost = useMemo<Voorraadpositie[]>(() => {
    const lijst = posities ?? []
    if (!besteldAggregaten || besteldAggregaten.length === 0) return lijst

    const aanwezig = new Set(
      lijst.map((p) => `${p.kwaliteit_code}|${p.kleur_code}`),
    )
    const sNormaal = sanitizeSearch(search ?? '').toLowerCase()
    const kleurNorm = kleurFilter ? normaliseerKleurcode(kleurFilter) : null

    const ghosts: Voorraadpositie[] = []
    for (const row of besteldAggregaten) {
      if (row.besteld_m <= 0) continue
      const kw = row.kwaliteit_code
      const kl = row.kleur_code
      const key = `${kw}|${kl}`
      if (aanwezig.has(key)) continue

      // Respecteer dezelfde filters als de batch-call.
      if (kwaliteitFilter && kw !== kwaliteitFilter) continue
      if (kleurNorm && kl !== kleurNorm) continue
      if (sNormaal && !kwaliteitFilter) {
        if (
          !kw.toLowerCase().includes(sNormaal) &&
          !kl.toLowerCase().includes(sNormaal)
        ) {
          continue
        }
      }
      ghosts.push(maakGhostPositie(row))
    }

    return [...lijst, ...ghosts]
  }, [posities, besteldAggregaten, kwaliteitFilter, kleurFilter, search])

  /**
   * Sorteer volgens de gekozen modus. Default `kwaliteit` laat de RPC-volgorde
   * intact (geen breaking change). Andere modi sorteren op de relevante key met
   * (kwaliteit_code, kleur_code) als tiebreaker voor stabiliteit.
   */
  const gesorteerdeGroepen = useMemo<Voorraadpositie[]>(() => {
    if (sortMode === 'kwaliteit') return groepenMetGhost
    const out = [...groepenMetGhost]
    switch (sortMode) {
      case 'voorraad_desc':
        out.sort((a, b) => {
          const diff = b.voorraad.totaal_m2 - a.voorraad.totaal_m2
          return diff !== 0 ? diff : tiebreakKwKl(a, b)
        })
        return out
      case 'vrij_asc':
        // Families MET bruto-maatwerkvraag eerst (anders staan lege/krappe
        // families zonder druk bovenaan en zakken de echte signal-rijen weg).
        // Binnen elke groep oplopend op vrij. ADR-0026: "puur inzicht" — deze
        // tweesplitsing is sorteer-mechaniek, geen kleurcodering of drempel.
        out.sort((a, b) => {
          const aDruk = a.bruto_maatwerkvraag_m2 > 0 ? 0 : 1
          const bDruk = b.bruto_maatwerkvraag_m2 > 0 ? 0 : 1
          if (aDruk !== bDruk) return aDruk - bDruk
          const diff = a.vrij_voor_nieuw_maatwerk_m2 - b.vrij_voor_nieuw_maatwerk_m2
          return diff !== 0 ? diff : tiebreakKwKl(a, b)
        })
        return out
      case 'vraag_desc':
        out.sort((a, b) => {
          const diff = b.bruto_maatwerkvraag_m2 - a.bruto_maatwerkvraag_m2
          return diff !== 0 ? diff : tiebreakKwKl(a, b)
        })
        return out
    }
  }, [groepenMetGhost, sortMode])

  const statCards = [
    {
      label: 'Totaal op voorraad',
      value: stats?.totaal ?? 0,
      sub: `${formatM2(stats?.totaal_m2 ?? 0)} m²`,
      icon: Cylinder,
      color: 'text-slate-700',
    },
    {
      label: 'Volle rollen',
      value: stats?.volle_rollen ?? 0,
      sub: `${formatM2(stats?.volle_m2 ?? 0)} m²`,
      icon: Package,
      color: 'text-emerald-600',
    },
    {
      label: 'Aangebroken rollen',
      value: stats?.aangebroken ?? 0,
      sub: `${formatM2(stats?.aangebroken_m2 ?? 0)} m²`,
      icon: Scissors,
      color: 'text-indigo-600',
    },
    {
      label: 'Reststukken',
      value: stats?.reststukken ?? 0,
      sub: `${formatM2(stats?.reststukken_m2 ?? 0)} m²`,
      icon: AlertCircle,
      color: 'text-orange-600',
    },
    {
      label: 'Leeg/Op',
      value: stats?.leeg_op ?? 0,
      sub: null,
      icon: Cylinder,
      color: 'text-slate-400',
    },
  ]

  return (
    <>
      <PageHeader
        title="Rollen & Reststukken"
        description="Overzicht van alle rollen en aangebroken rollen op voorraad"
        actions={
          <button className="flex items-center gap-2 px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 transition-colors">
            <Plus size={16} />
            Rol opboeken
          </button>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {statCards.map((s) => (
          <div key={s.label} className="bg-white rounded-[var(--radius)] border border-slate-200 p-4">
            <div className="flex items-center gap-2 mb-1">
              <s.icon size={16} className={s.color} />
              <span className="text-sm text-slate-500">{s.label}</span>
            </div>
            <p className="text-2xl font-semibold">{s.value}</p>
            {s.sub && <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>}
          </div>
        ))}
      </div>

      {/* Active filter banner */}
      {hasFilter && (
        <div className="flex items-center gap-2 px-4 py-2 mb-4 bg-blue-50 border border-blue-200 rounded-[var(--radius)] text-sm text-blue-700">
          <span>
            Gefilterd op: <strong>{kwaliteitFilter} {kleurFilter}</strong>
          </span>
          <a
            href="/rollen"
            className="ml-auto px-2 py-1 text-xs font-medium bg-blue-100 hover:bg-blue-200 rounded transition-colors"
          >
            Toon alle rollen
          </a>
        </div>
      )}

      {/* Search + sorteer-dropdown (ADR-0026) */}
      {!hasFilter && (
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="relative w-96">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Zoek op product, kleur, rolnummer, locatie..."
              className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <span className="whitespace-nowrap">Sorteren op:</span>
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="px-3 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
            >
              {SORT_OPTIES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* Grouped rows */}
      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Rollen laden...
        </div>
      ) : gesorteerdeGroepen.length === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Geen rollen gevonden
        </div>
      ) : (
        <div className="space-y-3">
          {gesorteerdeGroepen.map((p, idx) => {
            // Bij Vrij-asc-sortering: section-divider zodra we van druk-rijen
            // (bruto-vraag > 0) overgaan naar rijen zonder druk. Scheidt het
            // "wat moet ik bekijken voor inkoop?"-gebied van browse-gebied.
            const prev = idx > 0 ? gesorteerdeGroepen[idx - 1] : null
            const toonDivider =
              sortMode === 'vrij_asc' &&
              prev !== null &&
              prev.bruto_maatwerkvraag_m2 > 0 &&
              p.bruto_maatwerkvraag_m2 === 0
            return (
              <Fragment key={`${p.kwaliteit_code}-${p.kleur_code}`}>
                {toonDivider && (
                  <div className="flex items-center gap-3 pt-2 pb-1 text-xs uppercase tracking-wide text-slate-400">
                    <span className="h-px flex-1 bg-slate-200" />
                    <span>Geen open maatwerk-druk</span>
                    <span className="h-px flex-1 bg-slate-200" />
                  </div>
                )}
                <RollenGroepRow positie={p} />
              </Fragment>
            )
          })}
        </div>
      )}
    </>
  )
}
