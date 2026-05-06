import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Pencil, Search, X } from 'lucide-react'
import { useVertegenwoordigers } from '@/hooks/use-klanten'
import { useSetKlantVerteg } from '@/hooks/use-vertegenwoordigers'

interface Props {
  debiteurNr: number
  vertegCode: string | null
  vertegNaam: string | null
  variant?: 'header' | 'info'
}

export function KlantVertegSelector({ debiteurNr, vertegCode, vertegNaam, variant = 'header' }: Props) {
  const [editing, setEditing] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: vertegen, isLoading } = useVertegenwoordigers()
  const mutation = useSetKlantVerteg()

  useEffect(() => {
    if (!editing) return
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setEditing(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [editing])

  const filtered = useMemo(() => {
    if (!vertegen) return []
    const s = search.trim().toLowerCase()
    if (!s) return vertegen.slice(0, 100)
    return vertegen
      .filter((v) => v.code.toLowerCase().includes(s) || v.naam.toLowerCase().includes(s))
      .slice(0, 100)
  }, [vertegen, search])

  const handlePick = async (code: string | null) => {
    try {
      await mutation.mutateAsync({ debiteurNr, code })
      setEditing(false)
      setSearch('')
    } catch {
      // mutation.error wordt zichtbaar via UI
    }
  }

  if (!editing) {
    if (variant === 'header') {
      return (
        <span className="inline-flex items-center gap-2 text-sm text-slate-500">
          Verteg:{' '}
          {vertegNaam ? (
            <span className="font-medium text-slate-700">{vertegNaam}</span>
          ) : (
            <span className="italic text-slate-400">Geen</span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium inline-flex items-center gap-1"
          >
            <Pencil size={11} />
            Wijzig
          </button>
        </span>
      )
    }
    return (
      <div>
        <span className="text-slate-500 text-xs">Vertegenwoordiger</span>
        <div className="flex items-center gap-2 mt-0.5">
          {vertegNaam ? (
            <span className="font-medium text-sm text-slate-700">{vertegNaam}</span>
          ) : vertegCode ? (
            <span className="font-medium text-sm text-slate-700">{vertegCode}</span>
          ) : (
            <span className="text-slate-400 italic text-sm">Geen</span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-terracotta-500 hover:text-terracotta-700 font-medium inline-flex items-center gap-1"
          >
            <Pencil size={11} />
            Wijzig
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={vertegNaam ?? 'Zoek vertegenwoordiger...'}
          autoFocus
          className="w-64 pl-8 pr-8 py-1.5 rounded-[var(--radius-sm)] border border-terracotta-300 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-300"
        />
        <button
          onClick={() => {
            setEditing(false)
            setSearch('')
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
        >
          <X size={12} />
        </button>
      </div>

      <div className="absolute z-30 mt-1 w-72 max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg">
        {isLoading ? (
          <div className="p-3 text-xs text-slate-400">Laden...</div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {vertegCode && (
              <li>
                <button
                  onClick={() => handlePick(null)}
                  disabled={mutation.isPending}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-rose-50 text-rose-600 disabled:opacity-50"
                >
                  Vertegenwoordiger loskoppelen
                </button>
              </li>
            )}
            {filtered.length === 0 ? (
              <li className="p-3 text-xs text-slate-400">Geen vertegenwoordiger gevonden</li>
            ) : (
              filtered.map((v) => {
                const active = v.code === vertegCode
                return (
                  <li key={v.code}>
                    <button
                      onClick={() => handlePick(v.code)}
                      disabled={mutation.isPending || active}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                        active ? 'bg-terracotta-50 text-terracotta-700' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="font-mono text-xs text-slate-400 w-10">{v.code}</span>
                      <span className="flex-1 truncate">{v.naam}</span>
                      {active && <Check size={14} className="text-terracotta-500" />}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
