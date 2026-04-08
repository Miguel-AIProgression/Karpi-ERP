import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Printer, Scissors, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useSnijplannenVoorGroep, useGenereerSnijvoorstel } from '@/hooks/use-snijplanning'
import type { SnijplanRow } from '@/lib/types/productie'

interface GroepAccordionProps {
  kwaliteitCode: string
  kleurCode: string
  totaalStukken: number
  totaalOrders: number
  totaalM2: number
  totaalGesneden: number
}

export function GroepAccordion({
  kwaliteitCode,
  kleurCode,
  totaalStukken,
  totaalOrders,
  totaalM2,
  totaalGesneden,
}: GroepAccordionProps) {
  const [open, setOpen] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const navigate = useNavigate()
  const genereer = useGenereerSnijvoorstel()

  // Lazy load: only fetch detail rows when accordion is opened
  const { data: stukken, isLoading } = useSnijplannenVoorGroep(
    kwaliteitCode,
    kleurCode,
    open, // enabled only when open
  )

  return (
    <div className="bg-white rounded-[var(--radius)] border border-slate-200 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
      >
        <div className="flex items-center gap-3 flex-wrap">
          {open ? (
            <ChevronDown size={16} className="text-slate-400 flex-shrink-0" />
          ) : (
            <ChevronRight size={16} className="text-slate-400 flex-shrink-0" />
          )}
          <span className="font-medium text-slate-900">
            {kwaliteitCode} {kleurCode}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge>{totaalOrders} {totaalOrders === 1 ? 'order' : 'orders'}</Badge>
            <Badge>{totaalStukken} stuks</Badge>
            <Badge>{totaalM2} m²</Badge>
            <span className={cn(
              'text-xs px-2 py-0.5 rounded-full',
              totaalGesneden === totaalStukken
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-amber-100 text-amber-700'
            )}>
              {totaalGesneden}/{totaalStukken} gesneden
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setGenError(null)
              genereer.mutate(
                { kwaliteitCode, kleurCode },
                {
                  onSuccess: (result) => {
                    navigate(`/snijplanning/voorstel/${result.voorstel_id}`, {
                      state: { voorstelResponse: result, kwaliteitCode, kleurCode },
                    })
                  },
                  onError: (err) => {
                    setGenError(err instanceof Error ? err.message : 'Onbekende fout')
                  },
                },
              )
            }}
            disabled={genereer.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-terracotta-500 text-white rounded-[var(--radius-sm)] text-xs font-medium hover:bg-terracotta-600 transition-colors disabled:opacity-50"
          >
            {genereer.isPending ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
            Genereren
          </button>
          <Printer size={16} className="text-slate-400 hover:text-slate-600" />
        </div>
      </button>

      {/* Generation error */}
      {genError && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-[var(--radius-sm)] text-sm text-red-700">
          Fout bij genereren: {genError}
          <button onClick={() => setGenError(null)} className="ml-2 underline text-xs">Sluiten</button>
        </div>
      )}

      {/* Detail: loaded on expand */}
      {open && (
        <div className="border-t border-slate-100 p-4">
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-4">Laden...</p>
          ) : !stukken || stukken.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">Geen items gevonden</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                  <th className="py-2 pr-3">Maat</th>
                  <th className="py-2 pr-3">Vorm</th>
                  <th className="py-2 pr-3">Klant</th>
                  <th className="py-2 pr-3">Order</th>
                  <th className="py-2 pr-3">Afwerking</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {stukken.map((stuk) => (
                  <StukRow key={stuk.id} stuk={stuk} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
      {children}
    </span>
  )
}

function StukRow({ stuk }: { stuk: SnijplanRow }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="py-2 pr-3 font-medium">
        {stuk.snij_breedte_cm}×{stuk.snij_lengte_cm} cm
      </td>
      <td className="py-2 pr-3">
        {stuk.maatwerk_vorm && (
          <span className={cn(
            'text-xs px-1.5 py-0.5 rounded',
            stuk.maatwerk_vorm === 'rond' ? 'bg-purple-100 text-purple-700'
              : stuk.maatwerk_vorm === 'ovaal' ? 'bg-pink-100 text-pink-700'
              : 'bg-slate-100 text-slate-600'
          )}>
            {stuk.maatwerk_vorm}
          </span>
        )}
      </td>
      <td className="py-2 pr-3">{stuk.klant_naam}</td>
      <td className="py-2 pr-3">
        <Link to={`/orders/${stuk.order_id}`} className="text-terracotta-600 hover:underline">
          {stuk.order_nr}
        </Link>
      </td>
      <td className="py-2 pr-3">
        {stuk.maatwerk_afwerking && stuk.maatwerk_afwerking !== 'geen' ? (
          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">{stuk.maatwerk_afwerking}</span>
        ) : '—'}
      </td>
      <td className="py-2 pr-3">
        <span className={cn(
          'text-xs px-1.5 py-0.5 rounded',
          stuk.status === 'Wacht' ? 'bg-slate-100 text-slate-600'
            : stuk.status === 'Gepland' ? 'bg-blue-100 text-blue-700'
            : stuk.status === 'Gesneden' ? 'bg-emerald-100 text-emerald-700'
            : 'bg-slate-100 text-slate-600'
        )}>
          {stuk.status}
        </span>
      </td>
    </tr>
  )
}
