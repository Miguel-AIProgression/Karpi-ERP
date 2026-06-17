// Sticky actiebalk voor de Pick & Ship multi-select. Verschijnt zodra ≥1 item is
// aangevinkt. Twee modi (besluit 17-06-2026):
//
//  - 'starten': de selectie in één keer starten & printen met optionele picker.
//    Hergebruikt exact het bestaande pad: één RPC `start_pickronden` (die
//    auto-4D-bundelt) en daarna navigeren naar de single- of bulk-printset via
//    `printsetPadVoorZendingen`.
//
//  - 'afronden': al-gestarte pickrondes in bulk op compleet zetten (→ Verzonden)
//    via RPC `voltooi_pickronden` (mig 412). GEEN printen, GEEN navigatie — na
//    afloop blijft de operator op Pick & Ship; afgeronde orders vallen uit de
//    lijst. Een zending met een openstaand pick-probleem wordt door de RPC
//    overgeslagen en hier per zending met reden teruggekoppeld.
//
// De picker is optioneel (besluit 2026-06-17): `picker_id` mag NULL (mig 394).
// De keuze wordt onthouden via de gedeelde last-picker-helper.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCheck, Layers, Loader2, Printer, X } from 'lucide-react'
import { PickerDropdown } from '@/components/orders/picker-dropdown'
import { useStartPickrondes, printsetPadVoorZendingen } from '@/modules/logistiek'
import { loadLastPicker, saveLastPicker } from '@/lib/orders/last-picker'
import { useVoltooiPickrondes } from '../hooks/use-pickronde'
import type { PickSelectieModus } from '../context/pick-selectie-context'
import type { PickShipOrder } from '../lib/types'

interface Props {
  modus: PickSelectieModus
  /** Geselecteerde, selecteerbare orders (page filtert stale ids) — stuurt 'starten'. */
  geselecteerdeOrders: PickShipOrder[]
  /** Unieke actieve-pickronde-zendingen achter de selectie — stuurt 'afronden'. */
  geselecteerdeZendingen: { zending_id: number; zending_nr: string }[]
  /** Niet-geselecteerde orders die door auto-4D-bundeling tóch meekomen (alleen 'starten'). */
  aantalBundelPartners: number
  onClear: () => void
}

export function PickSelectieBalk({
  modus,
  geselecteerdeOrders,
  geselecteerdeZendingen,
  aantalBundelPartners,
  onClear,
}: Props) {
  const navigate = useNavigate()
  const startMutation = useStartPickrondes()
  const voltooiMutation = useVoltooiPickrondes()
  // Pre-fill de laatst gekozen picker (gedeeld met de printset-pagina).
  const [pickerId, setPickerId] = useState<number | null>(() => loadLastPicker())
  const [error, setError] = useState<string | null>(null)
  // Per-zending-uitkomst van een bulk-afronding (deels-succes blijft zichtbaar).
  const [overgeslagen, setOvergeslagen] = useState<
    { zending_nr: string | null; reden: string | null }[]
  >([])

  const bezig = startMutation.isPending || voltooiMutation.isPending
  const aantal = modus === 'afronden' ? geselecteerdeZendingen.length : geselecteerdeOrders.length
  if (aantal === 0 && overgeslagen.length === 0) return null

  async function handleStart() {
    if (bezig) return
    setError(null)
    try {
      const zendingen = await startMutation.mutateAsync({
        orderIds: geselecteerdeOrders.map((o) => o.order_id),
        pickerId,
        forceSoloIds: [],
      })
      // Alleen onthouden bij een échte keuze — "geen picker" mag de eerder
      // onthouden picker niet wissen (consistent met de printset-pagina).
      if (pickerId) saveLastPicker(pickerId)
      onClear()
      navigate(printsetPadVoorZendingen(zendingen))
    } catch (err) {
      setError(readErrorMessage(err))
    }
  }

  async function handleAfronden() {
    if (bezig) return
    setError(null)
    setOvergeslagen([])
    try {
      const uitkomsten = await voltooiMutation.mutateAsync({
        zendingIds: geselecteerdeZendingen.map((z) => z.zending_id),
        pickerId,
      })
      if (pickerId) saveLastPicker(pickerId)
      const nietGelukt = uitkomsten.filter((u) => !u.ok)
      setOvergeslagen(nietGelukt.map((u) => ({ zending_nr: u.zending_nr, reden: u.reden })))
      // Geslaagde zendingen vallen door de cache-invalidatie uit de lijst; hun
      // order-ids verdwijnen uit de "schone" selectie. Alleen als álles lukte
      // wissen we expliciet zodat de balk meteen sluit.
      if (nietGelukt.length === 0) onClear()
    } catch (err) {
      setError(readErrorMessage(err))
    }
  }

  const afronden = modus === 'afronden'

  return (
    <div className="sticky bottom-4 z-30">
      <div
        className={cnBalk(afronden)}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
          <span
            className={
              'inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full px-1.5 text-xs font-bold text-white ' +
              (afronden ? 'bg-emerald-600' : 'bg-terracotta-500')
            }
          >
            {aantal}
          </span>
          {afronden
            ? `pickronde${aantal === 1 ? '' : 's'} geselecteerd`
            : `order${aantal === 1 ? '' : 's'} geselecteerd`}
        </span>

        {!afronden && aantalBundelPartners > 0 && (
          <span
            className="inline-flex items-center gap-1 text-xs text-terracotta-700"
            title="Orders die kunnen bundelen met je selectie (zelfde klant, adres, vervoerder én verzendweek) worden automatisch in dezelfde zending meegenomen."
          >
            <Layers size={13} />
            +{aantalBundelPartners} bundelpartner{aantalBundelPartners === 1 ? '' : 's'} mee
          </span>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="w-52">
            <PickerDropdown
              value={pickerId}
              onChange={setPickerId}
              placeholder="Picker (optioneel)…"
            />
          </div>
          {afronden ? (
            <button
              type="button"
              onClick={handleAfronden}
              disabled={bezig || aantal === 0}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {voltooiMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CheckCheck size={15} />
              )}
              Zet op compleet ({aantal})
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStart}
              disabled={bezig}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {startMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Printer size={15} />
              )}
              Start &amp; print ({aantal})
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setOvergeslagen([])
              onClear()
            }}
            disabled={bezig}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            <X size={15} />
            Wis
          </button>
        </div>
      </div>
      {error && <div className="mt-1 px-4 text-right text-xs text-rose-600">{error}</div>}
      {overgeslagen.length > 0 && (
        <div className="mt-1 rounded-[var(--radius-sm)] border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          <span className="font-semibold">
            {overgeslagen.length} pickronde{overgeslagen.length === 1 ? '' : 's'} overgeslagen
          </span>{' '}
          (controleer pick-problemen):{' '}
          {overgeslagen
            .map((o) => `${o.zending_nr ?? 'zending'} — ${o.reden ?? 'onbekende reden'}`)
            .join(' · ')}
        </div>
      )}
    </div>
  )
}

function cnBalk(afronden: boolean): string {
  return (
    'flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius)] border-2 bg-white px-4 py-3 shadow-lg ' +
    (afronden ? 'border-emerald-500' : 'border-terracotta-400')
  )
}

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const parts = [obj.message, obj.details, obj.hint, obj.code].filter(
      (part): part is string => typeof part === 'string' && part.trim().length > 0,
    )
    if (parts.length > 0) return parts.join(' ')
  }
  return String(err)
}
