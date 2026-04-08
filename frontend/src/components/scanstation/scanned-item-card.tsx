import { Package, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { SNIJPLAN_STATUS_COLORS, CONFECTIE_STATUS_COLORS } from '@/lib/utils/constants'
import type { ScannedItem } from '@/lib/types/productie'

interface ScannedItemCardProps {
  item: ScannedItem | null
  isLoading?: boolean
  onOpboeken?: () => void
  isOpboeking?: boolean
}

const INPAK_READY_STATUSES = ['Gesneden', 'In confectie', 'Gereed']

function getStatusColors(item: ScannedItem) {
  const colors = item.type === 'snijplan'
    ? SNIJPLAN_STATUS_COLORS[item.status]
    : CONFECTIE_STATUS_COLORS[item.status]
  return colors ?? { bg: 'bg-gray-100', text: 'text-gray-600' }
}

function getBorderColor(item: ScannedItem) {
  if (item.status === 'Ingepakt') return 'border-teal-400'
  if (INPAK_READY_STATUSES.includes(item.status)) return 'border-emerald-400'
  return 'border-slate-200'
}

export function ScannedItemCard({ item, isLoading, onOpboeken, isOpboeking }: ScannedItemCardProps) {
  if (isLoading) {
    return (
      <div className="bg-white rounded-[var(--radius)] border-2 border-slate-200 p-8 flex items-center justify-center min-h-[280px]">
        <Loader2 size={32} className="animate-spin text-slate-400" />
      </div>
    )
  }

  if (!item) {
    return (
      <div className="bg-white rounded-[var(--radius)] border-2 border-dashed border-slate-200 p-8 flex flex-col items-center justify-center min-h-[280px] text-slate-400">
        <Package size={48} className="mb-3 opacity-50" />
        <p className="text-lg">Scan een sticker om te beginnen</p>
      </div>
    )
  }

  const statusColors = getStatusColors(item)
  const canOpboeken = INPAK_READY_STATUSES.includes(item.status)
  const isAlreadyPacked = item.status === 'Ingepakt'

  return (
    <div className={cn(
      'bg-white rounded-[var(--radius)] border-2 p-6 min-h-[280px] flex flex-col',
      getBorderColor(item)
    )}>
      {/* Product heading */}
      <div className="mb-4">
        <h3 className="text-2xl font-semibold text-slate-900">
          {item.kwaliteit_code} {item.kleur_code}
        </h3>
        <p className="text-base text-slate-500 mt-1">{item.scancode}</p>
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-base flex-1">
        <div>
          <span className="text-sm text-slate-400">Maat</span>
          <p className="font-medium text-slate-800">{item.maat} cm</p>
        </div>
        <div>
          <span className="text-sm text-slate-400">Klant</span>
          <p className="font-medium text-slate-800">{item.klant_naam}</p>
        </div>
        <div>
          <span className="text-sm text-slate-400">Order</span>
          <p className="font-medium text-slate-800">{item.order_nr}</p>
        </div>
        <div>
          <span className="text-sm text-slate-400">Afwerking</span>
          <p className="font-medium text-slate-800">{item.afwerking ?? 'Geen'}</p>
        </div>
        <div>
          <span className="text-sm text-slate-400">Type</span>
          <p className="font-medium text-slate-800">{item.type === 'snijplan' ? 'Snijplan' : 'Confectie'}</p>
        </div>
        <div>
          <span className="text-sm text-slate-400">Status</span>
          <span className={cn(
            'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium',
            statusColors.bg,
            statusColors.text
          )}>
            {item.status}
          </span>
        </div>
      </div>

      {/* Action button */}
      <div className="mt-5 pt-4 border-t border-slate-100">
        {canOpboeken ? (
          <button
            onClick={onOpboeken}
            disabled={isOpboeking}
            className={cn(
              'w-full min-h-[52px] rounded-[var(--radius)] text-lg font-semibold transition-colors',
              'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              'flex items-center justify-center gap-2'
            )}
          >
            {isOpboeking ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <CheckCircle2 size={20} />
            )}
            {isOpboeking ? 'Opboeken...' : 'Opboeken als Ingepakt'}
          </button>
        ) : isAlreadyPacked ? (
          <div className="w-full min-h-[52px] rounded-[var(--radius)] text-lg font-semibold bg-teal-50 text-teal-700 flex items-center justify-center gap-2">
            <CheckCircle2 size={20} />
            Al ingepakt
          </div>
        ) : (
          <div className="w-full min-h-[52px] rounded-[var(--radius)] text-lg font-semibold bg-amber-50 text-amber-700 flex items-center justify-center gap-2">
            <AlertCircle size={20} />
            Nog niet gereed voor inpak
          </div>
        )}
      </div>
    </div>
  )
}
