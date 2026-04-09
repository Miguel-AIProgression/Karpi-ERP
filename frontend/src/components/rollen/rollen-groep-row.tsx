import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils/cn'
import { ROL_STATUS_COLORS } from '@/lib/utils/constants'
import { useReserveringenVoorProduct } from '@/hooks/use-producten'
import { useRolSnijstukken } from '@/hooks/use-snijplanning'
import type { RolGroep, RolRow } from '@/lib/types/productie'

interface RollenGroepRowProps {
  groep: RolGroep
}

const STATUS_LABELS: Record<string, string> = {
  beschikbaar: 'VOLLE ROL',
  gereserveerd: 'GERESERVEERD',
  in_snijplan: 'AANGEBROKEN',
  reststuk: 'RESTSTUK',
}

function StatusBadge({ status, count }: { status: string; count: number }) {
  if (count === 0) return null
  const colors = ROL_STATUS_COLORS[status] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
  const label = STATUS_LABELS[status] ?? status
  return (
    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', colors.bg, colors.text)}>
      {count}&times; {label}
    </span>
  )
}

const SNIJPLAN_STATUS_COLORS: Record<string, string> = {
  Wacht: 'bg-slate-100 text-slate-600',
  Gepland: 'bg-blue-100 text-blue-700',
  'In productie': 'bg-amber-100 text-amber-700',
  Gesneden: 'bg-emerald-100 text-emerald-700',
  'In confectie': 'bg-purple-100 text-purple-700',
  Gereed: 'bg-green-100 text-green-700',
  Ingepakt: 'bg-teal-100 text-teal-700',
}

function RolDetails({ rolId, artikelnr, rolOppervlak }: { rolId: number; artikelnr: string; rolOppervlak: number }) {
  const { data: snijstukken, isLoading: snijLoading } = useRolSnijstukken(rolId)
  const { data: reserveringen, isLoading: resLoading } = useReserveringenVoorProduct(artikelnr)

  const isLoading = snijLoading || resLoading

  if (isLoading) {
    return (
      <div className="px-6 py-3 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 size={12} className="animate-spin" />
        Laden...
      </div>
    )
  }

  const hasSnijstukken = snijstukken && snijstukken.length > 0
  const hasReserveringen = reserveringen && reserveringen.length > 0

  if (!hasSnijstukken && !hasReserveringen) {
    return (
      <div className="px-6 py-3 text-xs text-slate-400">
        Geen geplande snijstukken of reserveringen op deze rol.
      </div>
    )
  }

  // Bereken gereserveerd m² uit snijstukken
  const gereserveerdM2 = hasSnijstukken
    ? snijstukken.reduce((sum, s) => sum + (s.snij_lengte_cm * s.snij_breedte_cm) / 10000, 0)
    : 0
  const vrijM2 = Math.max(0, rolOppervlak - gereserveerdM2)

  return (
    <div className="px-6 py-3 bg-slate-50/50 space-y-4">
      {/* Snijplannen op deze rol */}
      {hasSnijstukken && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-slate-500">
              Geplande snijstukken ({snijstukken.length})
            </p>
            <p className="text-xs text-slate-500">
              <span className="font-medium text-amber-600">{gereserveerdM2.toFixed(1)} m²</span>
              {' gereserveerd · '}
              <span className="font-medium text-emerald-600">{vrijM2.toFixed(1)} m²</span>
              {' vrij'}
            </p>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1 pr-3 font-medium">Maat</th>
                <th className="py-1 pr-3 font-medium text-right">m²</th>
                <th className="py-1 pr-3 font-medium">Klant</th>
                <th className="py-1 pr-3 font-medium">Order</th>
                <th className="py-1 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {snijstukken.map((s) => {
                const stukM2 = (s.snij_lengte_cm * s.snij_breedte_cm) / 10000
                return (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 text-slate-700 font-mono">
                      {s.snij_breedte_cm}&times;{s.snij_lengte_cm} cm
                    </td>
                    <td className="py-1.5 pr-3 text-right text-slate-600">{stukM2.toFixed(1)}</td>
                    <td className="py-1.5 pr-3 text-slate-600">{s.klant_naam}</td>
                    <td className="py-1.5 pr-3">
                      <Link to={`/orders/${s.order_id}`} className="text-terracotta-500 hover:underline font-mono">
                        {s.order_nr}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className={cn('px-1.5 py-0.5 rounded-full', SNIJPLAN_STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-600')}>
                        {s.status}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Product-level reserveringen (nog niet gepland) */}
      {hasReserveringen && (
        <div>
          <p className="text-xs font-medium text-slate-500 mb-2">
            Openstaande reserveringen op product ({reserveringen.length})
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400">
                <th className="py-1 pr-3 font-medium">Order</th>
                <th className="py-1 pr-3 font-medium">Klant</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 font-medium text-right">Te leveren</th>
              </tr>
            </thead>
            <tbody>
              {reserveringen.map((r) => (
                <tr key={r.order_id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3">
                    <Link to={`/orders/${r.order_id}`} className="text-terracotta-500 hover:underline font-mono">
                      {r.order_nr}
                    </Link>
                  </td>
                  <td className="py-1.5 pr-3 text-slate-600">{r.klant_naam ?? '—'}</td>
                  <td className="py-1.5 pr-3">
                    <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">{r.status}</span>
                  </td>
                  <td className="py-1.5 text-right font-medium text-slate-700">{r.te_leveren}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function RolTabel({ rollen }: { rollen: RolRow[] }) {
  const [expandedRolId, setExpandedRolId] = useState<number | null>(null)

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
          <th className="py-2 px-3 font-medium">Rolnummer</th>
          <th className="py-2 px-3 font-medium">Afmetingen</th>
          <th className="py-2 px-3 font-medium text-right">Oppervlak</th>
          <th className="py-2 px-3 font-medium">Status</th>
          <th className="py-2 px-3 font-medium">Locatie</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rollen.map((rol) => {
          const colors = ROL_STATUS_COLORS[rol.status] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
          const isExpanded = expandedRolId === rol.id
          return (
            <>
              <tr
                key={rol.id}
                onClick={() => setExpandedRolId(isExpanded ? null : rol.id)}
                className="hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <td className="py-2 px-3 font-mono text-xs">{rol.rolnummer}</td>
                <td className="py-2 px-3 text-slate-600">
                  {rol.lengte_cm} &times; {rol.breedte_cm} cm
                </td>
                <td className="py-2 px-3 text-right">{Number(rol.oppervlak_m2).toFixed(1)} m&sup2;</td>
                <td className="py-2 px-3">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full', colors.bg, colors.text)}>
                    {STATUS_LABELS[rol.status] ?? rol.status}
                  </span>
                </td>
                <td className="py-2 px-3 text-slate-500">{rol.locatie ?? '—'}</td>
              </tr>
              {isExpanded && (
                <tr key={`${rol.id}-details`}>
                  <td colSpan={5} className="p-0">
                    <RolDetails rolId={rol.id} artikelnr={rol.artikelnr} rolOppervlak={rol.oppervlak_m2} />
                  </td>
                </tr>
              )}
            </>
          )
        })}
      </tbody>
    </table>
  )
}

export function RollenGroepRow({ groep }: RollenGroepRowProps) {
  const [open, setOpen] = useState(false)

  // Calculate a usage percentage (arbitrary: based on reststuk ratio)
  const vollePct = groep.totaal_rollen > 0
    ? Math.round((groep.volle_rollen / groep.totaal_rollen) * 100)
    : 0

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      {/* Collapsed header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 flex-wrap">
          {open ? (
            <ChevronDown size={16} className="text-slate-400" />
          ) : (
            <ChevronRight size={16} className="text-slate-400" />
          )}
          <span className="font-medium text-slate-900">
            {groep.product_naam}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status="reststuk" count={groep.reststukken} />
            <StatusBadge status="in_snijplan" count={groep.aangebroken} />
            <StatusBadge status="beschikbaar" count={groep.volle_rollen} />
          </div>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <span className="text-xs text-slate-500">
            {groep.totaal_rollen} {groep.totaal_rollen === 1 ? 'rol' : 'rollen'}
          </span>
          <div className="flex items-center gap-2 min-w-[140px]">
            <span className="text-sm font-medium text-slate-700 whitespace-nowrap">
              {groep.totaal_m2.toFixed(1)} m&sup2;
            </span>
            <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: `${vollePct}%` }}
              />
            </div>
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="border-t border-slate-100 px-2 py-2">
          <RolTabel rollen={groep.rollen} />
        </div>
      )}
    </div>
  )
}
