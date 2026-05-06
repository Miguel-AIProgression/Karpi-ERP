import { useEffect, useState } from 'react'
import {
  useVertegWerkdagen,
  useUpsertVertegWerkdag,
  useDeleteVertegWerkdag,
} from '@/hooks/use-vertegenwoordigers'

interface Props {
  code: string
}

const DAGEN: { dag: number; kort: string; lang: string }[] = [
  { dag: 1, kort: 'Ma', lang: 'Maandag' },
  { dag: 2, kort: 'Di', lang: 'Dinsdag' },
  { dag: 3, kort: 'Wo', lang: 'Woensdag' },
  { dag: 4, kort: 'Do', lang: 'Donderdag' },
  { dag: 5, kort: 'Vr', lang: 'Vrijdag' },
  { dag: 6, kort: 'Za', lang: 'Zaterdag' },
  { dag: 7, kort: 'Zo', lang: 'Zondag' },
]

interface Draft {
  start_tijd: string
  eind_tijd: string
  opmerking: string
}

const EMPTY_DRAFT: Draft = { start_tijd: '', eind_tijd: '', opmerking: '' }

function timeToInput(t: string | null): string {
  if (!t) return ''
  // PostgreSQL TIME komt terug als "HH:mm:ss" — input[type=time] verwacht "HH:mm"
  return t.length >= 5 ? t.slice(0, 5) : t
}

function inputToTime(t: string): string | null {
  return t.trim() === '' ? null : t
}

export function VertegWerkdagenTab({ code }: Props) {
  const { data: werkdagen, isLoading } = useVertegWerkdagen(code)
  const upsert = useUpsertVertegWerkdag()
  const remove = useDeleteVertegWerkdag()

  const [drafts, setDrafts] = useState<Record<number, Draft>>({})

  // Sync drafts wanneer data binnenkomt
  useEffect(() => {
    if (!werkdagen) return
    const map: Record<number, Draft> = {}
    for (const w of werkdagen) {
      map[w.dag_van_week] = {
        start_tijd: timeToInput(w.start_tijd),
        eind_tijd: timeToInput(w.eind_tijd),
        opmerking: w.opmerking ?? '',
      }
    }
    setDrafts(map)
  }, [werkdagen])

  if (isLoading) return <div className="p-5 text-sm text-slate-400">Laden...</div>

  const isWerkdag = (dag: number) =>
    werkdagen?.some((w) => w.dag_van_week === dag) ?? false

  const handleToggle = async (dag: number) => {
    if (isWerkdag(dag)) {
      await remove.mutateAsync({ code, dagVanWeek: dag })
    } else {
      await upsert.mutateAsync({
        code,
        werkdag: { dag_van_week: dag, start_tijd: null, eind_tijd: null, opmerking: null },
      })
    }
  }

  const handleSaveTijden = async (dag: number) => {
    const draft = drafts[dag] ?? EMPTY_DRAFT
    await upsert.mutateAsync({
      code,
      werkdag: {
        dag_van_week: dag,
        start_tijd: inputToTime(draft.start_tijd),
        eind_tijd: inputToTime(draft.eind_tijd),
        opmerking: draft.opmerking.trim() === '' ? null : draft.opmerking.trim(),
      },
    })
  }

  const setDraft = (dag: number, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [dag]: { ...(prev[dag] ?? EMPTY_DRAFT), ...patch },
    }))
  }

  return (
    <div className="p-5">
      <p className="text-sm text-slate-500 mb-4">
        Vink de dagen aan waarop deze vertegenwoordiger werkt. Tijden zijn optioneel —
        leeg laten betekent &quot;hele dag&quot;.
      </p>

      <div className="divide-y divide-slate-100 border border-slate-200 rounded-[var(--radius)] overflow-hidden">
        {DAGEN.map(({ dag, lang }) => {
          const werkt = isWerkdag(dag)
          const draft = drafts[dag] ?? EMPTY_DRAFT

          return (
            <div
              key={dag}
              className={`flex items-center gap-4 px-4 py-3 ${werkt ? 'bg-white' : 'bg-slate-50/50'}`}
            >
              {/* Toggle + dagnaam */}
              <button
                type="button"
                role="switch"
                aria-checked={werkt}
                onClick={() => handleToggle(dag)}
                disabled={upsert.isPending || remove.isPending}
                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 disabled:opacity-50 ${
                  werkt ? 'bg-terracotta-500' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    werkt ? 'translate-x-4' : 'translate-x-0.5'
                  }`}
                />
              </button>

              <span
                className={`w-28 text-sm font-medium ${werkt ? 'text-slate-900' : 'text-slate-400'}`}
              >
                {lang}
              </span>

              {/* Tijden + opmerking — alleen tonen als werkt=true */}
              {werkt ? (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={draft.start_tijd}
                      onChange={(e) => setDraft(dag, { start_tijd: e.target.value })}
                      onBlur={() => handleSaveTijden(dag)}
                      className="px-2 py-1 rounded-[var(--radius-sm)] border border-slate-200 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                    />
                    <span className="text-slate-400 text-xs">tot</span>
                    <input
                      type="time"
                      value={draft.eind_tijd}
                      onChange={(e) => setDraft(dag, { eind_tijd: e.target.value })}
                      onBlur={() => handleSaveTijden(dag)}
                      className="px-2 py-1 rounded-[var(--radius-sm)] border border-slate-200 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                    />
                  </div>

                  <input
                    type="text"
                    value={draft.opmerking}
                    onChange={(e) => setDraft(dag, { opmerking: e.target.value })}
                    onBlur={() => handleSaveTijden(dag)}
                    placeholder="Opmerking (bijv. 'thuis', 'oneven weken')"
                    className="flex-1 px-2 py-1 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
                  />
                </>
              ) : (
                <span className="text-xs text-slate-400 italic">Werkt niet</span>
              )}
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-slate-400">
        Wijzigingen worden automatisch opgeslagen wanneer je het veld verlaat.
      </p>
    </div>
  )
}
