import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Info } from 'lucide-react'
import {
  fetchBackorderPerArtikl,
  fetchRolTekortPerArtikl,
  type BackorderArtikel,
  type RolTekortArtikel,
} from '@/lib/supabase/queries/producten'

// ── Gedeelde helpers ──────────────────────────────────────────────────────────

function formatAfmeting(lengte: number | null, breedte: number | null): string {
  if (!lengte && !breedte) return '—'
  if (lengte && breedte) return `${lengte}×${breedte}`
  return String(lengte ?? breedte)
}

type SortDir = 'asc' | 'desc'

function SortIcon({ actief, dir }: { actief: boolean; dir: SortDir }) {
  if (!actief) return <ArrowUpDown size={13} className="text-slate-300" />
  return dir === 'asc'
    ? <ArrowUp size={13} className="text-terracotta-500" />
    : <ArrowDown size={13} className="text-terracotta-500" />
}

function ThBtn<T extends string>({
  label, col, sortCol, sortDir, onSort, align = 'left',
}: {
  label: string; col: T; sortCol: T; sortDir: SortDir
  onSort: (c: T) => void; align?: 'left' | 'right'
}) {
  return (
    <th
      className={`px-3 py-2.5 text-xs font-medium text-slate-500 cursor-pointer select-none whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => onSort(col)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <SortIcon actief={col === sortCol} dir={sortDir} />
      </span>
    </th>
  )
}

// ── Sectie 1: Vaste maten & stalen ───────────────────────────────────────────

type VastSortCol = 'totaal_backorder' | 'totaal_te_leveren' | 'artikelnr' | 'kwaliteit_code' | 'vrije_voorraad' | 'besteld_inkoop' | 'aantal_orders'

function VasteMatensectie() {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<VastSortCol>('totaal_backorder')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const { data = [], isLoading } = useQuery({
    queryKey: ['backorder-per-artikel'],
    queryFn: fetchBackorderPerArtikl,
    staleTime: 60_000,
  })

  function handleSort(col: VastSortCol) {
    if (col === sortCol) { setSortDir(d => d === 'asc' ? 'desc' : 'asc') }
    else { setSortCol(col); setSortDir(col === 'artikelnr' || col === 'kwaliteit_code' ? 'asc' : 'desc') }
  }

  const zoekterm = search.toLowerCase()
  const gefilterd = data.filter(r =>
    !zoekterm ||
    (r.artikelnr ?? '').toLowerCase().includes(zoekterm) ||
    (r.karpi_code ?? '').toLowerCase().includes(zoekterm) ||
    (r.kwaliteit_code ?? '').toLowerCase().includes(zoekterm) ||
    (r.omschrijving ?? '').toLowerCase().includes(zoekterm) ||
    (r.kleur_code ?? '').toLowerCase().includes(zoekterm)
  )

  const gesorteerd = [...gefilterd].sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1
    const va = a[sortCol] ?? 0
    const vb = b[sortCol] ?? 0
    if (typeof va === 'string' && typeof vb === 'string') return mul * va.localeCompare(vb)
    return mul * ((va as number) - (vb as number))
  })

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">
          Vaste maten &amp; stalen
          <span className="ml-2 text-xs font-normal text-slate-400">stuks</span>
        </h2>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op artikel, code, kleur…"
            className="w-full pl-8 pr-3 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <ThBtn label="Artikel" col="artikelnr" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <ThBtn label="Kwaliteit" col="kwaliteit_code" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <th className="px-3 py-2.5 text-xs font-medium text-slate-500 text-left">Afmeting</th>
              <ThBtn label="Backorder" col="totaal_backorder" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThBtn label="Te leveren" col="totaal_te_leveren" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThBtn label="Orders" col="aantal_orders" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThBtn label="Vrije voorraad" col="vrije_voorraad" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThBtn label="Besteld inkoop" col="besteld_inkoop" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">Laden…</td></tr>
            ) : gesorteerd.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-400">
                {search ? 'Geen resultaten' : 'Geen openstaande backorders'}
              </td></tr>
            ) : gesorteerd.map((r) => <VastRij key={r.artikelnr} rij={r} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VastRij({ rij: r }: { rij: BackorderArtikel }) {
  const dekking = r.vrije_voorraad + r.besteld_inkoop
  const volledigGedekt = dekking >= r.totaal_backorder
  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-3 py-2.5">
        <Link to={`/producten/${r.artikelnr}`} className="font-mono text-xs text-terracotta-600 hover:underline">
          {r.karpi_code ?? r.artikelnr}
        </Link>
        {r.omschrijving && <div className="text-xs text-slate-500 mt-0.5 max-w-[220px] truncate">{r.omschrijving}</div>}
      </td>
      <td className="px-3 py-2.5">
        <span className="font-mono text-xs text-slate-700">{r.kwaliteit_code ?? '—'}</span>
        {r.kleur_code && <span className="ml-1.5 text-xs text-slate-400">{r.kleur_code}</span>}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{formatAfmeting(r.lengte_cm, r.breedte_cm)}</td>
      <td className="px-3 py-2.5 text-right"><span className="font-semibold text-rose-600">{r.totaal_backorder}</span></td>
      <td className="px-3 py-2.5 text-right text-slate-600 text-xs">{r.totaal_te_leveren}</td>
      <td className="px-3 py-2.5 text-right text-slate-500 text-xs">{r.aantal_orders}</td>
      <td className="px-3 py-2.5 text-right">
        <span className={`text-xs font-medium ${r.vrije_voorraad > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>{r.vrije_voorraad}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span
          className={`text-xs font-medium ${volledigGedekt ? 'text-emerald-600' : r.besteld_inkoop > 0 ? 'text-amber-600' : 'text-slate-400'}`}
          title={volledigGedekt ? 'Volledig gedekt' : r.besteld_inkoop > 0 ? 'Deels gedekt' : 'Geen inkoop uitstaan'}
        >
          {r.besteld_inkoop}
        </span>
      </td>
    </tr>
  )
}

// ── Sectie 2: Rol-materiaal tekort ───────────────────────────────────────────

type RolSortCol = 'benodigde_m2' | 'benodigde_meters' | 'kwaliteit_code' | 'aantal_stukken' | 'aantal_orders'

function RolTekortSectie() {
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<RolSortCol>('benodigde_m2')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const { data = [], isLoading } = useQuery({
    queryKey: ['roltekort-per-artikel'],
    queryFn: fetchRolTekortPerArtikl,
    staleTime: 60_000,
  })

  function handleSort(col: RolSortCol) {
    if (col === sortCol) { setSortDir(d => d === 'asc' ? 'desc' : 'asc') }
    else { setSortCol(col); setSortDir(col === 'kwaliteit_code' ? 'asc' : 'desc') }
  }

  const zoekterm = search.toLowerCase()
  const gefilterd = data.filter(r =>
    !zoekterm ||
    (r.kwaliteit_code ?? '').toLowerCase().includes(zoekterm) ||
    (r.kleur_code ?? '').toLowerCase().includes(zoekterm) ||
    (r.karpi_code ?? '').toLowerCase().includes(zoekterm) ||
    (r.omschrijving ?? '').toLowerCase().includes(zoekterm)
  )

  const gesorteerd = [...gefilterd].sort((a, b) => {
    const mul = sortDir === 'asc' ? 1 : -1
    if (sortCol === 'kwaliteit_code') {
      const s = (a.kwaliteit_code ?? '').localeCompare(b.kwaliteit_code ?? '')
      return mul * s || (a.kleur_code ?? '').localeCompare(b.kleur_code ?? '')
    }
    const va = (a[sortCol] as number | null) ?? 0
    const vb = (b[sortCol] as number | null) ?? 0
    return mul * (va - vb)
  })

  const totaalM2 = data.reduce((s, r) => s + Number(r.benodigde_m2), 0)
  const metMeters = data.filter(r => r.benodigde_meters !== null)
  const totaalMeters = metMeters.reduce((s, r) => s + (r.benodigde_meters ?? 0), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">
            Rol-materiaal tekort
            <span className="ml-2 text-xs font-normal text-slate-400">lengte meters (schatting)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
            <Info size={11} />
            Berekend als m² / rolbreedte — werkelijk benodigd (incl. snijverlies) ligt hoger
          </p>
        </div>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Zoek op kwaliteit, kleur…"
            className="w-full pl-8 pr-3 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
          />
        </div>
      </div>
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <ThBtn label="Kwaliteit · kleur" col="kwaliteit_code" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              <th className="px-3 py-2.5 text-xs font-medium text-slate-500 text-left">Artikel</th>
              <th className="px-3 py-2.5 text-xs font-medium text-slate-500 text-right">Breedte</th>
              <ThBtn label="Ber. m²" col="benodigde_m2" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThBtn label="Ber. meters" col="benodigde_meters" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThBtn label="Stukken" col="aantal_stukken" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
              <ThBtn label="Orders" col="aantal_orders" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">Laden…</td></tr>
            ) : gesorteerd.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">
                {search ? 'Geen resultaten' : 'Geen maatwerk-tekorten'}
              </td></tr>
            ) : gesorteerd.map((r) => <RolTekortRij key={`${r.kwaliteit_code}-${r.kleur_code}`} rij={r} />)}
          </tbody>
          {gesorteerd.length > 0 && (
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td colSpan={3} className="px-3 py-2 text-xs text-slate-500 font-medium">Totaal ({gesorteerd.length} groepen)</td>
                <td className="px-3 py-2 text-right text-xs font-semibold text-slate-700">
                  {totaalM2.toFixed(1)} m²
                </td>
                <td className="px-3 py-2 text-right text-xs font-semibold text-slate-700">
                  {metMeters.length > 0 ? `≥ ${totaalMeters.toFixed(1)} m` : '—'}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function RolTekortRij({ rij: r }: { rij: RolTekortArtikel }) {
  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-3 py-2.5">
        <span className="font-mono text-xs font-semibold text-slate-800">{r.kwaliteit_code}</span>
        <span className="ml-2 text-xs text-slate-500">{r.kleur_code ?? '—'}</span>
      </td>
      <td className="px-3 py-2.5">
        {r.artikelnr ? (
          <Link to={`/producten/${r.artikelnr}`} className="font-mono text-xs text-terracotta-600 hover:underline">
            {r.karpi_code ?? r.artikelnr}
          </Link>
        ) : (
          <span className="text-xs text-slate-400 italic">geen artikel</span>
        )}
        {r.omschrijving && (
          <div className="text-xs text-slate-500 mt-0.5 max-w-[200px] truncate">{r.omschrijving}</div>
        )}
      </td>
      <td className="px-3 py-2.5 text-right font-mono text-xs text-slate-500">
        {r.standaard_breedte_cm ? `${r.standaard_breedte_cm} cm` : '—'}
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-xs text-slate-600">{Number(r.benodigde_m2).toFixed(1)}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        {r.benodigde_meters !== null ? (
          <span className="font-semibold text-rose-600">≥ {r.benodigde_meters} m</span>
        ) : (
          <span className="text-xs text-slate-400" title="Rolbreedte onbekend — vul standaard_breedte_cm in op kwaliteit">
            {Number(r.benodigde_m2).toFixed(1)} m²
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right text-xs text-slate-500">{r.aantal_stukken}</td>
      <td className="px-3 py-2.5 text-right text-xs text-slate-500">{r.aantal_orders}</td>
    </tr>
  )
}

// ── Hoofdcomponent ─────────────────────────────────────────────────────────────

export function BackorderTab() {
  const { data: vastData = [] } = useQuery({
    queryKey: ['backorder-per-artikel'],
    queryFn: fetchBackorderPerArtikl,
    staleTime: 60_000,
  })
  const { data: rolData = [] } = useQuery({
    queryKey: ['roltekort-per-artikel'],
    queryFn: fetchRolTekortPerArtikl,
    staleTime: 60_000,
  })

  const totaalVastBackorder = vastData.reduce((s, r) => s + r.totaal_backorder, 0)
  const totaalRolM2 = rolData.reduce((s, r) => s + Number(r.benodigde_m2), 0)

  return (
    <div>
      {/* Samenvatting */}
      <div className="flex items-center gap-4 mb-6">
        <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5 text-center min-w-[130px]">
          <div className="text-2xl font-bold text-rose-700">{totaalVastBackorder.toLocaleString('nl-NL')}</div>
          <div className="text-xs text-rose-500 mt-0.5">stuks backorder (vast)</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-center min-w-[130px]">
          <div className="text-2xl font-bold text-amber-700">{totaalRolM2.toFixed(0)} m²</div>
          <div className="text-xs text-amber-500 mt-0.5">rol-materiaal tekort</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-center min-w-[120px]">
          <div className="text-2xl font-bold text-slate-700">{vastData.length + rolData.length}</div>
          <div className="text-xs text-slate-500 mt-0.5">artikelen totaal</div>
        </div>
      </div>

      <VasteMatensectie />
      <RolTekortSectie />
    </div>
  )
}
