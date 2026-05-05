import { useState, useEffect } from 'react'
import { Zap, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useAutoplanningConfig, useUpdateAutoplanningConfig } from '@/hooks/use-snijplanning'

export function AutoPlanningConfig() {
  const { data: config, isLoading } = useAutoplanningConfig()
  const updateConfig = useUpdateAutoplanningConfig()

  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (config) {
      setEnabled(config.enabled)
    }
  }, [config])

  const handleToggle = () => {
    const newEnabled = !enabled
    setEnabled(newEnabled)
    updateConfig.mutate({ enabled: newEnabled })
  }

  if (isLoading) return null

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleToggle}
        disabled={updateConfig.isPending}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
          enabled
            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
            : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
        )}
      >
        {updateConfig.isPending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Zap size={14} className={enabled ? 'text-emerald-600' : 'text-slate-400'} />
        )}
        Auto-planning {enabled ? 'aan' : 'uit'}
      </button>

    </div>
  )
}
