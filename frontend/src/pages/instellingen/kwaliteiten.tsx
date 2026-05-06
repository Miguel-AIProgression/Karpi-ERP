import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, AlertCircle, CheckCircle2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { fetchKwaliteitenMetGewicht, updateKwaliteitGewicht, type KwaliteitMetGewicht } from '@/lib/supabase/queries/kwaliteiten'
import { formatNumber } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'

type Filter = 'alle' | 'ontbreekt' | 'ingevuld'

export function KwaliteitenInstellingenPage() {
  const queryClient = useQueryClient()
  const { data: kwaliteiten = [], isLoading } = useQuery({
    queryKey: ['kwaliteiten-met-gewicht'],
    queryFn: fetchKwaliteitenMetGewicht,
  })

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('alle')
  const [editing, setEditing] = useState<{ code: string; value: string } | null>(null)
  const [savedCode, setSavedCode] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (vars: { code: string; gewicht: number | null }) =>
      updateKwaliteitGewicht(vars.code, vars.gewicht),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['kwaliteiten-met-gewicht'] })
      queryClient.invalidateQueries({ queryKey: ['product-detail'] })
      setSavedCode(vars.code)
      setEditing(null)
      setTimeout(() => setSavedCode(null), 2000)
    },
  })

  const stats = useMemo(() => {
    const total = kwaliteiten.length
    const ingevuld = kwaliteiten.filter((q) => q.gewicht_per_m2_kg != null).length
    return { total, ingevuld, ontbreekt: total - ingevuld }
  }, [kwaliteiten])

  const gefilterd = useMemo(() => {
    const term = search.trim().toLowerCase()
    return kwaliteiten.filter((q) => {
      if (filter === 'ingevuld' && q.gewicht_per_m2_kg == null) return false
      if (filter === 'ontbreekt' && q.gewicht_per_m2_kg != null) return false
      if (term) {
        const haystack = `${q.code} ${q.omschrijving ?? ''}`.toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [kwaliteiten, search, filter])

  function startEdit(q: KwaliteitMetGewicht) {
    setEditing({
      code: q.code,
      value: q.gewicht_per_m2_kg != null ? String(q.gewicht_per_m2_kg) : '',
    })
  }

  function commitEdit() {
    if (!editing) return
    const trimmed = editing.value.trim().replace(',', '.')
    const parsed = trimmed === '' ? null : Number(trimmed)
    if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) {
      setEditing(null)
      return
    }
    mutation.mutate({ code: editing.code, gewicht: parsed })
  }

  if (isLoading) {
    return <PageHeader title="Kwaliteiten laden..." />
  }

  return (
    <>
      <PageHeader
        title="Kwaliteiten — gewicht per m²"
        description="Bron-van-waarheid voor automatische gewicht-berekening op orderregels en zendingen."
      />

      {/* Banner */}
      {stats.ontbreekt > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius)] p-4 mb-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm">
            <span className="font-medium text-amber-900">
              {stats.ontbreekt} van {stats.total} kwaliteiten missen gewicht/m².
            </span>{' '}
            <span className="text-amber-800">
              Producten in deze kwaliteiten gebruiken nog legacy-gewicht. Zending-pakbonnen kunnen onnauwkeurige gewichten tonen.
            </span>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-4 mb-4 flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <Search size={16} className="text-slate-400" />
          <input
            type="search"
            placeholder="Zoek op code of omschrijving..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-sm focus:outline-none"
          />
        </div>
        <div className="flex gap-1 text-sm">
          <FilterButton active={filter === 'alle'} onClick={() => setFilter('alle')}>
            Alle ({stats.total})
          </FilterButton>
          <FilterButton active={filter === 'ontbreekt'} onClick={() => setFilter('ontbreekt')}>
            Ontbreekt ({stats.ontbreekt})
          </FilterButton>
          <FilterButton active={filter === 'ingevuld'} onClick={() => setFilter('ingevuld')}>
            Ingevuld ({stats.ingevuld})
          </FilterButton>
        </div>
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left">
              <th className="px-4 py-2 font-medium text-slate-600">Code</th>
              <th className="px-4 py-2 font-medium text-slate-600">Omschrijving</th>
              <th className="px-4 py-2 font-medium text-slate-600 text-right">Std breedte</th>
              <th className="px-4 py-2 font-medium text-slate-600 text-right">Gewicht/m²</th>
              <th className="px-4 py-2 font-medium text-slate-600 text-right">Producten</th>
            </tr>
          </thead>
          <tbody>
            {gefilterd.map((q) => {
              const isEditing = editing?.code === q.code
              const isSaved = savedCode === q.code
              const isPending = mutation.isPending && mutation.variables?.code === q.code
              return (
                <tr key={q.code} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-2 font-mono text-xs">{q.code}</td>
                  <td className="px-4 py-2 text-slate-700">{q.omschrijving ?? '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-500">
                    {q.standaard_breedte_cm ? `${q.standaard_breedte_cm} cm` : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          autoFocus
                          type="text"
                          inputMode="decimal"
                          value={editing.value}
                          onChange={(e) => setEditing({ code: q.code, value: e.target.value })}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitEdit()
                            if (e.key === 'Escape') setEditing(null)
                          }}
                          className="w-20 px-2 py-1 border border-terracotta-300 rounded text-right"
                        />
                        <span className="text-xs text-slate-400">kg</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => startEdit(q)}
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-slate-100',
                          q.gewicht_per_m2_kg == null ? 'text-slate-400 italic' : 'text-slate-800',
                        )}
                        disabled={isPending}
                      >
                        {q.gewicht_per_m2_kg != null
                          ? `${formatNumber(q.gewicht_per_m2_kg, 3)} kg`
                          : 'klik om in te vullen'}
                        {isSaved && <CheckCircle2 size={14} className="text-emerald-600" />}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right text-slate-500">
                    {q.aantal_producten > 0 ? q.aantal_producten : '—'}
                  </td>
                </tr>
              )
            })}
            {gefilterd.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">
                  Geen kwaliteiten gevonden voor deze filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1 rounded text-xs',
        active ? 'bg-terracotta-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
      )}
    >
      {children}
    </button>
  )
}
