import { useMemo, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { Factory, Scissors } from 'lucide-react'
import { PageHeader } from '@/components/layout/page-header'
import { useConfectielijst } from '@/hooks/use-snijplanning'
import { formatDate } from '@/lib/utils/formatters'
import { cn } from '@/lib/utils/cn'
import { AFWERKING_MAP, AFWERKING_OPTIES, SNIJPLAN_STATUS_COLORS } from '@/lib/utils/constants'
import { getVormDisplay } from '@/lib/utils/vorm-labels'
import type { SnijplanRow } from '@/lib/types/productie'

/** Label voor afwerking-code of fallback tekst */
function afwerkingLabel(code: string | null): string {
  if (!code) return 'Zonder afwerking'
  return AFWERKING_MAP[code]?.label ?? code
}

/** Sorteervolgorde: volg AFWERKING_OPTIES volgorde, null/onbekend achteraan */
function afwerkingVolgorde(code: string | null): number {
  if (!code) return 999
  const idx = AFWERKING_OPTIES.findIndex((a) => a.code === code)
  return idx === -1 ? 998 : idx
}

export function ConfectieOverviewPage() {
  const { data: stukken, isLoading } = useConfectielijst()

  // Groepeer per afwerking, gesorteerd op volgorde
  const groepenPerAfwerking = useMemo(() => {
    if (!stukken) return []
    const map = new Map<string | null, SnijplanRow[]>()
    for (const s of stukken) {
      const key = s.maatwerk_afwerking ?? null
      const lijst = map.get(key) ?? []
      lijst.push(s)
      map.set(key, lijst)
    }
    return Array.from(map.entries()).sort(
      ([a], [b]) => afwerkingVolgorde(a) - afwerkingVolgorde(b)
    )
  }, [stukken])

  const totaal = stukken?.length ?? 0

  return (
    <>
      <PageHeader
        title="Confectielijst"
        description={`${totaal} stuk${totaal !== 1 ? 'ken' : ''} te confectioneren — gesorteerd per afwerking en leverdatum`}
      />

      {isLoading ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          Laden...
        </div>
      ) : totaal === 0 ? (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-12 text-center text-slate-400">
          <Scissors size={32} className="mx-auto mb-3 opacity-30" />
          <p>Geen stukken klaar voor afwerking</p>
          <p className="text-sm mt-1">Orders verschijnen hier zodra ze Gesneden zijn</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groepenPerAfwerking.map(([afwerking, rows]) => {
            const afwMap = afwerking ? AFWERKING_MAP[afwerking] : null
            return (
              <Fragment key={afwerking ?? '__geen__'}>
                {/* Afwerking sectie-header */}
                <div className="flex items-center gap-3 pt-2">
                  <div className="flex items-center gap-2">
                    <Factory size={14} className="text-slate-400" />
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest whitespace-nowrap">
                      {afwerkingLabel(afwerking)}
                    </span>
                    {afwMap && (
                      <span className={cn('text-xs px-2 py-0.5 rounded-full', afwMap.bg, afwMap.text)}>
                        {afwerking}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 h-px bg-slate-200" />
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {rows.length} stuk{rows.length !== 1 ? 'ken' : ''}
                  </span>
                </div>

                {/* Tabel */}
                <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                        <th className="py-2 px-4">Maat</th>
                        <th className="py-2 px-4">Kwaliteit / Kleur</th>
                        <th className="py-2 px-4">Rol</th>
                        <th className="py-2 px-4">Vorm</th>
                        <th className="py-2 px-4">Klant</th>
                        <th className="py-2 px-4">Order</th>
                        <th className="py-2 px-4">Leverdatum</th>
                        <th className="py-2 px-4">Gesneden op</th>
                        <th className="py-2 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((s) => (
                        <ConfectieRij key={s.id} stuk={s} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Fragment>
            )
          })}
        </div>
      )}
    </>
  )
}

function ConfectieRij({ stuk }: { stuk: SnijplanRow }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="py-2.5 px-4 font-medium tabular-nums">
        {stuk.snij_breedte_cm}×{stuk.snij_lengte_cm} cm
      </td>
      <td className="py-2.5 px-4 text-slate-700">
        {stuk.kwaliteit_code} {stuk.kleur_code}
      </td>
      <td className="py-2.5 px-4">
        {stuk.rolnummer && stuk.rol_id ? (
          <Link
            to={`/snijplanning/productie/${stuk.rol_id}`}
            className="text-terracotta-600 hover:underline text-xs"
          >
            {stuk.rolnummer}
          </Link>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="py-2.5 px-4">
        {stuk.maatwerk_vorm ? (
          (() => {
            const vd = getVormDisplay(stuk.maatwerk_vorm)
            return (
              <span className={cn('text-xs px-1.5 py-0.5 rounded', vd.bg, vd.text)}>
                {vd.label}
              </span>
            )
          })()
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="py-2.5 px-4 text-slate-700">{stuk.klant_naam}</td>
      <td className="py-2.5 px-4">
        <Link to={`/orders/${stuk.order_id}`} className="text-terracotta-600 hover:underline">
          {stuk.order_nr}
        </Link>
      </td>
      <td className="py-2.5 px-4">
        {stuk.afleverdatum ? (
          <span className="text-slate-700">{formatDate(stuk.afleverdatum)}</span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="py-2.5 px-4">
        {stuk.gesneden_datum ? (
          <span className="text-slate-500 text-xs">{formatDate(stuk.gesneden_datum)}</span>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className="py-2.5 px-4">
        <span className={cn(
          'text-xs px-2 py-0.5 rounded-full font-medium',
          (SNIJPLAN_STATUS_COLORS[stuk.status] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }).bg,
          (SNIJPLAN_STATUS_COLORS[stuk.status] ?? { bg: 'bg-gray-100', text: 'text-gray-600' }).text,
        )}>
          {stuk.status}
        </span>
      </td>
    </tr>
  )
}
