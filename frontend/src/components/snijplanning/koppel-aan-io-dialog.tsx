// Fase (c) — handmatige IO-koppeling vanuit de werklijst.
//
// Toont open IO-regels voor de (kwaliteit, kleur) van de geselecteerde
// tekort- of wacht-op-inkoop-orderregel, laat de planner een IO kiezen,
// en voert koppel_orderregel_aan_io (mig 526) uit.
//
// MARGE-2.5CM: de "benodigde ruimte" per stuk is placed_breedte_cm uit de
// werklijst-view (breedte_cm + stuk_snij_marge_cm, mig 464). Wijzig mig 464
// als de werkvloer-marge verandert; de conservatieve schatting hier volgt
// automatisch mee via de RPC.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Loader2, Truck, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { formatDate, formatNumber } from '@/lib/utils/formatters'
import { isAchterstalligeEta } from '@/modules/inkoop/lib/inkoop-eta'
import type { WerklijstOrderregel } from '@/modules/snijplanning/lib/werklijst-groepering'
import {
  fetchOpenInkoopRegelsVoorKoppeling,
  koppelOrderregelAanIo,
  ontkoppelOrderregelVanIo,
} from '@/modules/snijplanning/queries/io-koppeling'

interface Props {
  groepKwaliteitCode: string
  groepKleurCode: string
  regel: WerklijstOrderregel
  onClose: () => void
}

export function KoppelAanIoDialog({ groepKwaliteitCode, groepKleurCode, regel, onClose }: Props) {
  const queryClient = useQueryClient()
  const [geselecteerdIoId, setGeselecteerdIoId] = useState<number | null>(null)
  const [succesBericht, setSuccesBericht] = useState<string | null>(null)

  // Haal open IO-regels op voor deze kwaliteit/kleur
  const { data: ioRegels = [], isLoading, error: laadFout } = useQuery({
    queryKey: ['open-io-regels-koppeling', groepKwaliteitCode, groepKleurCode],
    queryFn: () => fetchOpenInkoopRegelsVoorKoppeling(groepKwaliteitCode, groepKleurCode),
    staleTime: 30_000,
  })

  // Koppel-mutatie: alle stuks van de orderregel → gekozen IO
  const koppelMutatie = useMutation({
    mutationFn: (ioRegelId: number) =>
      koppelOrderregelAanIo(regel.orderRegelId, ioRegelId),
    onSuccess: (resultaat) => {
      queryClient.invalidateQueries({ queryKey: ['werklijst-stukken'] })
      if (resultaat.gewijzigd) {
        const resterend = resultaat.resterend_cm != null
          ? ` (${formatNumber(resultaat.resterend_cm / 100, 1)} m resterend)`
          : ''
        setSuccesBericht(`${regel.aantalStuks} stuk${regel.aantalStuks !== 1 ? 'ken' : ''} gekoppeld${resterend}`)
      } else {
        setSuccesBericht('Al gekoppeld aan deze IO')
      }
    },
  })

  // Ontkoppel-mutatie: release alle stuks van huidige IO
  const ontkoppelMutatie = useMutation({
    mutationFn: () => ontkoppelOrderregelVanIo(regel.snijplanIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['werklijst-stukken'] })
      setSuccesBericht('IO-koppeling verwijderd — stukken staan weer als tekort')
    },
  })

  const isBusy = koppelMutatie.isPending || ontkoppelMutatie.isPending
  const fout = koppelMutatie.error?.message ?? ontkoppelMutatie.error?.message ?? null

  // MARGE-2.5CM: totaalBijdrageCm = som van placed_breedte_cm per stuk
  // (conservatief t.o.v. naast-elkaar-packing; zie mig 526-header voor uitleg)
  const totaalBijdrageCm = regel.totaalBijdrageCm

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Link2 size={16} className="text-blue-600" />
            <h2 className="font-semibold text-slate-900 text-sm">
              Koppel aan inkooporder — {groepKwaliteitCode} {groepKleurCode.replace(/\.0$/, '')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X size={16} />
          </button>
        </div>

        {/* Stuk-samenvatting */}
        <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-xs text-slate-600 flex items-center gap-4 flex-wrap">
          <span>
            <span className="font-medium text-slate-800">
              {regel.maatwerk_lengte_cm}×{regel.maatwerk_breedte_cm} cm
            </span>
            {regel.aantalStuks > 1 && (
              <span className="text-slate-400 ml-1">×{regel.aantalStuks}</span>
            )}
          </span>
          <span>{regel.orderNr} — {regel.klantNaam}</span>
          {/* MARGE-2.5CM: conservatieve schatting; zie mig 526-header */}
          <span className="ml-auto text-slate-500">
            Benodigd: ~{formatNumber(totaalBijdrageCm / 100, 1)} m
            <span className="text-[10px] ml-1 text-slate-400">(conservatief)</span>
          </span>
        </div>

        {/* Body */}
        <div className="px-4 py-3 max-h-80 overflow-y-auto">
          {succesBericht ? (
            <div className="flex items-center gap-2 text-emerald-700 text-sm py-4">
              <CheckCircle2 size={18} className="shrink-0" />
              {succesBericht}
            </div>
          ) : isLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
              <Loader2 size={16} className="animate-spin" /> Laden…
            </div>
          ) : laadFout ? (
            <p className="text-red-600 text-sm py-4">
              Fout bij laden: {(laadFout as Error).message}
            </p>
          ) : ioRegels.length === 0 ? (
            <p className="text-slate-500 text-sm py-4">
              Geen open inkooporders voor {groepKwaliteitCode} {groepKleurCode.replace(/\.0$/, '')}.
            </p>
          ) : (
            <div className="space-y-1.5">
              {ioRegels.map((io) => {
                const geselecteerd = geselecteerdIoId === io.regel_id
                const achterstallig = isAchterstalligeEta(io.verwacht_datum)
                const heeftRuimte = io.resterend_cm >= totaalBijdrageCm
                return (
                  <button
                    key={io.regel_id}
                    type="button"
                    disabled={!heeftRuimte}
                    onClick={() => setGeselecteerdIoId(geselecteerd ? null : io.regel_id)}
                    className={cn(
                      'w-full text-left rounded border p-2.5 text-xs transition-colors',
                      geselecteerd
                        ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-400'
                        : heeftRuimte
                          ? 'border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
                          : 'border-slate-100 bg-slate-50 opacity-60 cursor-not-allowed',
                    )}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <Truck size={12} className={achterstallig ? 'text-red-500' : 'text-orange-400'} />
                      <span className="font-medium text-slate-800">{io.inkooporder_nr}</span>
                      {io.leverancier_naam && (
                        <span className="text-slate-500">{io.leverancier_naam}</span>
                      )}
                      {achterstallig ? (
                        <span className="flex items-center gap-0.5 text-red-600 font-medium">
                          <AlertTriangle size={11} /> ETA verstreken
                        </span>
                      ) : io.verwacht_datum ? (
                        <span className={cn('ml-auto', achterstallig ? 'text-red-600' : 'text-slate-500')}>
                          verwacht {formatDate(io.verwacht_datum)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-slate-500">
                      <span>{formatNumber(io.te_leveren_m, 0)} m onderweg</span>
                      <span
                        className={cn(
                          'font-medium',
                          heeftRuimte ? 'text-emerald-700' : 'text-red-600',
                        )}
                      >
                        {formatNumber(io.resterend_cm / 100, 1)} m resterend
                      </span>
                      {!heeftRuimte && (
                        <span className="text-red-500">
                          te weinig voor ~{formatNumber(totaalBijdrageCm / 100, 1)} m
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {fout && (
            <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {fout}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-200 bg-slate-50">
          {/* Ontkoppelen — alleen voor wacht_op_inkoop */}
          <div>
            {regel.materiaalStatus === 'wacht_op_inkoop' && !succesBericht && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => ontkoppelMutatie.mutate()}
                className="text-xs text-red-600 hover:text-red-800 hover:underline disabled:opacity-50"
              >
                {ontkoppelMutatie.isPending ? (
                  <span className="flex items-center gap-1">
                    <Loader2 size={11} className="animate-spin" /> Verwijderen…
                  </span>
                ) : 'IO-koppeling verwijderen'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {succesBericht ? (
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-xs font-medium hover:bg-slate-300"
              >
                Sluiten
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
                  className="px-3 py-1.5 rounded border border-slate-300 text-slate-600 text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
                >
                  Annuleren
                </button>
                <button
                  type="button"
                  disabled={geselecteerdIoId === null || isBusy}
                  onClick={() => {
                    if (geselecteerdIoId !== null) {
                      koppelMutatie.mutate(geselecteerdIoId)
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {koppelMutatie.isPending ? (
                    <>
                      <Loader2 size={12} className="animate-spin" /> Koppelen…
                    </>
                  ) : (
                    <>
                      <Link2 size={12} />
                      Koppel aan IO
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
