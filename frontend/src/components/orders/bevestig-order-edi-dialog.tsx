import { useState } from 'react'
import { CalendarClock, Loader2, Check, AlertTriangle } from 'lucide-react'
import {
  verzendWeekKort,
  verzendWeekIsoString,
  verzendWeekStringToDatum,
} from '@/lib/orders/verzendweek'
import { vergelijkLeverweek } from '@/lib/orders/edi-leverweek'
import { useBevestigEdiOrder } from '@/modules/edi'

interface Props {
  orderId: number
  orderNr: string
  debiteurNr: number
  gewenstIso: string | null
  afleverdatumIso: string | null
  orderStatus: string
  onClose: () => void
}

/**
 * EDI-variant van de universele "Bevestig order"-knop. Geen e-mailveld:
 * een EDI-order wordt nooit per mail bevestigd. Bij kanaal 'edi' gaat een
 * ORDRSP op de Transus-wachtrij; bij 'edi_stil' (partner zonder orderbev_uit)
 * wordt alleen de edi_bevestigd_op-gate gezet.
 */
export function BevestigOrderEdiDialog({
  orderId,
  orderNr,
  debiteurNr,
  gewenstIso,
  afleverdatumIso,
  orderStatus,
  onClose,
}: Props) {
  const [weekStr, setWeekStr] = useState(verzendWeekIsoString(afleverdatumIso || gewenstIso))
  const [klaar, setKlaar] = useState(false)
  const { kanaal, bericht, isLoading, configError, busy, error, bevestig } = useBevestigEdiOrder(orderId, debiteurNr)

  const gekozenDatum = verzendWeekStringToDatum(weekStr)
  const vergelijking = vergelijkLeverweek(gewenstIso, gekozenDatum)

  async function handleBevestig() {
    if (!gekozenDatum) return
    try {
      await bevestig(gekozenDatum)
      setKlaar(true)
    } catch {
      // error-state komt uit de hook
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-[var(--radius)] shadow-xl p-6 max-w-md w-full mx-4">
        {klaar ? (
          <>
            <div className="flex flex-col items-center gap-3 py-4">
              <Check className="text-green-500" size={40} />
              <h3 className="text-lg font-semibold text-slate-900">Order bevestigd</h3>
              <p className="text-sm text-slate-600 text-center">
                {kanaal === 'edi' ? (
                  <>
                    De orderbevestiging van <strong>{orderNr}</strong> staat op de EDI-wachtrij en
                    wordt binnen een minuut via Transus verstuurd.
                  </>
                ) : (
                  <>
                    <strong>{orderNr}</strong> is administratief bevestigd. Er is geen actieve
                    EDI-orderbevestiging voor deze partner.
                  </>
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-full mt-4 px-4 py-2 bg-slate-100 text-slate-700 rounded-[var(--radius-sm)] hover:bg-slate-200 text-sm font-medium"
            >
              Sluiten
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock size={18} className="text-terracotta-500" />
              <h3 className="text-lg font-semibold text-slate-900">Order bevestigen (EDI)</h3>
            </div>
            <p className="text-sm text-slate-500 mb-4">
              {isLoading ? (
                <>Partnerconfiguratie laden…</>
              ) : kanaal === 'edi' ? (
                <>
                  De bevestiging van <strong>{orderNr}</strong> gaat via EDI (Transus) naar de
                  partner — niet per e-mail.
                </>
              ) : (
                <>
                  Er is geen actieve EDI-orderbevestiging voor deze partner. De order wordt alleen
                  administratief bevestigd; er gaat géén bericht en géén e-mail uit.
                </>
              )}
            </p>

            <div className="mb-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <div className="text-slate-500">Klant wenst</div>
                <div className="font-medium text-slate-800">
                  {gewenstIso ? `${verzendWeekKort(gewenstIso)} · ${gewenstIso}` : '—'}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Haalbaar (voorraad/inkoop)</div>
                <div className="font-medium text-slate-800">
                  {afleverdatumIso ? `${verzendWeekKort(afleverdatumIso)} · ${afleverdatumIso}` : '—'}
                  <span className="ml-2 text-xs text-slate-500">status: {orderStatus}</span>
                </div>
              </div>
            </div>

            {vergelijking.relatie === 'later' && (
              <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-amber-100 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle size={14} />
                Gekozen week valt {vergelijking.weken}{' '}
                {vergelijking.weken === 1 ? 'week' : 'weken'} later dan de klantwens.
              </div>
            )}
            {vergelijking.relatie === 'eerder' && (
              <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-slate-100 px-3 py-2 text-sm text-slate-700">
                <AlertTriangle size={14} />
                Gekozen week valt {vergelijking.weken}{' '}
                {vergelijking.weken === 1 ? 'week' : 'weken'} vóór de klantwens — controleer of dit
                klopt.
              </div>
            )}

            <label className="block text-sm mb-4">
              <span className="mb-1 block text-slate-500">Bevestig leverweek</span>
              <input
                type="week"
                value={weekStr}
                onChange={(e) => setWeekStr(e.target.value)}
                className="rounded-[var(--radius-sm)] border border-slate-300 px-3 py-2 text-sm"
              />
            </label>

            {configError && (
              <p className="mb-3 text-sm text-rose-600">
                Partnerconfig kon niet geladen worden — probeer opnieuw of bevestig via de EDI-module.
              </p>
            )}
            {!configError && kanaal === 'edi' && !isLoading && !bericht && (
              <p className="mb-3 text-sm text-rose-600">
                Geen bron-EDI-bericht gevonden — bevestigen kan alleen via de EDI-module.
              </p>
            )}
            {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

            <div className="flex gap-2 justify-end">
              <button
                onClick={onClose}
                disabled={busy}
                className="px-4 py-2 text-sm border border-slate-200 rounded-[var(--radius-sm)] hover:bg-slate-50 disabled:opacity-50"
              >
                Annuleren
              </button>
              <button
                onClick={handleBevestig}
                disabled={busy || isLoading || configError || !gekozenDatum || (kanaal === 'edi' && !bericht)}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-terracotta-500 text-white rounded-[var(--radius-sm)] hover:bg-terracotta-600 disabled:opacity-50 font-medium"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {isLoading
                  ? 'Bevestig order'
                  : kanaal === 'edi'
                    ? 'Bevestig + verstuur via EDI'
                    : 'Bevestig (zonder bericht)'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
