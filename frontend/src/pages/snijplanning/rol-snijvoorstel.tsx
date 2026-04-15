import { useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Printer } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { RolHeaderCard } from '@/components/snijplanning/rol-header-card'
import { SnijstukkenTabel } from '@/components/snijplanning/snijstukken-tabel'
import { SnijVisualisatie } from '@/components/snijplanning/snij-visualisatie'
import { useRolSnijstukken } from '@/hooks/use-snijplanning'
import { computeReststukkenFromStukken } from '@/lib/utils/compute-reststukken'
import type { SnijplanRow, SnijRolVoorstel, SnijStuk } from '@/lib/types/productie'

/** Map flat SnijplanRow[] from the query into a SnijRolVoorstel for the UI */
function mapToVoorstel(rows: SnijplanRow[]): SnijRolVoorstel | null {
  if (rows.length === 0) return null
  const first = rows[0]

  const stukken: SnijStuk[] = rows.map((r) => ({
    snijplan_id: r.id,
    order_regel_id: r.order_regel_id,
    order_nr: r.order_nr,
    klant_naam: r.klant_naam,
    breedte_cm: r.snij_breedte_cm,
    lengte_cm: r.snij_lengte_cm,
    vorm: r.maatwerk_vorm ?? 'rechthoek',
    afwerking: r.maatwerk_afwerking ?? null,
    x_cm: r.positie_x_cm ?? 0,
    y_cm: r.positie_y_cm ?? 0,
    afleverdatum: r.afleverdatum,
  }))

  const rolLengte = first.rol_lengte_cm ?? 0
  const rolBreedte = first.rol_breedte_cm ?? 0
  const gebruikteLengte = stukken.reduce(
    (max, s) => Math.max(max, s.y_cm + s.lengte_cm),
    0,
  )
  const restLengte = Math.max(0, rolLengte - gebruikteLengte)
  const rolM2 = (rolLengte * rolBreedte) / 10_000
  const gebruiktM2 = stukken.reduce(
    (sum, s) => sum + (s.breedte_cm * s.lengte_cm) / 10_000,
    0,
  )
  const afvalPct = rolM2 > 0 ? ((rolM2 - gebruiktM2) / rolM2) * 100 : 0

  return {
    rol_id: first.id,
    rolnummer: first.rolnummer ?? `Rol ${first.id}`,
    rol_lengte_cm: rolLengte,
    rol_breedte_cm: rolBreedte,
    rol_status: (first.rol_status as SnijRolVoorstel['rol_status']) ?? 'beschikbaar',
    locatie: null,
    stukken,
    gebruikte_lengte_cm: gebruikteLengte,
    rest_lengte_cm: restLengte,
    afval_pct: afvalPct,
    reststuk_bruikbaar: restLengte >= 50,
    reststukken: computeReststukkenFromStukken(rolLengte, rolBreedte, stukken),
  }
}

export function RolSnijvoorstelPage() {
  const { rolId } = useParams<{ rolId: string }>()
  const id = Number(rolId)

  const { data: rows, isLoading } = useRolSnijstukken(id)
  const voorstel = useMemo(() => mapToVoorstel(rows ?? []), [rows])

  if (isLoading) {
    return (
      <>
        <PageHeader title="Snijvoorstel laden..." />
        <div className="text-slate-400">Even geduld...</div>
      </>
    )
  }

  if (!voorstel) {
    return (
      <>
        <PageHeader title="Rol niet gevonden" />
        <Link to="/snijplanning" className="text-terracotta-500 hover:underline">
          Terug naar snijplanning
        </Link>
      </>
    )
  }

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

      <PageHeader title={`Snijvoorstel — Rol ${voorstel.rolnummer}`} />

      <RolHeaderCard voorstel={voorstel} />

      {/* SVG Snijvisualisatie */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-6 mb-6">
        <h3 className="text-sm font-medium text-slate-600 mb-3">Snijvisualisatie</h3>
        <SnijVisualisatie
          rolBreedte={voorstel.rol_breedte_cm}
          rolLengte={voorstel.rol_lengte_cm}
          stukken={voorstel.stukken}
          restLengte={voorstel.rest_lengte_cm}
          afvalPct={voorstel.afval_pct}
          reststukBruikbaar={voorstel.reststuk_bruikbaar}
          reststukken={voorstel.reststukken}
        />
      </div>

      <SnijstukkenTabel stukken={voorstel.stukken} />

      {/* Action bar */}
      <div className="flex items-center gap-3 mt-6">
        <button className="flex items-center gap-2 px-4 py-2 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-sm font-medium hover:bg-terracotta-600 transition-colors">
          <CheckCircle2 size={16} />
          Goedkeuren
        </button>
        <button className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-[var(--radius-sm)] text-sm hover:bg-slate-50 transition-colors">
          <Printer size={16} />
          Stickers printen
        </button>
      </div>
    </>
  )
}
