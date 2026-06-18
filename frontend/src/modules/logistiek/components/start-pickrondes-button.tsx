// StartPickrondesButton — canonieke entry voor pickronde-start (ADR-0012, mig 248).
//
// Vervangt zowel `<VerzendsetButton order={order}>` (op order-card) als
// `<BulkVerzendsetButton orders={cluster.orders}>` (op cluster-card). Eén knop,
// één RPC (`start_pickronden`). Auto-4D-bundeling is default-on in de RPC.
//
// Twee varianten (styling):
//   - 'compact'   (standaard op order-card): klein, slate-900, "Verzendset"/"Afhaalset"
//   - 'prominent' (standaard op cluster-card): terracotta, "Bundel printen (N)"
//
// Twee scopes (label-betekenis):
//   - 'bundel' (default): de orders gaan naar één adres → één zending. Label
//     "Bundel printen (N)". Gebruikt op de klant-cluster-card.
//   - 'groep': de orders zijn een hele groepering (bv. een land); ze vallen
//     intern uiteen in MEERDERE losse zendingen (auto-4D per adres). Géén
//     bundel — label "Hele groep starten & printen (N)", net als StartWeekButton.
//     Voorkomt de verwarring met de échte adres-bundel-knop (verzoek 2026-06-18).
//
// Eén klik, geen picker, geen popover (besluit 2026-06-17): het magazijn print
// met één persoon en verdeelt het werk daarna — een picker per order kiezen was
// onnodige wrijving. `picker_id` blijft NULL (mig 394). Ook de force-solo-
// checkboxen (bundel opsplitsen) zijn vervallen: de multi-select op de Pick &
// Ship-lijst geeft daar fijnmaziger controle over (partner-bewuste force_solo).
//
// **Geen bespaar-info in dit component.** Verzendkosten-besparing is factuur-
// /commerciële context die niet thuishoort in de pick-flow.
//
// Pickbaarheid-/vervoerder-/intake-resolutie loopt via de gedeelde
// `usePickbaarheid`-hook (zelfde filtering als StartWeekButton en de bulkbalk).
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Printer, PackageCheck } from 'lucide-react'
import { useStartPickrondes } from '../hooks/use-zendingen'
import { useVervoerders } from '../hooks/use-vervoerders'
import { usePickbaarheid } from '../hooks/use-pickbaarheid'
import { cn } from '@/lib/utils/cn'
import { iso2NaarNaam, landNaarIso2 } from '@/lib/utils/land-vlag'
import type { PickShipOrder } from '@/modules/magazijn'

interface StartPickrondesButtonProps {
  /** Orders die de operator wil starten. Voor solo: één order; voor bundel: ≥2. */
  orders: PickShipOrder[]
  /** Optioneel: extra tooltip-suffix, bv. "voor klant X" of "voor 🇳🇱 NL". */
  context?: string
  /** Compact = op order-card (klein, slate-900). Prominent = op cluster-card (terracotta). */
  variant?: 'compact' | 'prominent'
  /** Label-betekenis. 'bundel' = één adres-zending ("Bundel printen"); 'groep' =
   *  hele groepering die in meerdere zendingen uiteenvalt ("Hele groep starten
   *  & printen"). Zie de header-comment. */
  scope?: 'bundel' | 'groep'
}

export function StartPickrondesButton({
  orders,
  context,
  variant = 'prominent',
  scope = 'bundel',
}: StartPickrondesButtonProps) {
  const navigate = useNavigate()
  const mutation = useStartPickrondes()
  const { data: vervoerders = [] } = useVervoerders()
  const [error, setError] = useState<string | null>(null)

  const {
    pickbareOrders,
    geenVervoerderIds,
    aantalAflAdres,
    aantalPrijs,
    aantalGeblokkeerd,
    vervoerderResolutieLaadt,
  } = usePickbaarheid(orders)

  const aantal = pickbareOrders.length
  const aantalOverig = orders.length - aantal
  const heeftVerzend = pickbareOrders.some((o) => !o.afhalen)
  const heeftActieveVervoerder = vervoerders.some((v) => v.actief)
  const vervoerderOk = !heeftVerzend || heeftActieveVervoerder
  const isBundel = pickbareOrders.length >= 2

  const niksTeDoen = aantal === 0
  const alleenGeblokkeerd = niksTeDoen && aantalGeblokkeerd > 0
  // Data-fouten op de order (mig 395/396) krijgen voorrang in de melding boven
  // "nog geen vervoerder voor dit land". Adres vóór prijs.
  const alleenAflAdres = alleenGeblokkeerd && aantalAflAdres > 0
  const alleenPrijs = alleenGeblokkeerd && aantalAflAdres === 0 && aantalPrijs > 0
  const disabled = mutation.isPending || !vervoerderOk || niksTeDoen || vervoerderResolutieLaadt

  // Afleverlanden van de orders die op "geen vervoerder" geblokkeerd zijn.
  // Voedt de zichtbare reden onder de knop: de operator hoeft niet te raden
  // waaróm — meestal is er simpelweg nog geen actieve vervoerder voor dat land.
  const geenVervoerderLanden = useMemo(() => {
    const namen = new Set<string>()
    for (const o of orders) {
      if (!geenVervoerderIds.has(o.order_id)) continue
      const iso2 = landNaarIso2(o.afl_land)
      const naam = (iso2 ? iso2NaarNaam(iso2) ?? iso2 : o.afl_land?.trim()) || ''
      namen.add(naam.length > 0 ? naam : 'onbekend land')
    }
    return Array.from(namen)
  }, [orders, geenVervoerderIds])

  // Alleen wanneer de knop daadwerkelijk "Geen vervoerder mogelijk" toont
  // (= geblokkeerd, maar niet door adres/prijs — die hebben hun eigen melding).
  const toonGeenVervoerderReden = alleenGeblokkeerd && !alleenAflAdres && !alleenPrijs
  const landTekst = geenVervoerderLanden.join(', ')
  // Korte, zichtbare reden onder de knop; de volledige oplossing staat in de tooltip.
  const geenVervoerderReden = toonGeenVervoerderReden
    ? landTekst
      ? `Nog geen actieve vervoerder voor ${landTekst}`
      : 'Geen passende vervoerder voor deze order'
    : null

  // Tooltip-tekst — context-aware.
  const tooltip = !vervoerderOk
    ? 'Activeer eerst minstens één vervoerder bij Logistiek > Vervoerders'
    : alleenAflAdres
      ? 'Afleveradres ontbreekt — vul het verzendadres aan op de order voordat je een pickronde start'
      : alleenPrijs
        ? 'Prijs ontbreekt (€0) — corrigeer de prijs of bevestig op de order dat €0 klopt voordat je een pickronde start'
      : alleenGeblokkeerd
      ? (landTekst
          ? `Nog geen actieve vervoerder voor ${landTekst} — activeer de vervoerder (Logistiek > Vervoerders) of kies handmatig een vervoerder op de order`
          : 'Geen vervoerder mogelijk voor dit afleverland — activeer de vervoerder (Logistiek > Vervoerders) of kies handmatig een vervoerder op de order')
      : niksTeDoen
        ? 'Geen pickbare orders in deze groep — eerst voorraad/snijden/confectie afronden'
        : scope === 'groep'
          ? `Start alle ${aantal} pickbare orders${context ? ` ${context}` : ''} — worden automatisch per adres gebundeld${
              aantalOverig > 0 ? ` (${aantalOverig} overgeslagen — nog niet pickbaar of geen vervoerder)` : ''
            }`
          : isBundel
            ? `Bundel ${aantal} zendingen${context ? ` ${context}` : ''}${
                aantalOverig > 0 ? ` (${aantalOverig} overgeslagen — nog niet pickbaar of geen vervoerder)` : ''
              }`
            : pickbareOrders[0]?.afhalen
              ? 'Start afhaal-pickronde (geen verzendstickers)'
              : 'Start pickronde — print daarna stickers en pakbon'

  async function handleStart() {
    if (disabled) return
    setError(null)
    try {
      const zendingen = await mutation.mutateAsync({
        orderIds: pickbareOrders.map((o) => o.order_id),
        pickerId: null,
        forceSoloIds: [],
      })
      if (zendingen.length === 1) {
        navigate(`/logistiek/${zendingen[0].zending_nr}/printset`)
      } else {
        const qs = encodeURIComponent(zendingen.map((z) => z.zending_nr).join(','))
        navigate(`/logistiek/printset/bulk?zendingen=${qs}`)
      }
    } catch (err) {
      setError(readErrorMessage(err))
    }
  }

  const knopLabel =
    scope === 'groep'
      ? aantalOverig > 0
        ? `Hele groep starten & printen (${aantal} van ${orders.length})`
        : `Hele groep starten & printen (${aantal})`
      : isBundel
        ? aantalOverig > 0
          ? `Bundel printen (${aantal} van ${orders.length})`
          : `Bundel printen (${aantal})`
        : pickbareOrders[0]?.afhalen
          ? 'Afhaalset'
          : 'Verzendset'

  const knopIcon = mutation.isPending ? (
    <Loader2 size={13} className="animate-spin" />
  ) : !isBundel && pickbareOrders[0]?.afhalen ? (
    <PackageCheck size={13} />
  ) : (
    <Printer size={13} />
  )

  const buttonClass =
    variant === 'compact'
      ? cn(
          'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-800',
          'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-slate-900',
        )
      : cn(
          'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-terracotta-600',
          'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-terracotta-500',
        )

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleStart}
        disabled={disabled}
        title={tooltip}
        className={buttonClass}
      >
        {knopIcon}
        {alleenAflAdres
          ? 'Afleveradres ontbreekt'
          : alleenPrijs
            ? 'Prijs ontbreekt'
            : alleenGeblokkeerd
              ? 'Geen vervoerder mogelijk'
              : niksTeDoen
                ? 'Niets pickbaar'
                : knopLabel}
      </button>
      {!error && geenVervoerderReden && (
        <div className="max-w-72 text-right text-[11px] leading-tight text-amber-700">
          {geenVervoerderReden}
        </div>
      )}
      {error && <div className="max-w-72 text-right text-[11px] text-rose-600">{error}</div>}
    </div>
  )
}

function readErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>
    const parts = [obj.message, obj.details, obj.hint, obj.code]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    if (parts.length > 0) return parts.join(' ')
  }
  return String(err)
}
