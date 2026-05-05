import { Cylinder, MapPin } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { ROL_STATUS_COLORS } from '@/lib/utils/constants'
import type { SnijRolVoorstel } from '@/lib/types/productie'

interface RolHeaderCardProps {
  voorstel: SnijRolVoorstel
  compact?: boolean
}

const ROL_STATUS_LABELS: Record<string, string> = {
  beschikbaar: 'VOL',
  gereserveerd: 'GERESV.',
  in_snijplan: 'IN PLAN',
  gesneden: 'GESNEDEN',
  reststuk: 'RESTSTUK',
  verkocht: 'VERKOCHT',
}

export function RolHeaderCard({ voorstel, compact }: RolHeaderCardProps) {
  const statusLabel = ROL_STATUS_LABELS[voorstel.rol_status] ?? voorstel.rol_status
  const colors = ROL_STATUS_COLORS[voorstel.rol_status] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
  const oppervlak = ((voorstel.rol_breedte_cm * voorstel.rol_lengte_cm) / 10000).toFixed(1)
  const ingedeeldLengte = (voorstel.gebruikte_lengte_cm / 100).toFixed(1)
  const stukCount = voorstel.stukken.length

  return (
    <div className={cn(
      'bg-white rounded-[var(--radius)] border border-slate-200 flex items-start justify-between',
      compact ? 'p-3' : 'p-4 mb-6'
    )}>
      {/* Left side */}
      <div className="flex items-start gap-3">
        <Cylinder size={compact ? 18 : 22} className="text-slate-400 mt-0.5" />
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', colors.bg, colors.text)}>
              {statusLabel}
            </span>
            <span className={cn('font-medium', compact ? 'text-sm' : 'text-base')}>
              {voorstel.rolnummer}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {voorstel.rol_breedte_cm} x {voorstel.rol_lengte_cm} cm ({oppervlak} m2)
          </p>
          {voorstel.locatie && (
            <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
              <MapPin size={12} />
              {voorstel.locatie}
            </div>
          )}
        </div>
      </div>

      {/* Right side */}
      <div className="text-right text-sm">
        <p className="text-slate-500">
          Nodig: {((voorstel.gebruikte_lengte_cm * voorstel.rol_breedte_cm) / 10000).toFixed(1)} m2
        </p>
        <p className="font-medium text-slate-700">
          Ingedeeld: {ingedeeldLengte}m ({stukCount} st)
        </p>
      </div>
    </div>
  )
}
