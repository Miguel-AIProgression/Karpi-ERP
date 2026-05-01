import { useState } from 'react'
import { Check, X, Pencil } from 'lucide-react'
import { useUpdateSnijplanLocatie } from '@/hooks/use-pick-ship'

interface Props {
  snijplanId: number
  locatie: string | null
}

export function LocatieEdit({ snijplanId, locatie }: Props) {
  const [bewerken, setBewerken] = useState(false)
  const [waarde, setWaarde] = useState(locatie ?? '')
  const mut = useUpdateSnijplanLocatie()

  if (!bewerken) {
    if (locatie) {
      return (
        <button
          onClick={() => {
            setWaarde(locatie)
            setBewerken(true)
          }}
          className="inline-flex items-center gap-1 text-slate-700 hover:text-terracotta-600 group"
        >
          <span>{locatie}</span>
          <Pencil size={11} className="opacity-0 group-hover:opacity-60" />
        </button>
      )
    }
    return (
      <button
        onClick={() => setBewerken(true)}
        className="text-xs text-terracotta-500 hover:text-terracotta-600"
      >
        + locatie
      </button>
    )
  }

  const opslaan = async () => {
    await mut.mutateAsync({ snijplanId, locatie: waarde.trim() || null })
    setBewerken(false)
  }

  return (
    <div className="inline-flex items-center gap-1">
      <input
        autoFocus
        value={waarde}
        onChange={(e) => setWaarde(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') opslaan()
          if (e.key === 'Escape') setBewerken(false)
        }}
        placeholder="A-12"
        className="w-20 px-1.5 py-0.5 text-xs border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-terracotta-400"
      />
      <button
        onClick={opslaan}
        disabled={mut.isPending}
        className="text-emerald-600 hover:text-emerald-700"
      >
        <Check size={14} />
      </button>
      <button onClick={() => setBewerken(false)} className="text-slate-400 hover:text-slate-600">
        <X size={14} />
      </button>
    </div>
  )
}
