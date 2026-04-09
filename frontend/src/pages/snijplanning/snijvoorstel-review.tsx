import { useMemo, useState } from 'react'
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { RolHeaderCard } from '@/components/snijplanning/rol-header-card'
import { SnijVisualisatie } from '@/components/snijplanning/snij-visualisatie'
import {
  useSnijplannenVoorGroep,
  useKeurSnijvoorstelGoed,
  useVerwerpSnijvoorstel,
} from '@/hooks/use-snijplanning'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import type {
  SnijvoorstelResponse,
  SnijvoorstelPlaatsing,
  SnijvoorstelRol,
  SnijplanRow,
  SnijRolVoorstel,
  SnijStuk,
  PlanningConfig,
} from '@/lib/types/productie'

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

function mapToSnijStuk(plaatsing: SnijvoorstelPlaatsing, snijplan: SnijplanRow): SnijStuk {
  return {
    snijplan_id: plaatsing.snijplan_id,
    order_regel_id: snijplan.order_regel_id,
    order_nr: snijplan.order_nr,
    klant_naam: snijplan.klant_naam,
    breedte_cm: plaatsing.breedte_cm,
    lengte_cm: plaatsing.lengte_cm,
    vorm: snijplan.maatwerk_vorm ?? 'rechthoek',
    afwerking: snijplan.maatwerk_afwerking ?? null,
    x_cm: plaatsing.positie_x_cm,
    y_cm: plaatsing.positie_y_cm,
    geroteerd: plaatsing.geroteerd,
    afleverdatum: snijplan.afleverdatum,
  }
}

function mapToRolVoorstel(
  rol: SnijvoorstelRol,
  stukken: SnijStuk[],
): SnijRolVoorstel {
  return {
    rol_id: rol.rol_id,
    rolnummer: rol.rolnummer,
    rol_lengte_cm: rol.rol_lengte_cm,
    rol_breedte_cm: rol.rol_breedte_cm,
    rol_status: rol.rol_status,
    locatie: null,
    stukken,
    gebruikte_lengte_cm: rol.gebruikte_lengte_cm,
    rest_lengte_cm: rol.restlengte_cm,
    afval_pct: rol.afval_percentage,
    reststuk_bruikbaar: rol.restlengte_cm >= 50,
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SnijvoorstelReviewPage() {
  const { voorstelId } = useParams<{ voorstelId: string }>()
  const location = useLocation()
  const navigate = useNavigate()

  const state = location.state as {
    voorstelResponse?: SnijvoorstelResponse
    kwaliteitCode?: string
    kleurCode?: string
  } | null

  const voorstelResponse = state?.voorstelResponse ?? null
  const kwaliteitCode = state?.kwaliteitCode ?? ''
  const kleurCode = state?.kleurCode ?? ''

  // Fetch snijplannen for this group to get order/klant info
  const { data: snijplannen } = useSnijplannenVoorGroep(
    kwaliteitCode,
    kleurCode,
    !!kwaliteitCode && !!kleurCode,
  )

  // Build a lookup by snijplan_id
  const snijplanMap = useMemo(() => {
    const map = new Map<number, SnijplanRow>()
    for (const sp of snijplannen ?? []) {
      map.set(sp.id, sp)
    }
    return map
  }, [snijplannen])

  // Map voorstel data to component-friendly format
  const rolVoorstellen = useMemo(() => {
    if (!voorstelResponse || snijplanMap.size === 0) return []

    return voorstelResponse.rollen.map((rol) => {
      const stukken = rol.plaatsingen.map((p) => {
        const sp = snijplanMap.get(p.snijplan_id)
        if (!sp) {
          // Fallback if snijplan not found in view
          return {
            snijplan_id: p.snijplan_id,
            order_regel_id: 0,
            order_nr: '?',
            klant_naam: '?',
            breedte_cm: p.breedte_cm,
            lengte_cm: p.lengte_cm,
            vorm: 'rechthoek',
            afwerking: null,
            x_cm: p.positie_x_cm,
            y_cm: p.positie_y_cm,
            geroteerd: p.geroteerd,
            afleverdatum: null,
          } satisfies SnijStuk
        }
        return mapToSnijStuk(p, sp)
      })
      return mapToRolVoorstel(rol, stukken)
    })
  }, [voorstelResponse, snijplanMap])

  if (!voorstelResponse) {
    return (
      <>
        <div className="mb-4">
          <Link
            to="/snijplanning"
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft size={14} />
            Terug naar snijplanning
          </Link>
        </div>
        <PageHeader title="Snijvoorstel laden..." />
        <p className="text-sm text-slate-400">
          Dit voorstel kan niet worden weergegeven. Genereer een nieuw voorstel vanuit de snijplanning.
        </p>
      </>
    )
  }

  const sam = voorstelResponse.samenvatting
  const { data: planningConfig } = usePlanningConfig()

  return (
    <>
      <div className="mb-4">
        <Link
          to="/snijplanning"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} />
          Terug naar snijplanning
        </Link>
      </div>

      <PageHeader title={`Snijvoorstel -- ${voorstelResponse.voorstel_nr}`} />

      {/* Summary card */}
      <SummaryCard samenvatting={sam} planningConfig={planningConfig} />

      {/* Per-roll visualisations */}
      {rolVoorstellen.map((rv) => (
        <div key={rv.rol_id} className="bg-white rounded-[var(--radius)] border border-slate-200 p-4 mb-6">
          <RolHeaderCard voorstel={rv} compact />
          <div className="mt-4">
            <SnijVisualisatie
              rolBreedte={rv.rol_breedte_cm}
              rolLengte={rv.rol_lengte_cm}
              stukken={rv.stukken}
              restLengte={rv.rest_lengte_cm}
              afvalPct={rv.afval_pct}
              reststukBruikbaar={rv.reststuk_bruikbaar}
            />
          </div>
          <StukkenLijst stukken={rv.stukken} />
        </div>
      ))}

      {/* Niet geplaatst warning */}
      {voorstelResponse.niet_geplaatst.length > 0 && (
        <NietGeplaatstCard items={voorstelResponse.niet_geplaatst} snijplanMap={snijplanMap} />
      )}

      {/* Action bar */}
      <ActionBar voorstelId={Number(voorstelId)} navigate={navigate} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function formatTijd(minuten: number): string {
  const uren = Math.floor(minuten / 60)
  const min = Math.round(minuten % 60)
  if (uren === 0) return `${min} min`
  return min === 0 ? `${uren} uur` : `${uren} uur ${min} min`
}

function SummaryCard({ samenvatting, planningConfig }: { samenvatting: SnijvoorstelResponse['samenvatting']; planningConfig?: PlanningConfig | null }) {
  const geschatteTijd = planningConfig
    ? (samenvatting.totaal_rollen * planningConfig.wisseltijd_minuten) + (samenvatting.geplaatst * planningConfig.snijtijd_minuten)
    : null

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4 mb-6">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
        <div>
          <p className="text-xs text-slate-500 mb-0.5">Stukken / Rollen</p>
          <p className="font-medium text-slate-900">
            {samenvatting.geplaatst} stuks op {samenvatting.totaal_rollen} {samenvatting.totaal_rollen === 1 ? 'rol' : 'rollen'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-0.5">Gem. afval</p>
          <p className="font-medium text-slate-900">{samenvatting.gemiddeld_afval_pct.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-0.5">Gebruikt</p>
          <p className="font-medium text-slate-900">{samenvatting.totaal_m2_gebruikt.toFixed(1)} m²</p>
        </div>
        <div>
          <p className="text-xs text-slate-500 mb-0.5">Afval</p>
          <p className="font-medium text-slate-900">{samenvatting.totaal_m2_afval.toFixed(1)} m²</p>
        </div>
        {geschatteTijd !== null && (
          <div>
            <p className="text-xs text-slate-500 mb-0.5">Geschatte tijd</p>
            <p className="font-medium text-slate-900">{formatTijd(geschatteTijd)}</p>
          </div>
        )}
      </div>
      {samenvatting.niet_geplaatst > 0 && (
        <div className="mt-3 flex items-center gap-2 text-amber-700 text-xs">
          <AlertTriangle size={14} />
          {samenvatting.niet_geplaatst} {samenvatting.niet_geplaatst === 1 ? 'stuk' : 'stukken'} niet geplaatst
        </div>
      )}
    </div>
  )
}

function StukkenLijst({ stukken }: { stukken: SnijStuk[] }) {
  if (stukken.length === 0) return null
  return (
    <table className="w-full text-sm mt-3">
      <thead>
        <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
          <th className="py-2 pr-3">Maat</th>
          <th className="py-2 pr-3">Klant</th>
          <th className="py-2 pr-3">Order</th>
          <th className="py-2 pr-3">Positie</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {stukken.map((s, i) => (
          <tr key={`${s.snijplan_id}-${i}`} className="hover:bg-slate-50">
            <td className="py-2 pr-3 font-medium">
              {s.breedte_cm}x{s.lengte_cm} cm
              {s.geroteerd && <span className="ml-1 text-xs text-purple-600">(90deg)</span>}
            </td>
            <td className="py-2 pr-3">{s.klant_naam}</td>
            <td className="py-2 pr-3 text-terracotta-600">{s.order_nr}</td>
            <td className="py-2 pr-3 text-slate-400">({s.x_cm}, {s.y_cm})</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function NietGeplaatstCard({
  items,
  snijplanMap,
}: {
  items: SnijvoorstelResponse['niet_geplaatst']
  snijplanMap: Map<number, SnijplanRow>
}) {
  return (
    <div className="bg-amber-50 rounded-[var(--radius)] border border-amber-200 p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={16} className="text-amber-600" />
        <span className="font-medium text-amber-800 text-sm">
          {items.length} {items.length === 1 ? 'stuk' : 'stukken'} niet geplaatst
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-amber-200 text-left text-xs text-amber-700 uppercase">
            <th className="py-2 pr-3">Snijplan</th>
            <th className="py-2 pr-3">Klant</th>
            <th className="py-2 pr-3">Maat</th>
            <th className="py-2 pr-3">Reden</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-amber-100">
          {items.map((item) => {
            const sp = snijplanMap.get(item.snijplan_id)
            return (
              <tr key={item.snijplan_id}>
                <td className="py-2 pr-3 font-medium">{sp?.snijplan_nr ?? `#${item.snijplan_id}`}</td>
                <td className="py-2 pr-3">{sp?.klant_naam ?? '—'}</td>
                <td className="py-2 pr-3">{sp ? `${sp.snij_breedte_cm}x${sp.snij_lengte_cm} cm` : '—'}</td>
                <td className="py-2 pr-3 text-amber-700">{item.reden}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ActionBar({
  voorstelId,
  navigate,
}: {
  voorstelId: number
  navigate: ReturnType<typeof useNavigate>
}) {
  const goedkeuren = useKeurSnijvoorstelGoed()
  const verwerpen = useVerwerpSnijvoorstel()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-3 mt-2 mb-8">
      <button
        onClick={() => {
          setError(null)
          goedkeuren.mutate(voorstelId, {
            onSuccess: () => navigate('/snijplanning'),
            onError: (err) => setError(err instanceof Error ? err.message : 'Fout bij goedkeuren'),
          })
        }}
        disabled={goedkeuren.isPending || verwerpen.isPending}
        className="flex items-center gap-2 px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50"
      >
        {goedkeuren.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
        Alles goedkeuren
      </button>
      <button
        onClick={() => {
          setError(null)
          verwerpen.mutate(voorstelId, {
            onSuccess: () => navigate('/snijplanning'),
            onError: (err) => setError(err instanceof Error ? err.message : 'Fout bij verwerpen'),
          })
        }}
        disabled={goedkeuren.isPending || verwerpen.isPending}
        className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        {verwerpen.isPending ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />}
        Verwerpen
      </button>
      {error && (
        <span className="text-sm text-red-600">{error}</span>
      )}
    </div>
  )
}
