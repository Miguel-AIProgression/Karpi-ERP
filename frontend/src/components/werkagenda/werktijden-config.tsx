import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { STANDAARD_WERKTIJDEN, type Werktijden } from '@/lib/utils/bereken-agenda'
import { cn } from '@/lib/utils/cn'

const STORAGE_KEY = 'karpi.werkagenda.werktijden'
const LEGACY_STORAGE_KEY = 'karpi.snijagenda.werktijden'
const DAG_LABELS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

export function useWerktijden(): [Werktijden, (w: Werktijden) => void] {
  const [werktijden, setWerktijden] = useState<Werktijden>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return { ...STANDAARD_WERKTIJDEN, ...JSON.parse(raw) }
      // Backwards-compat: migreer oude key naar nieuwe key
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
      if (legacy) {
        try { localStorage.setItem(STORAGE_KEY, legacy) } catch { /* ignore */ }
        try { localStorage.removeItem(LEGACY_STORAGE_KEY) } catch { /* ignore */ }
        return { ...STANDAARD_WERKTIJDEN, ...JSON.parse(legacy) }
      }
    } catch { /* ignore */ }
    return STANDAARD_WERKTIJDEN
  })
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(werktijden)) } catch { /* ignore */ }
  }, [werktijden])
  return [werktijden, setWerktijden]
}

interface Props {
  werktijden: Werktijden
  onChange: (w: Werktijden) => void
}

export function WerktijdenConfig({ werktijden, onChange }: Props) {
  const [open, setOpen] = useState(false)

  const toggleDag = (dag: number) => {
    const set = new Set(werktijden.werkdagen)
    if (set.has(dag)) set.delete(dag); else set.add(dag)
    onChange({ ...werktijden, werkdagen: Array.from(set).sort() })
  }

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4 mb-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
      >
        <Settings size={16} />
        Werktijden {open ? '▾' : '▸'}
        <span className="text-xs font-normal text-slate-500 ml-2">
          {werktijden.werkdagen.length} dagen · {werktijden.start} – {werktijden.eind}
          {werktijden.pauzeStart && werktijden.pauzeEind && ` · pauze ${werktijden.pauzeStart}-${werktijden.pauzeEind}`}
        </span>
      </button>
      {open && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500 uppercase tracking-wide">Werkdagen</label>
            <div className="flex gap-1 mt-1">
              {DAG_LABELS.map((lbl, i) => {
                const iso = i + 1
                const actief = werktijden.werkdagen.includes(iso)
                return (
                  <button
                    key={lbl}
                    onClick={() => toggleDag(iso)}
                    className={cn(
                      'w-10 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium transition-colors',
                      actief ? 'bg-terracotta-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                    )}
                  >
                    {lbl}
                  </button>
                )
              })}
            </div>
          </div>
          <TijdVeld label="Start" value={werktijden.start} onChange={(v) => onChange({ ...werktijden, start: v })} />
          <TijdVeld label="Eind" value={werktijden.eind} onChange={(v) => onChange({ ...werktijden, eind: v })} />
          <TijdVeld label="Pauze start" value={werktijden.pauzeStart} onChange={(v) => onChange({ ...werktijden, pauzeStart: v })} />
          <TijdVeld label="Pauze eind" value={werktijden.pauzeEind} onChange={(v) => onChange({ ...werktijden, pauzeEind: v })} />
        </div>
      )}
    </div>
  )
}

function TijdVeld({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-xs text-slate-500 uppercase tracking-wide">{label}</label>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
      />
    </div>
  )
}
