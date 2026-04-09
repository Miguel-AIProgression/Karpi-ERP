import { useState, useEffect } from 'react'
import { Zap, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useAutoplanningConfig, useUpdateAutoplanningConfig } from '@/hooks/use-snijplanning'

const HORIZON_OPTIONS = [
  { label: '2 weken', weken: 2 },
  { label: '4 weken', weken: 4 },
  { label: '6 weken', weken: 6 },
  { label: '8 weken', weken: 8 },
  { label: '10 weken', weken: 10 },
  { label: '12 weken', weken: 12 },
]

export function AutoPlanningConfig() {
  const { data: config, isLoading } = useAutoplanningConfig()
  const updateConfig = useUpdateAutoplanningConfig()

  const [enabled, setEnabled] = useState(false)
  const [horizonWeken, setHorizonWeken] = useState(2)

  useEffect(() => {
    if (config) {
      setEnabled(config.enabled)
      setHorizonWeken(config.horizon_weken)
    }
  }, [config])

  const handleToggle = () => {
    const newEnabled = !enabled
    setEnabled(newEnabled)
    updateConfig.mutate({ enabled: newEnabled, horizon_weken: horizonWeken })
  }

  const handleHorizonChange = (weken: number) => {
    setHorizonWeken(weken)
    updateConfig.mutate({ enabled, horizon_weken: weken })
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

      {enabled && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400">Horizon:</span>
          <select
            value={horizonWeken}
            onChange={(e) => handleHorizonChange(Number(e.target.value))}
            disabled={updateConfig.isPending}
            className="text-sm px-2 py-1 rounded-[var(--radius-sm)] border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400"
          >
            {HORIZON_OPTIONS.map((opt) => (
              <option key={opt.weken} value={opt.weken}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
