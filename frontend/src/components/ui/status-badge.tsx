import { cn } from '@/lib/utils/cn'
import { ORDER_STATUS_COLORS, TIER_COLORS } from '@/lib/utils/constants'

interface StatusBadgeProps {
  status: string
  type?: 'order' | 'tier'
  className?: string
}

export function StatusBadge({ status, type = 'order', className }: StatusBadgeProps) {
  const colors = type === 'tier'
    ? TIER_COLORS[status]
    : ORDER_STATUS_COLORS[status]

  const { bg, text } = colors ?? { bg: 'bg-gray-100', text: 'text-gray-600' }

  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
        bg,
        text,
        className
      )}
    >
      {status}
    </span>
  )
}
