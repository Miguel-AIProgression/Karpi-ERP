import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, Pencil, Trash2, Plus, X, Check } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { useKleurenVoorKwaliteit, useKwaliteiten } from '@/hooks/use-producten'
import {
  useKlanteigenVoorKlant,
  useUpsertKlanteigenNaam,
  useUpdateKlanteigenNaam,
  useDeleteKlanteigenNaam,
} from '../hooks/use-klanteigen-namen'
import type { KlanteigenVoorKlantRow } from '../queries/klanteigen-namen'

interface Props {
  debiteurNr: number
}

export function KlanteigenNamenTab({ debiteurNr }: Props) {
  // Externe vertegenwoordiger (mig 489): read-only — geen toevoegen/bewerken/verwijderen.
  const { isExternRep } = useAuth()
  const { data: namen, isLoading } = useKlanteigenVoorKlant(debiteurNr)
  const [zoek, setZoek] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  // Overschrijven van een geërfde inkoopgroep-regel: pre-fill add-form
  const [overschrijfPrefill, setOverschrijfPrefill] = useState<KlanteigenVoorKlantRow | null>(null)

  const filtered = useMemo(() => {
    if (!namen) return []
    const q = zoek.trim().toLowerCase()
    if (!q) return namen
    return namen.filter(
      (n) =>
        n.kwaliteit_code.toLowerCase().includes(q) ||
        n.benaming.toLowerCase().includes(q) ||
        (n.omschrijving ?? '').toLowerCase().includes(q),
    )
  }, [namen, zoek])

  if (isLoading) return <div className="p-5 text-sm text-slate-400">Laden...</div>

  return (
    <>
      <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">
            {namen?.length ?? 0} {namen?.length === 1 ? 'eigen naam' : 'eigen namen'}
          </span>
          {!isExternRep && (
            <button
              type="button"
              onClick={() => { setShowAdd((v) => !v); setEditId(null) }}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] text-terracotta-600 bg-terracotta-50 hover:bg-terracotta-100 border border-terracotta-200"
            >
              {showAdd ? <X size={12} /> : <Plus size={12} />}
              {showAdd ? 'Annuleren' : 'Toevoegen'}
            </button>
          )}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Zoek op kwaliteit of naam..."
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-[var(--radius-sm)] w-64 focus:outline-none focus:ring-1 focus:ring-terracotta-300 focus:border-terracotta-300"
          />
        </div>
      </div>

      {showAdd && (
        <NaamForm
          debiteurNr={debiteurNr}
          prefill={overschrijfPrefill}
          onDone={() => { setShowAdd(false); setOverschrijfPrefill(null) }}
        />
      )}

      {filtered.length === 0 ? (
        <div className="p-5 text-sm text-slate-400">
          {namen?.length === 0 ? 'Nog geen klanteigen namen — klik op "Toevoegen".' : 'Geen treffers.'}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-5 py-2 font-medium">Kwaliteit</th>
              <th className="px-5 py-2 font-medium">Kleur</th>
              <th className="px-5 py-2 font-medium">Eigen naam</th>
              <th className="px-5 py-2 font-medium">Omschrijving</th>
              <th className="px-5 py-2 font-medium">Leverancier</th>
              <th className="px-5 py-2 font-medium">Bron</th>
              <th className="px-5 py-2 font-medium text-right">Acties</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((n) => {
              const rowKey = n.id ?? `inh-${n.kwaliteit_code}-${n.kleur_code ?? ''}`
              if (n.bron_niveau === 'klant' && n.id && editId === n.id) {
                return (
                  <NaamRowEdit
                    key={rowKey}
                    row={n}
                    debiteurNr={debiteurNr}
                    onDone={() => setEditId(null)}
                  />
                )
              }
              return (
                <NaamRow
                  key={rowKey}
                  row={n}
                  debiteurNr={debiteurNr}
                  onEdit={() => {
                    if (n.bron_niveau === 'klant' && n.id) {
                      setEditId(n.id)
                      setShowAdd(false)
                    } else {
                      // Geërfde regel → open add-form pre-filled, gebruiker maakt
                      // klant-specifieke override aan.
                      setOverschrijfPrefill(n)
                      setShowAdd(true)
                      setEditId(null)
                    }
                  }}
                />
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

function NaamRow({
  row, onEdit,
}: { row: KlanteigenVoorKlantRow; debiteurNr: number; onEdit: () => void }) {
  const { isExternRep } = useAuth()
  const del = useDeleteKlanteigenNaam()
  const isErved = row.bron_niveau === 'inkoopgroep'
  const handleDelete = () => {
    const label = row.kleur_code ? `${row.kwaliteit_code} kleur ${row.kleur_code}` : row.kwaliteit_code
    if (isErved) {
      if (!row.inkoopgroep_row_id) return
      const ok = confirm(
        `LET OP — geërfde alias\n\n"${row.benaming}" voor ${label} hoort bij inkoopgroep ${row.inkoopgroep_code}.\n\n` +
          `Verwijderen haalt deze alias weg voor ALLE klanten in deze inkoopgroep, niet alleen voor deze klant.\n\n` +
          `Weet je het zeker? Annuleer en gebruik "Wijzig" om alleen voor déze klant een eigen regel te maken.`,
      )
      if (ok) del.mutate(row.inkoopgroep_row_id)
      return
    }
    if (!row.id) return
    if (confirm(`Eigen naam voor ${label} ("${row.benaming}") verwijderen?`)) {
      del.mutate(row.id)
    }
  }
  return (
    <tr className={isErved ? 'bg-amber-50/30 hover:bg-amber-50/60' : 'hover:bg-slate-50'}>
      <td className="px-5 py-2 font-mono text-xs">{row.kwaliteit_code}</td>
      <td className="px-5 py-2">
        {row.kleur_code ? (
          <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-xs text-slate-600 font-mono">
            {row.kleur_code}
          </span>
        ) : (
          <span className="text-xs text-slate-400 italic">alle kleuren</span>
        )}
      </td>
      <td className="px-5 py-2 font-medium">{row.benaming}</td>
      <td className="px-5 py-2 text-slate-500">{row.omschrijving ?? '—'}</td>
      <td className="px-5 py-2 text-slate-500">{row.leverancier ?? '—'}</td>
      <td className="px-5 py-2">
        {isErved ? (
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-100"
            title={`Geërfd via inkoopgroep ${row.inkoopgroep_code}`}
          >
            groep · {row.inkoopgroep_code}
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
            klant
          </span>
        )}
      </td>
      <td className="px-5 py-2 text-right">
        {!isExternRep && (
          <div className="inline-flex items-center gap-1">
            <button
              onClick={onEdit}
              className="p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
              title={isErved ? 'Overschrijven met klant-specifieke regel' : 'Wijzig'}
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={handleDelete}
              disabled={del.isPending}
              className="p-1 rounded hover:bg-rose-50 text-slate-500 hover:text-rose-600 disabled:opacity-50"
              title={isErved ? `Verwijder voor inkoopgroep ${row.inkoopgroep_code} (raakt alle klanten)` : 'Verwijder'}
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

function NaamRowEdit({
  row, onDone,
}: { row: KlanteigenVoorKlantRow; debiteurNr: number; onDone: () => void }) {
  const update = useUpdateKlanteigenNaam()
  const [benaming, setBenaming] = useState(row.benaming)
  const [omschrijving, setOmschrijving] = useState(row.omschrijving ?? '')
  const [leverancier, setLeverancier] = useState(row.leverancier ?? '')
  const [kleurCode, setKleurCode] = useState<string>(row.kleur_code ?? '')
  const { data: kleuren } = useKleurenVoorKwaliteit(row.kwaliteit_code)

  const handleSave = () => {
    if (!benaming.trim() || !row.id) return
    update.mutate(
      {
        id: row.id,
        patch: {
          benaming: benaming.trim(),
          omschrijving: omschrijving.trim() || null,
          leverancier: leverancier.trim() || null,
          kleur_code: kleurCode || null,
        },
      },
      { onSuccess: onDone },
    )
  }

  return (
    <tr className="bg-amber-50/40">
      <td className="px-5 py-2 font-mono text-xs text-slate-500">{row.kwaliteit_code}</td>
      <td className="px-5 py-2">
        <select
          value={kleurCode}
          onChange={(e) => setKleurCode(e.target.value)}
          className="w-full text-xs border border-slate-200 rounded px-1 py-1 bg-white"
        >
          <option value="">alle kleuren</option>
          {(kleuren ?? []).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
          {row.kleur_code && !kleuren?.includes(row.kleur_code) && (
            <option value={row.kleur_code}>{row.kleur_code} (handmatig)</option>
          )}
        </select>
      </td>
      <td className="px-5 py-2">
        <input
          value={benaming}
          onChange={(e) => setBenaming(e.target.value)}
          className="w-full text-sm border border-slate-200 rounded px-2 py-1 bg-white"
          autoFocus
        />
      </td>
      <td className="px-5 py-2">
        <input
          value={omschrijving}
          onChange={(e) => setOmschrijving(e.target.value)}
          placeholder="—"
          className="w-full text-sm border border-slate-200 rounded px-2 py-1 bg-white"
        />
      </td>
      <td className="px-5 py-2">
        <input
          value={leverancier}
          onChange={(e) => setLeverancier(e.target.value)}
          placeholder="—"
          className="w-full text-sm border border-slate-200 rounded px-2 py-1 bg-white"
        />
      </td>
      <td className="px-5 py-2 text-xs text-slate-400">klant</td>
      <td className="px-5 py-2 text-right">
        <div className="inline-flex items-center gap-1">
          <button
            onClick={handleSave}
            disabled={update.isPending || !benaming.trim()}
            className="p-1 rounded hover:bg-emerald-50 text-emerald-600 disabled:opacity-40"
            title="Opslaan"
          >
            <Check size={13} />
          </button>
          <button
            onClick={onDone}
            className="p-1 rounded hover:bg-slate-100 text-slate-500"
            title="Annuleren"
          >
            <X size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function NaamForm({
  debiteurNr,
  prefill,
  onDone,
}: {
  debiteurNr: number
  prefill?: KlanteigenVoorKlantRow | null
  onDone: () => void
}) {
  const create = useUpsertKlanteigenNaam()
  const [kwaliteitCode, setKwaliteitCode] = useState(prefill?.kwaliteit_code ?? '')
  const [kleurCode, setKleurCode] = useState(prefill?.kleur_code ?? '')
  const [benaming, setBenaming] = useState(prefill?.benaming ?? '')
  const [omschrijving, setOmschrijving] = useState(prefill?.omschrijving ?? '')
  const [leverancier, setLeverancier] = useState(prefill?.leverancier ?? '')
  const [error, setError] = useState<string | null>(null)
  const { data: kleuren } = useKleurenVoorKwaliteit(kwaliteitCode || null)
  const isOverschrijving = Boolean(prefill && prefill.bron_niveau === 'inkoopgroep')

  const reset = () => {
    setKwaliteitCode(''); setKleurCode(''); setBenaming(''); setOmschrijving(''); setLeverancier(''); setError(null)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!kwaliteitCode || !benaming.trim()) return
    create.mutate(
      {
        debiteur_nr: debiteurNr,
        kwaliteit_code: kwaliteitCode,
        kleur_code: kleurCode || null,
        benaming: benaming.trim(),
        omschrijving: omschrijving.trim() || null,
        leverancier: leverancier.trim() || null,
      },
      {
        onSuccess: () => { reset(); onDone() },
        onError: (err) => {
          const msg = err instanceof Error ? err.message : 'Opslaan mislukt'
          setError(msg.includes('duplicate') ? 'Deze (kwaliteit + kleur)-combinatie bestaat al.' : msg)
        },
      },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 border-b border-slate-100 bg-slate-50/40 space-y-3">
      {isOverschrijving && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-100 text-xs text-amber-800 rounded-[var(--radius-sm)]">
          Overschrijving van geërfde inkoopgroep-alias <span className="font-mono">{prefill?.inkoopgroep_code}</span>.
          De waarden zijn voor-ingevuld; pas aan en sla op om een klant-specifieke regel te maken die
          de groepsalias overruled.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div className="md:col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Kwaliteit *</label>
          <KwaliteitAutocomplete value={kwaliteitCode} onChange={(c) => { setKwaliteitCode(c); setKleurCode('') }} />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Kleur</label>
          <select
            value={kleurCode}
            onChange={(e) => setKleurCode(e.target.value)}
            disabled={!kwaliteitCode}
            className="w-full text-sm border border-slate-200 rounded-[var(--radius-sm)] px-2 py-1.5 bg-white disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">Alle kleuren</option>
            {(kleuren ?? []).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Eigen naam *</label>
          <input
            value={benaming}
            onChange={(e) => setBenaming(e.target.value)}
            placeholder="Bijv. BREDA"
            className="w-full text-sm border border-slate-200 rounded-[var(--radius-sm)] px-2 py-1.5"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Omschrijving</label>
          <input
            value={omschrijving}
            onChange={(e) => setOmschrijving(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-[var(--radius-sm)] px-2 py-1.5"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="block text-xs text-slate-500 mb-1">Leverancier</label>
          <input
            value={leverancier}
            onChange={(e) => setLeverancier(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-[var(--radius-sm)] px-2 py-1.5"
          />
        </div>
        <div className="md:col-span-3 flex items-center justify-end gap-2">
          {error && <span className="text-xs text-rose-600 mr-2">{error}</span>}
          <button
            type="button"
            onClick={onDone}
            className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] text-slate-600 hover:bg-slate-100"
          >
            Annuleren
          </button>
          <button
            type="submit"
            disabled={!kwaliteitCode || !benaming.trim() || create.isPending}
            className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white hover:bg-terracotta-600 disabled:opacity-40"
          >
            {create.isPending ? 'Opslaan...' : 'Opslaan'}
          </button>
        </div>
      </div>
    </form>
  )
}

function KwaliteitAutocomplete({ value, onChange }: { value: string; onChange: (code: string) => void }) {
  const { data: kwaliteiten } = useKwaliteiten()
  const [search, setSearch] = useState(value)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => { setSearch(value) }, [value])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const matches = useMemo(() => {
    const all = kwaliteiten ?? []
    const q = search.trim().toLowerCase()
    if (!q) return all.slice(0, 30)
    return all
      .filter((k) => k.code.toLowerCase().includes(q) || (k.omschrijving ?? '').toLowerCase().includes(q))
      .slice(0, 30)
  }, [kwaliteiten, search])

  return (
    <div ref={ref} className="relative">
      <input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true); if (e.target.value !== value) onChange('') }}
        onFocus={() => setOpen(true)}
        placeholder="Zoek kwaliteit (code of naam)..."
        className="w-full text-sm border border-slate-200 rounded-[var(--radius-sm)] px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-terracotta-300 focus:border-terracotta-300"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-[var(--radius-sm)] shadow-lg">
          {matches.map((k) => (
            <button
              key={k.code}
              type="button"
              onClick={() => { onChange(k.code); setSearch(k.code); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-50 flex items-center gap-2"
            >
              <span className="font-mono text-xs text-slate-700">{k.code}</span>
              {k.omschrijving && <span className="text-slate-500 text-xs truncate">{k.omschrijving}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
