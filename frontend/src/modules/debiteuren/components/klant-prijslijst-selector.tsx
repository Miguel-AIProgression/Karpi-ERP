import { useMemo, useState, useRef, useEffect } from 'react'
import { Search, Check, X, Pencil } from 'lucide-react'
import { Link } from 'react-router-dom'
import { usePrijslijstHeadersList, useSetKlantPrijslijst } from '../hooks/use-debiteuren'

interface Props {
  debiteurNr: number
  prijslijstNr: string | null
  prijslijstNaam: string | null
}

export function KlantPrijslijstSelector({ debiteurNr, prijslijstNr, prijslijstNaam }: Props) {
  const [editing, setEditing] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: headers, isLoading } = usePrijslijstHeadersList()
  const mutation = useSetKlantPrijslijst()

  // Sluit bij klik buiten
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
    if (!headers) return []
    const list = headers.filter((h) => h.actief)
    const s = search.trim().toLowerCase()
    if (!s) return list.slice(0, 100)
    return list
      .filter((h) => h.nr.toLowerCase().includes(s) || h.naam.toLowerCase().includes(s))
      .slice(0, 100)
  }, [headers, search])

  const handlePick = async (nr: string | null) => {
    try {
      await mutation.mutateAsync({ debiteurNr, prijslijstNr: nr })
      setEditing(false)
      setSearch('')
    } catch {
      // mutation.error wordt zichtbaar via UI
    }
  }

  if (!editing) {
    return (
      <div>
        <span className="text-slate-500 text-xs">Prijslijst</span>
        <div className="flex items-center gap-2 mt-0.5">
          {prijslijstNr ? (
            <Link
              to={`/prijslijsten/${prijslijstNr}`}
              className="text-terracotta-500 hover:underline font-medium text-sm"
            >
              {prijslijstNr}
              {prijslijstNaam ? ` — ${prijslijstNaam}` : ''}
            </Link>
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
    <div ref={containerRef} className="relative">
      <span className="text-slate-500 text-xs">Prijslijst</span>
      <div className="mt-0.5 relative">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={prijslijstNr ?? 'Zoek prijslijst...'}
            autoFocus
            className="w-full pl-8 pr-8 py-1.5 rounded-[var(--radius-sm)] border border-terracotta-300 text-sm focus:outline-none focus:ring-1 focus:ring-terracotta-300"
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
              {prijslijstNr && (
                <li>
                  <button
                    onClick={() => handlePick(null)}
                    disabled={mutation.isPending}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-rose-50 text-rose-600 disabled:opacity-50"
                  >
                    Prijslijst loskoppelen
                  </button>
                </li>
              )}
              {filtered.length === 0 ? (
                <li className="p-3 text-xs text-slate-400">Geen prijslijst gevonden</li>
              ) : (
                filtered.map((h) => {
                  const active = h.nr === prijslijstNr
                  return (
                    <li key={h.nr}>
                      <button
                        onClick={() => handlePick(h.nr)}
                        disabled={mutation.isPending || active}
                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                          active ? 'bg-terracotta-50 text-terracotta-700' : 'hover:bg-slate-50'
                        }`}
                      >
                        <span className="font-mono text-xs text-slate-400 w-12">{h.nr}</span>
                        <span className="flex-1 truncate">{h.naam}</span>
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
    </div>
  )
}
