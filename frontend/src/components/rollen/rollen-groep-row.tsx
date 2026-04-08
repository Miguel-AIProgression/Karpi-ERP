import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { ROL_STATUS_COLORS } from '@/lib/utils/constants'
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

function RolTabel({ rollen }: { rollen: RolRow[] }) {
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
          return (
            <tr key={rol.id} className="hover:bg-slate-50 transition-colors">
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
