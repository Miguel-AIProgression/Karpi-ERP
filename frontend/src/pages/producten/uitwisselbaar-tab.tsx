import { useMemo, useState } from 'react'
import { Link2, Download, Plus, Pencil, Search } from 'lucide-react'
import * as XLSX from 'xlsx'
import { useUitwisselbareGroepen } from '@/hooks/use-uitwisselbaar'
import type { UitwisselbareGroep } from '@/lib/supabase/queries/uitwisselbaar'
import { UitwisselbaarGroepDialog } from '@/components/producten/uitwisselbaar-groep-dialog'
import { cn } from '@/lib/utils/cn'

function exporteerUitwisselbareGroepen(groepen: UitwisselbareGroep[]) {
  const rows = groepen.flatMap((groep) => {
    const gedeeldSet = new Set(groep.gedeelde_kleuren)
    return groep.kwaliteiten.flatMap((kwal) =>
      (kwal.kleuren.length > 0 ? kwal.kleuren : [null]).map((kleur) => ({
        'Groep': groep.collectie_naam,
        'Kwaliteit code': kwal.code,
        'Kwaliteit omschrijving': kwal.omschrijving ?? '',
        'Kleur': kleur ?? '',
        'Uitwisselbaar met andere kwaliteit in groep': kleur && gedeeldSet.has(kleur) ? 'Ja' : 'Nee',
      })),
    )
  })

  const ws = XLSX.utils.json_to_sheet(rows)

  const colWidths = Object.keys(rows[0] ?? {}).map((key) => ({
    wch: Math.max(
      key.length,
      ...rows.map((r) => String(r[key as keyof typeof r] ?? '').length),
    ) + 2,
  }))
  ws['!cols'] = colWidths

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Uitwisselbaar')

  const datum = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `uitwisselbare-producten_${datum}.xlsx`)
}

function KleurBadge({ kleur, gedeeld }: { kleur: string; gedeeld: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono',
        gedeeld
          ? 'bg-blue-100 text-blue-700'
          : 'bg-slate-100 text-slate-500',
      )}
    >
      {gedeeld && <Link2 size={10} />}
      {kleur}
    </span>
  )
}

function groepMatcht(groep: UitwisselbareGroep, zoekterm: string): boolean {
  const s = zoekterm.toLowerCase()
  if (groep.collectie_naam.toLowerCase().includes(s)) return true
  return groep.kwaliteiten.some(
    (k) => k.code.toLowerCase().includes(s) || (k.omschrijving?.toLowerCase().includes(s) ?? false),
  )
}

export function UitwisselbaarTab() {
  const { data: groepen, isLoading, isError } = useUitwisselbareGroepen()
  const [zoekterm, setZoekterm] = useState('')
  const [dialoog, setDialoog] = useState<'nieuw' | UitwisselbareGroep | null>(null)

  const gefilterd = useMemo(() => {
    if (!groepen) return []
    const s = zoekterm.trim()
    if (!s) return groepen
    return groepen.filter((g) => groepMatcht(g, s))
  }, [groepen, zoekterm])

  if (isLoading) {
    return <div className="text-slate-400 py-8">Uitwisselbare groepen laden...</div>
  }

  if (isError) {
    return <div className="text-rose-500 py-8">Fout bij laden van uitwisselbare groepen</div>
  }

  if (!groepen || groepen.length === 0) {
    return <div className="text-slate-400 py-8">Geen uitwisselbare groepen gevonden</div>
  }

  const totaalKwaliteiten = groepen.reduce((sum, g) => sum + g.kwaliteiten.length, 0)

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1">
        <p className="text-sm text-slate-500">
          {groepen.length} groepen &middot; {totaalKwaliteiten} gekoppelde kwaliteiten
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exporteerUitwisselbareGroepen(groepen)}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Download size={15} />
            Exporteer naar Excel
          </button>
          <button
            onClick={() => setDialoog('nieuw')}
            className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-sm)] bg-terracotta-500 text-white text-sm font-medium hover:bg-terracotta-600 transition-colors"
          >
            <Plus size={15} />
            Koppeling toevoegen
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400 mb-4">
        Kleuren met hetzelfde nummer worden automatisch uitwisselbaar
      </p>

      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={zoekterm}
          onChange={(e) => setZoekterm(e.target.value)}
          placeholder="Zoek op groep, kwaliteitscode of omschrijving..."
          className="w-full pl-10 pr-4 py-2 rounded-[var(--radius-sm)] border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-terracotta-400/30 focus:border-terracotta-400"
        />
      </div>

      {gefilterd.length === 0 ? (
        <div className="text-slate-400 py-8 text-sm">Geen groepen gevonden voor &quot;{zoekterm}&quot;</div>
      ) : (
      <div className="space-y-4">
        {gefilterd.map((groep) => {
          const gedeeldSet = new Set(groep.gedeelde_kleuren)
          return (
            <div
              key={groep.collectie_id}
              className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden"
            >
              {/* Group header */}
              <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-100">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Link2 size={14} className="text-blue-500" />
                  <span className="font-medium text-slate-700">{groep.collectie_naam}</span>
                  <span>
                    ({groep.kwaliteiten.length} kwaliteiten &middot;{' '}
                    {groep.gedeelde_kleuren.length} gekoppelde kleuren &middot;{' '}
                    {groep.niet_overeenkomende_kleuren.length} niet-overeenkomend)
                  </span>
                </div>
                <button
                  onClick={() => setDialoog(groep)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                >
                  <Pencil size={12} />
                  Bewerken
                </button>
              </div>

              {/* Kwaliteiten in this group */}
              <div className="divide-y divide-slate-50">
                {groep.kwaliteiten.map((kwal) => (
                  <div key={kwal.code} className="px-5 py-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium text-slate-900">
                        {kwal.omschrijving ?? kwal.code}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-200 text-[10px] font-mono text-slate-600 uppercase">
                        {kwal.code}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {kwal.kleuren.length > 0 ? (
                        kwal.kleuren.map((kleur) => (
                          <KleurBadge
                            key={kleur}
                            kleur={kleur}
                            gedeeld={gedeeldSet.has(kleur)}
                          />
                        ))
                      ) : (
                        <span className="text-xs text-slate-300">Geen kleuren</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      )}

      {dialoog && (
        <UitwisselbaarGroepDialog
          groep={dialoog === 'nieuw' ? undefined : dialoog}
          onClose={() => setDialoog(null)}
        />
      )}
    </div>
  )
}
