import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, ArrowRight } from 'lucide-react'
import {
  useActieveBetaalcondities,
  useBulkSetBetaalconditie,
  useKlantenVoorBetaalconditie,
} from '@/hooks/use-betaalcondities'
import { formatBetaalconditie } from '@/lib/supabase/queries/betaalcondities'
import { StatusBadge } from '@/components/ui/status-badge'

interface Props {
  code: string
  naam: string
  onClose: () => void
}

export function BetaalconditieKlantenDialog({ code, naam, onClose }: Props) {
  const { data: klanten, isLoading, error } = useKlantenVoorBetaalconditie(code)
  const { data: alleCondities } = useActieveBetaalcondities()
  const bulk = useBulkSetBetaalconditie()

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [targetCode, setTargetCode] = useState<string>('')
  const [actionError, setActionError] = useState<string | null>(null)

  const klantList = klanten ?? []
  const allSelected = klantList.length > 0 && selected.size === klantList.length
  const someSelected = selected.size > 0 && !allSelected

  const targets = useMemo(
    () => (alleCondities ?? []).filter((c) => c.code !== code),
    [alleCondities, code],
  )

  const toggleAll = () => {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(klantList.map((k) => k.debiteur_nr)))
  }

  const toggleOne = (nr: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(nr)) next.delete(nr)
      else next.add(nr)
      return next
    })
  }

  const verplaats = async () => {
    setActionError(null)
    if (selected.size === 0 || !targetCode) return
    const target = targets.find((c) => c.code === targetCode)
    if (!target) return
    const targetLabel = formatBetaalconditie(target)
    const ok = confirm(
      `${selected.size} klant(en) verplaatsen van "${code} - ${naam}" naar "${targetLabel}"?`,
    )
    if (!ok) return
    try {
      await bulk.mutateAsync({
        debiteurNrs: Array.from(selected),
        value: targetLabel,
      })
      setSelected(new Set())
      setTargetCode('')
    } catch (err) {
      console.error('[BulkVerplaats]', err)
      const e = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown } | null
      const parts = [
        typeof e?.message === 'string' ? e.message : null,
        typeof e?.details === 'string' ? `details: ${e.details}` : null,
        typeof e?.hint === 'string' ? `hint: ${e.hint}` : null,
        typeof e?.code === 'string' ? `code: ${e.code}` : null,
      ].filter(Boolean)
      setActionError(parts.length > 0 ? parts.join(' — ') : 'Onbekende fout (zie console)')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="bg-white rounded-[var(--radius)] shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="font-medium text-lg">Klanten met deze betaalconditie</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              <code className="px-1 py-0.5 bg-slate-100 rounded">{code}</code> — {naam}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </header>

        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="p-6 text-sm text-slate-400">Laden...</div>
          ) : error ? (
            <div className="p-6 text-sm text-rose-600">
              Laden mislukt: {error instanceof Error ? error.message : 'onbekende fout'}
            </div>
          ) : klantList.length === 0 ? (
            <div className="p-6 text-sm text-slate-400">Geen klanten gebruiken deze conditie.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 z-10">
                <tr className="border-b border-slate-100 text-xs text-slate-500">
                  <th className="px-4 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someSelected
                      }}
                      onChange={toggleAll}
                      className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400"
                      aria-label="Alle klanten selecteren"
                    />
                  </th>
                  <th className="text-left px-4 py-2 font-medium w-24">Nr</th>
                  <th className="text-left px-4 py-2 font-medium">Naam</th>
                  <th className="text-left px-4 py-2 font-medium w-40">Plaats</th>
                  <th className="text-center px-4 py-2 font-medium w-24">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {klantList.map((k) => {
                  const checked = selected.has(k.debiteur_nr)
                  return (
                    <tr
                      key={k.debiteur_nr}
                      className={`hover:bg-slate-50 ${checked ? 'bg-terracotta-50/40' : ''}`}
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(k.debiteur_nr)}
                          className="rounded border-slate-300 text-terracotta-500 focus:ring-terracotta-400"
                          aria-label={`Selecteer ${k.naam}`}
                        />
                      </td>
                      <td className="px-4 py-2 text-slate-400 tabular-nums">#{k.debiteur_nr}</td>
                      <td className="px-4 py-2">
                        <Link
                          to={`/klanten/${k.debiteur_nr}`}
                          onClick={onClose}
                          className="text-terracotta-500 hover:underline font-medium"
                        >
                          {k.naam}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-slate-500">{k.plaats ?? '—'}</td>
                      <td className="px-4 py-2 text-center">
                        <StatusBadge status={k.status} type="order" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="border-t border-slate-100 px-6 py-3 shrink-0 space-y-2">
          {actionError && (
            <div className="px-3 py-2 bg-rose-50 border border-rose-100 text-xs text-rose-700 rounded-[var(--radius-sm)] whitespace-pre-line">
              {actionError}
            </div>
          )}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs text-slate-500">
              {selected.size > 0
                ? `${selected.size} van ${klantList.length} geselecteerd`
                : `${klantList.length} klant(en)`}
            </span>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <>
                  <span className="text-xs text-slate-500 inline-flex items-center gap-1">
                    Verplaats naar
                    <ArrowRight size={12} />
                  </span>
                  <select
                    value={targetCode}
                    onChange={(e) => setTargetCode(e.target.value)}
                    className="px-2 py-1.5 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30"
                  >
                    <option value="">— Kies conditie —</option>
                    {targets.map((c) => (
                      <option key={c.code} value={c.code}>
                        {formatBetaalconditie(c)}{c.dagen != null ? ` (${c.dagen} dgn)` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={verplaats}
                    disabled={!targetCode || bulk.isPending}
                    className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-50"
                  >
                    {bulk.isPending ? 'Verplaatsen...' : 'Verplaatsen'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
              >
                Sluiten
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
