import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, Loader2, X, AlertTriangle } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase/client'
import { isAdminPseudo } from '@/lib/orders/admin-pseudo'
import { isoWeekStringVanIso } from '@/lib/utils/iso-week'
import type { OrderRegel } from '@/lib/supabase/queries/orders'
import { useAuth } from '@/hooks/use-auth'

interface DeelzendingResult {
  zending_id: number
  zending_nr: string
  vervoerder_code: string | null
}

/** Mig 473: vooraf checken of deze order normaal (zonder override) een
 *  deelzending mag krijgen — voorkomt dat de operator pas na het selecteren
 *  van regels op een foutmelding-string stuit. */
async function fetchKanDeelzending(orderId: number): Promise<boolean> {
  const { data, error } = await supabase.rpc('kan_deelzending', { p_order_id: orderId })
  if (error) throw new Error(error.message)
  return data === true
}

async function startDeelzending(
  orderId: number,
  regelIds: number[],
  pickerId: number | null,
  overrideReden: string | null,
): Promise<DeelzendingResult> {
  const { data, error } = await supabase.rpc('start_deelzending', {
    p_order_id: orderId,
    p_regel_ids: regelIds,
    p_picker_id: pickerId,
    p_override_reden: overrideReden,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('RPC gaf geen resultaat terug')
  return row as DeelzendingResult
}

interface DeelzendingDialogProps {
  orderId: number
  orderStatus: string
  regels: OrderRegel[]
  orderVerzendweek: string | null | undefined
  onClose: () => void
}

export function DeelzendingDialog({
  orderId,
  orderStatus,
  regels,
  orderVerzendweek,
  onClose,
}: DeelzendingDialogProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [geselecteerd, setGeselecteerd] = useState<Set<number>>(new Set())
  const [fout, setFout] = useState<string | null>(null)
  const [overrideBevestigd, setOverrideBevestigd] = useState(false)
  // Externe vertegenwoordiger (mig 489): read-only — geen deelzending starten.
  const { isExternRep } = useAuth()

  const { data: kanDeelzending, isLoading: kanDeelzendingLoading } = useQuery({
    queryKey: ['orders', orderId, 'kan-deelzending'],
    queryFn: () => fetchKanDeelzending(orderId),
  })
  // Pas weten of een override nodig is zodra de check binnen is — vóór die
  // tijd niet alvast de happy-path blokkeren.
  const overrideNodig = kanDeelzending === false

  const mutation = useMutation({
    mutationFn: () => startDeelzending(
      orderId,
      Array.from(geselecteerd),
      null,
      overrideNodig ? 'Door operator bevestigd in deelzending-dialoog' : null,
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders', orderId] })
      queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'regels'] })
      queryClient.invalidateQueries({ queryKey: ['orders', orderId, 'zendingen'] })
      // Mig 477: de deelzending is alleen GERESERVEERD ('Gepland'), nog niet
      // gestart — de order-status verandert niet. Labels printen + écht
      // starten gebeurt straks vanuit Pick & Ship > Picken starten.
      navigate('/pick-ship')
    },
    onError: (err) => {
      setFout(err instanceof Error ? err.message : 'Onbekende fout')
    },
  })

  // Regels die in aanmerking komen: niet pseudo, niet maatwerk (maatwerk = snijplanning), te_leveren > 0
  const kandidaatRegels = regels.filter(
    (r) => !isAdminPseudo(r) && !r.is_maatwerk && r.te_leveren > 0,
  )

  function toggleRegel(id: number) {
    setGeselecteerd((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setGeselecteerd(new Set(kandidaatRegels.map((r) => r.id)))
  }

  function deselectAll() {
    setGeselecteerd(new Set())
  }

  const aantalGeselecteerd = geselecteerd.size
  const kanStarten = aantalGeselecteerd > 0
    && !mutation.isPending
    && !kanDeelzendingLoading
    && (!overrideNodig || overrideBevestigd)
  const isEindstatus = orderStatus === 'Verzonden' || orderStatus === 'Geannuleerd'

  if (isEindstatus || isExternRep) return null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-[var(--radius)] border border-slate-200 shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-terracotta-500" />
            <h2 className="font-semibold text-slate-900">Deelzending starten</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <p className="text-sm text-slate-600">
            Selecteer de orderregels die je nu al wilt verzenden. De overige regels
            blijven in de order staan voor een latere zending.
          </p>

          {/* Regel-selectie */}
          <div className="border border-slate-200 rounded-[var(--radius-sm)] overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between sticky top-0">
              <span className="text-xs font-medium text-slate-600">
                {kandidaatRegels.length} {kandidaatRegels.length === 1 ? 'regel' : 'regels'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className="text-xs text-terracotta-500 hover:underline"
                >
                  Alles
                </button>
                <button
                  type="button"
                  onClick={deselectAll}
                  className="text-xs text-slate-400 hover:underline"
                >
                  Niets
                </button>
              </div>
            </div>
            <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
              {kandidaatRegels.length === 0 ? (
                <p className="px-3 py-4 text-sm text-slate-400 text-center">
                  Geen selecteerbare regels
                </p>
              ) : (
                kandidaatRegels.map((regel) => {
                  const vroegstWeek = regel.vroegst_leverbaar
                    ? isoWeekStringVanIso(regel.vroegst_leverbaar)
                    : null
                  const kanEerder = vroegstWeek && orderVerzendweek
                    ? vroegstWeek < orderVerzendweek
                    : false
                  return (
                    <label
                      key={regel.id}
                      className="flex items-start gap-3 px-3 py-2.5 hover:bg-slate-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={geselecteerd.has(regel.id)}
                        onChange={() => toggleRegel(regel.id)}
                        disabled={mutation.isPending}
                        className="mt-0.5 accent-terracotta-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-slate-900 truncate">
                            {regel.omschrijving}
                          </span>
                          {kanEerder && vroegstWeek && (
                            <span className="inline-flex items-center text-[11px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                              Kan al Wk {parseInt(vroegstWeek.split('-W')[1] ?? '0')}
                            </span>
                          )}
                          {vroegstWeek && !kanEerder && (
                            <span className="inline-flex items-center text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                              Wk {parseInt(vroegstWeek.split('-W')[1] ?? '0')}
                            </span>
                          )}
                          {!regel.vroegst_leverbaar && (
                            <span className="inline-flex items-center text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                              Geen dekking
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {regel.artikelnr} · {regel.te_leveren} st
                        </div>
                      </div>
                    </label>
                  )
                })
              )}
            </div>
          </div>

          {/* Mig 473: deelleveringen niet toegestaan voor deze klant — override met bevestiging */}
          {overrideNodig && (
            <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] px-3 py-2.5 space-y-2">
              <p className="text-sm text-amber-800 flex items-center gap-1.5 font-medium">
                <AlertTriangle size={14} />
                Deelleveringen zijn niet toegestaan voor deze klant
              </p>
              <label className="flex items-start gap-2 text-xs text-amber-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideBevestigd}
                  onChange={(e) => setOverrideBevestigd(e.target.checked)}
                  disabled={mutation.isPending}
                  className="mt-0.5 accent-amber-600"
                />
                <span>Ik wil dit bewust overrulen en toch een deelzending starten voor deze klant.</span>
              </label>
            </div>
          )}

          {/* Foutmelding */}
          {fout && (
            <div className="bg-rose-50 border border-rose-200 rounded-[var(--radius-sm)] px-3 py-2 text-sm text-rose-700">
              {fout}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <span className="text-xs text-slate-400">
            {aantalGeselecteerd === 0
              ? 'Selecteer minimaal 1 regel'
              : overrideNodig && !overrideBevestigd
                ? 'Bevestig de waarschuwing om door te gaan'
                : `${aantalGeselecteerd} regel${aantalGeselecteerd > 1 ? 's' : ''} geselecteerd`}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={mutation.isPending}
              className="px-3 py-1.5 text-sm rounded-[var(--radius-sm)] border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              Annuleren
            </button>
            <button
              type="button"
              onClick={() => { setFout(null); mutation.mutate() }}
              disabled={!kanStarten}
              className="px-4 py-1.5 text-sm rounded-[var(--radius-sm)] bg-terracotta-500 text-white font-medium hover:bg-terracotta-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {mutation.isPending && <Loader2 size={14} className="animate-spin" />}
              Deelzending starten
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
