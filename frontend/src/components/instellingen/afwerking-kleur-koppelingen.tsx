import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, X } from 'lucide-react'
import {
  fetchKoppelingenVoorKleurLabel,
  fetchMaatwerkKleurOptiesVoorKwaliteit,
  fetchMaatwerkKwaliteitOpties,
  setBandKleurDefault,
  type BandLabelKoppeling,
} from '@/lib/supabase/queries/op-maat'

interface Props {
  afwerkingKleurId: number
  afwerkingCode: string
}

export function AfwerkingKleurKoppelingen({ afwerkingKleurId, afwerkingCode }: Props) {
  const qc = useQueryClient()
  const { data: koppelingen, isLoading } = useQuery({
    queryKey: ['band-koppelingen', afwerkingKleurId],
    queryFn: () => fetchKoppelingenVoorKleurLabel(afwerkingKleurId),
  })

  const ontkoppelMut = useMutation({
    mutationFn: (k: BandLabelKoppeling) => setBandKleurDefault(k.kwaliteit_code, k.kleur_code, null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['band-koppelingen', afwerkingKleurId] })
      qc.invalidateQueries({ queryKey: ['band-defaults'] })
    },
  })

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">
        Gekoppelde producten ({koppelingen?.length ?? 0})
      </div>

      {isLoading ? (
        <div className="text-xs text-slate-400">Laden…</div>
      ) : (koppelingen?.length ?? 0) === 0 ? (
        <div className="text-xs text-slate-400 italic">
          Nog geen producten gekoppeld aan dit label.
        </div>
      ) : (
        <div className="bg-white rounded border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left px-3 py-1.5 font-medium text-slate-500 text-xs w-32">Kwaliteit</th>
                <th className="text-left px-3 py-1.5 font-medium text-slate-500 text-xs">Omschrijving</th>
                <th className="text-left px-3 py-1.5 font-medium text-slate-500 text-xs w-20">Kleur</th>
                <th className="px-3 py-1.5 w-12"></th>
              </tr>
            </thead>
            <tbody>
              {(koppelingen ?? []).map((k) => (
                <tr key={`${k.kwaliteit_code}-${k.kleur_code}`} className="border-b border-slate-50">
                  <td className="px-3 py-1.5">
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {k.kwaliteit_code}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-slate-600 text-xs">{k.kwaliteit_omschrijving ?? '—'}</td>
                  <td className="px-3 py-1.5">
                    <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {k.kleur_code}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={() => ontkoppelMut.mutate(k)}
                      disabled={ontkoppelMut.isPending}
                      className="p-1 rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                      title="Ontkoppelen"
                    >
                      <X size={11} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <KoppelPicker afwerkingKleurId={afwerkingKleurId} afwerkingCode={afwerkingCode} />
    </div>
  )
}

function KoppelPicker({ afwerkingKleurId, afwerkingCode }: { afwerkingKleurId: number; afwerkingCode: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [kwaliteitSearch, setKwaliteitSearch] = useState('')
  const [kwaliteitCode, setKwaliteitCode] = useState<string | null>(null)
  const [kleurCode, setKleurCode] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: alleKwaliteiten } = useQuery({
    queryKey: ['maatwerk-kwaliteit-opties'],
    queryFn: fetchMaatwerkKwaliteitOpties,
    staleTime: 5 * 60 * 1000,
    enabled: open,
  })
  const { data: kleurOpties } = useQuery({
    queryKey: ['maatwerk-kleur-opties', kwaliteitCode ?? ''],
    queryFn: () => fetchMaatwerkKleurOptiesVoorKwaliteit(kwaliteitCode!),
    enabled: !!kwaliteitCode,
  })

  const filteredKwaliteiten = useMemo(() => {
    const term = kwaliteitSearch.trim().toLowerCase()
    const list = alleKwaliteiten ?? []
    if (!term) return list.slice(0, 50)
    return list
      .filter((q) => `${q.code} ${q.omschrijving ?? ''}`.toLowerCase().includes(term))
      .slice(0, 50)
  }, [alleKwaliteiten, kwaliteitSearch])

  const koppelMut = useMutation({
    mutationFn: () => setBandKleurDefault(kwaliteitCode!, kleurCode!, afwerkingKleurId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['band-koppelingen', afwerkingKleurId] })
      qc.invalidateQueries({ queryKey: ['band-defaults'] })
      reset()
    },
    onError: (err) => {
      setErrorMsg(err instanceof Error ? err.message : 'Koppelen mislukt')
    },
  })

  function reset() {
    setOpen(false)
    setKwaliteitCode(null)
    setKleurCode(null)
    setKwaliteitSearch('')
    setErrorMsg(null)
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-200 bg-white text-slate-700 hover:border-terracotta-300 hover:text-terracotta-600"
      >
        <Plus size={11} />
        Product koppelen aan dit label
      </button>
    )
  }

  return (
    <div className="bg-amber-50/40 border border-amber-100 rounded p-3 space-y-2">
      <div className="text-xs font-medium text-slate-700">
        Koppel een (kwaliteit, kleur) aan label onder {afwerkingCode}:
      </div>

      {/* Stap 1: kwaliteit */}
      {!kwaliteitCode && (
        <div>
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={kwaliteitSearch}
              onChange={(e) => setKwaliteitSearch(e.target.value)}
              placeholder="Zoek maatwerk-kwaliteit…"
              className="w-full pl-7 pr-2 py-1 border border-slate-300 rounded text-sm"
            />
          </div>
          <div className="mt-1 max-h-48 overflow-y-auto bg-white rounded border border-slate-200">
            {filteredKwaliteiten.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-slate-400">Geen resultaten</div>
            ) : (
              filteredKwaliteiten.map((q) => (
                <button
                  key={q.code}
                  onClick={() => setKwaliteitCode(q.code)}
                  className="block w-full text-left px-2 py-1 text-xs hover:bg-slate-50 border-b border-slate-50 last:border-0"
                >
                  <span className="font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 mr-2">{q.code}</span>
                  {q.omschrijving ?? ''}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Stap 2: kleur */}
      {kwaliteitCode && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Kwaliteit:</span>
            <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{kwaliteitCode}</span>
            <button
              onClick={() => { setKwaliteitCode(null); setKleurCode(null) }}
              className="text-xs text-slate-400 hover:text-slate-600 underline"
            >
              wijzigen
            </button>
          </div>
          <select
            value={kleurCode ?? ''}
            onChange={(e) => setKleurCode(e.target.value || null)}
            className="w-full px-2 py-1 border border-slate-300 rounded text-sm bg-white"
          >
            <option value="">— kies kleur —</option>
            {(kleurOpties ?? []).map((opt) => (
              <option key={opt.kleur_code} value={opt.kleur_code}>{opt.kleur_code}</option>
            ))}
          </select>
        </div>
      )}

      {errorMsg && <div className="text-xs text-rose-600">{errorMsg}</div>}

      <div className="flex items-center gap-2">
        <button
          onClick={() => koppelMut.mutate()}
          disabled={!kwaliteitCode || !kleurCode || koppelMut.isPending}
          className="px-3 py-1 text-xs rounded bg-terracotta-500 text-white hover:bg-terracotta-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {koppelMut.isPending ? 'Koppelen…' : 'Koppelen'}
        </button>
        <button
          onClick={reset}
          className="px-3 py-1 text-xs rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          Annuleren
        </button>
      </div>
    </div>
  )
}
