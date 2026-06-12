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
  /** Debiteur-nr van de order — nodig om de EDI-partnerconfig op te halen
   *  (orderbev_uit-toggle). */
  debiteurNr: number
  /** EDI-gewenste leverdatum (klant) — orders.edi_gewenste_afleverdatum (ISO). */
  gewenstIso: string | null
  /** Huidige (haalbare) afleverdatum — orders.afleverdatum (ISO). */
  afleverdatumIso: string | null
  /** Order-status, als haalbaarheidssignaal (bv. 'Wacht op inkoop'). */
  orderStatus: string
}

/**
 * Bevestig-paneel voor EDI-orders met onbevestigde leverweek (mig 309/310).
 * Operator ziet de klant-wens vs. de haalbare week, kan de week corrigeren en
 * bevestigt — dat zet orders.afleverdatum vast en plaatst de orderbev op de
 * uitgaande wachtrij (edi_bevestigd_op), waarna de order vrijkomt voor
 * picken/productie.
 */
export function EdiLeverweekBevestigen({ orderId, debiteurNr, gewenstIso, afleverdatumIso, orderStatus }: Props) {
  const [weekStr, setWeekStr] = useState(verzendWeekIsoString(afleverdatumIso || gewenstIso))

  const { kanaal, bericht, isLoading, configError, busy, error, bevestig } = useBevestigEdiOrder(orderId, debiteurNr)

  const gekozenDatum = verzendWeekStringToDatum(weekStr)
  const vergelijking = vergelijkLeverweek(gewenstIso, gekozenDatum)

  async function handleBevestig() {
    if (!gekozenDatum) return
    try {
      await bevestig(gekozenDatum)
    } catch {
      // error-state wordt door de hook gezet
    }
  }

  return (
    <div className="mb-4 rounded-[var(--radius)] border border-amber-300 bg-amber-50 p-4">
      <div className="mb-3 flex items-center gap-2 font-medium text-amber-900">
        <CalendarClock size={18} />
        Leverweek bevestigen (EDI-order)
      </div>

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
          Gekozen week valt {vergelijking.weken} {vergelijking.weken === 1 ? 'week' : 'weken'} later
          dan de klantwens.
        </div>
      )}

      {vergelijking.relatie === 'eerder' && (
        <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-sm)] bg-slate-100 px-3 py-2 text-sm text-slate-700">
          <AlertTriangle size={14} />
          Gekozen week valt {vergelijking.weken} {vergelijking.weken === 1 ? 'week' : 'weken'} vóór
          de klantwens — controleer of dit klopt.
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-slate-500">Bevestig leverweek</span>
          <input
            type="week"
            value={weekStr}
            onChange={(e) => setWeekStr(e.target.value)}
            className="rounded-[var(--radius-sm)] border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <button
          onClick={handleBevestig}
          disabled={busy || isLoading || configError || !gekozenDatum || (kanaal === 'edi' && !bericht)}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-terracotta-500 px-4 py-2 text-sm font-medium text-white hover:bg-terracotta-600 disabled:opacity-50"
          title="Zet de leverweek vast en verstuur de orderbevestiging. Hierna komt de order vrij voor picken/productie."
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {isLoading
            ? 'Bevestig leverweek'
            : kanaal === 'edi'
              ? 'Bevestig leverweek + verstuur orderbev'
              : 'Bevestig leverweek (orderbevestiging gaat per e-mail)'}
        </button>

        {configError && (
          <span className="text-sm text-rose-600">
            Partnerconfig kon niet geladen worden — probeer opnieuw of bevestig via de EDI-module.
          </span>
        )}

        {!configError && !isLoading && kanaal === 'email' && (
          <span className="text-sm text-slate-500">
            Deze partner ontvangt de orderbevestiging per e-mail — verstuur die via de knop "Bevestig order".
          </span>
        )}

        {!configError && kanaal === 'edi' && !isLoading && !bericht && (
          <span className="text-sm text-rose-600">
            Geen bron-EDI-bericht gevonden — bevestigen kan alleen via de EDI-module.
          </span>
        )}
      </div>

      {error && <div className="mt-2 text-sm text-rose-600">{error}</div>}
    </div>
  )
}
