import { useCallback, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, Plus, Trash2 } from 'lucide-react'
import { STANDAARD_WERKTIJDEN, type Werktijden } from '@/lib/utils/bereken-agenda'
import { cn } from '@/lib/utils/cn'
import { fetchWerkagendaConfig, saveWerkagendaConfig } from '@/lib/supabase/queries/werkagenda'

const STORAGE_KEY = 'karpi.werkagenda.werktijden'
// Eenmalige localStorage→DB-overname mag maar één keer per pagina-sessie
// draaien, ook al mounten meerdere componenten deze hook tegelijk.
let adoptieGedaan = false
const LEGACY_STORAGE_KEY = 'karpi.snijagenda.werktijden'
const DAG_LABELS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

export function useWerktijden(): [Werktijden, (w: Werktijden) => void] {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['werkagenda-config'],
    queryFn: fetchWerkagendaConfig,
  })
  const mutation = useMutation({
    mutationFn: saveWerkagendaConfig,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['werkagenda-config'] }),
    // Bij een mislukte save de optimistische cache-waarde terugdraaien naar
    // de server-waarheid — anders lijkt een niet-opgeslagen wijziging bewaard.
    onError: () => queryClient.invalidateQueries({ queryKey: ['werkagenda-config'] }),
  })

  const setWerktijden = useCallback((w: Werktijden) => {
    // Optimistisch zodat de agenda direct herrekent; mutatie persisteert.
    queryClient.setQueryData(['werkagenda-config'], w)
    mutation.mutate(w)
  }, [queryClient, mutation.mutate]) // eslint-disable-line react-hooks/exhaustive-deps

  // Eenmalige overname van de oude per-browser localStorage-config: alleen
  // als de DB-rij nog exact de default is (= nooit centraal aangepast) nemen
  // we de lokale instellingen over; daarna verdwijnt de localStorage-key.
  useEffect(() => {
    if (!data || adoptieGedaan) return
    adoptieGedaan = true
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
      if (raw) {
        const lokaal = { ...STANDAARD_WERKTIJDEN, ...JSON.parse(raw) } as Werktijden
        const dbIsDefault = JSON.stringify(data) === JSON.stringify(STANDAARD_WERKTIJDEN)
        const lokaalAfwijkend = JSON.stringify(lokaal) !== JSON.stringify(STANDAARD_WERKTIJDEN)
        if (dbIsDefault && lokaalAfwijkend) setWerktijden(lokaal)
      }
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch { /* ignore */ }
  }, [data, setWerktijden])

  return [data ?? STANDAARD_WERKTIJDEN, setWerktijden]
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
          {werktijden.pauzes.length > 0 && ` · ${werktijden.pauzes.length} pauze${werktijden.pauzes.length === 1 ? '' : 's'}`}
        </span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
          </div>

          <div>
            <label className="text-xs text-slate-500 uppercase tracking-wide">Pauzes</label>
            <div className="mt-1 space-y-2">
              {werktijden.pauzes.map((pauze, i) => (
                <div key={i} className="flex items-end gap-2">
                  <TijdVeld
                    label="Van"
                    value={pauze.start}
                    onChange={(v) => {
                      const pauzes = werktijden.pauzes.map((p, j) => (j === i ? { ...p, start: v } : p))
                      onChange({ ...werktijden, pauzes })
                    }}
                  />
                  <TijdVeld
                    label="Tot"
                    value={pauze.eind}
                    onChange={(v) => {
                      const pauzes = werktijden.pauzes.map((p, j) => (j === i ? { ...p, eind: v } : p))
                      onChange({ ...werktijden, pauzes })
                    }}
                  />
                  <button
                    onClick={() => onChange({ ...werktijden, pauzes: werktijden.pauzes.filter((_, j) => j !== i) })}
                    className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                    title="Pauze verwijderen"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => onChange({ ...werktijden, pauzes: [...werktijden.pauzes, { start: '', eind: '' }] })}
                className="inline-flex items-center gap-1.5 text-xs text-terracotta-600 hover:text-terracotta-700 font-medium"
              >
                <Plus size={13} /> Pauze toevoegen
              </button>
            </div>
          </div>
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
