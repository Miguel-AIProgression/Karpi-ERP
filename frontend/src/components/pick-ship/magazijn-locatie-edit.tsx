import { useMemo, useState } from 'react'
import { Check, Pencil, X } from 'lucide-react'
import { useMagazijnLocaties } from '@/hooks/use-magazijn-locaties'

interface Props {
  /** Huidige locatie-code (text voor maatwerk; ML.code voor rol). NULL = niet ingesteld. */
  huidigeCode: string | null
  /** Wordt aangeroepen na "✓"-klik met de genormaliseerde UPPER-code. */
  onSave: (code: string) => Promise<void>
}

export function MagazijnLocatieEdit({ huidigeCode, onSave }: Props) {
  const [bewerken, setBewerken] = useState(false)
  const [waarde, setWaarde] = useState(huidigeCode ?? '')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const { data: locaties } = useMagazijnLocaties()

  const suggesties = useMemo(() => {
    if (!locaties || !waarde) return []
    const q = waarde.toUpperCase()
    return locaties.filter((l) => l.code.includes(q)).slice(0, 8)
  }, [locaties, waarde])

  if (!bewerken) {
    if (huidigeCode) {
      return (
        <button
          onClick={() => {
            setWaarde(huidigeCode)
            setBewerken(true)
          }}
          className="inline-flex items-center gap-1 text-slate-700 hover:text-terracotta-600 group"
        >
          <span className="font-mono text-xs">{huidigeCode}</span>
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
    const code = waarde.trim().toUpperCase()
    if (!code) {
      setBewerken(false)
      return
    }
    setBezig(true)
    setFout(null)
    try {
      await onSave(code)
      setBewerken(false)
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan mislukt')
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-0.5 relative">
      <div className="inline-flex items-center gap-1">
        <input
          autoFocus
          value={waarde}
          onChange={(e) => setWaarde(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === 'Enter') opslaan()
            if (e.key === 'Escape') setBewerken(false)
          }}
          placeholder="A-12"
          className="w-24 px-1.5 py-0.5 text-xs border border-slate-300 rounded font-mono focus:outline-none focus:ring-1 focus:ring-terracotta-400"
        />
        <button
          onClick={opslaan}
          disabled={bezig}
          className="text-emerald-600 hover:text-emerald-700 disabled:opacity-40"
        >
          <Check size={14} />
        </button>
        <button onClick={() => setBewerken(false)} className="text-slate-400 hover:text-slate-600">
          <X size={14} />
        </button>
      </div>
      {fout && (
        <span className="text-xs text-rose-500 mt-0.5">{fout}</span>
      )}
      {suggesties.length > 0 && (
        <ul className="absolute top-6 left-0 z-10 bg-white border border-slate-200 rounded shadow-md text-xs min-w-[6rem]">
          {suggesties.map((l) => (
            <li
              key={l.id}
              onMouseDown={(e) => {
                e.preventDefault()
                setWaarde(l.code)
              }}
              className="px-2 py-1 font-mono hover:bg-slate-100 cursor-pointer"
            >
              {l.code}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
