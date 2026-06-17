// Sticky actiebalk voor de Pick & Ship multi-select. Verschijnt zodra ≥1 order
// is aangevinkt en biedt: picker kiezen (optioneel), de selectie in één keer
// starten & printen, en de selectie wissen.
//
// "Start & print" hergebruikt exact het bestaande pad: één RPC `start_pickronden`
// (die auto-4D-bundelt — orders die kunnen bundelen krijgen samen één zending)
// en daarna navigeren naar de single- of bulk-printset via de gedeelde
// `printsetPadVoorZendingen`-helper, net als "Hele week starten & printen".
//
// De picker is optioneel (besluit 2026-06-17): `picker_id` mag NULL (mig 394).
// De keuze wordt onthouden via de gedeelde last-picker-helper, zodat 'm op de
// printset-pagina al ingevuld staat.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Layers, Loader2, Printer, X } from 'lucide-react'
import { PickerDropdown } from '@/components/orders/picker-dropdown'
import { useStartPickrondes, printsetPadVoorZendingen } from '@/modules/logistiek'
import { loadLastPicker, saveLastPicker } from '@/lib/orders/last-picker'
import type { PickShipOrder } from '../lib/types'

interface Props {
  /** De daadwerkelijk geselecteerde, selecteerbare orders (page filtert stale ids). */
  geselecteerdeOrders: PickShipOrder[]
  /** Niet-geselecteerde orders die door auto-4D-bundeling tóch meekomen (transparantie). */
  aantalBundelPartners: number
  onClear: () => void
}

export function PickSelectieBalk({
  geselecteerdeOrders,
  aantalBundelPartners,
  onClear,
}: Props) {
  const navigate = useNavigate()
  const mutation = useStartPickrondes()
  // Pre-fill de laatst gekozen picker (gedeeld met de printset-pagina).
  const [pickerId, setPickerId] = useState<number | null>(() => loadLastPicker())
  const [error, setError] = useState<string | null>(null)

  const aantal = geselecteerdeOrders.length
  if (aantal === 0) return null

  async function handleStart() {
    if (mutation.isPending) return
    setError(null)
    try {
      const zendingen = await mutation.mutateAsync({
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

  return (
    <div className="sticky bottom-4 z-30">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius)] border-2 border-terracotta-400 bg-white px-4 py-3 shadow-lg">
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
          <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-terracotta-500 px-1.5 text-xs font-bold text-white">
            {aantal}
          </span>
          order{aantal === 1 ? '' : 's'} geselecteerd
        </span>

        {aantalBundelPartners > 0 && (
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
          <button
            type="button"
            onClick={handleStart}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-terracotta-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {mutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Printer size={15} />
            )}
            Start &amp; print ({aantal})
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            <X size={15} />
            Wis
          </button>
        </div>
      </div>
      {error && <div className="mt-1 px-4 text-right text-xs text-rose-600">{error}</div>}
    </div>
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
