// Bulk-versie van VerzendsetButton: voor een groep orders (klant-cluster of
// land-groep) maakt deze knop in één klik voor elke pickbare order een
// zending aan, en navigeert naar `/logistiek/printset/bulk?zendingen=...`
// waar alle stickers + pakbonnen achter elkaar gerenderd staan voor één
// print-job.
//
// Bewust GEEN afhalen-filter: een klant-cluster kan een mix zijn (verzend +
// afhaal), en de magazijnier wil ze samen afhandelen. Verzend-zendingen
// produceren stickers + pakbon; afhaal-zendingen alleen een pakbon (geen
// sticker — bulk-printset-pagina onderdrukt die regel). Filter is dus puur
// op pickbaarheid: niet-pickbare orders kun je sowieso niet starten.
//
// Mig 217: één picker per bundel — alle zendingen in deze batch krijgen
// dezelfde picker_id (= de operator die op het knopje drukt). Bij shift-
// overgang kan de operator op /logistiek/{nr}/printset alsnog wisselen.
//
// Mig 222: orders binnen het cluster worden eerst gegroepeerd op (genormali-
// seerd afleveradres × effectieve vervoerder). Adres-bundels (≥2 orders met
// identieke combinatie) gaan via `startPickrondenBundel` (1 zending per
// vervoerder, gedeeld over orders); solo's gaan via `startPickrondenVoorOrder`
// (eventuele per-regel-vervoerder-splits binnen die order). Zo krijgt een B2B-
// klant met centraal magazijn 1 pakbon i.p.v. N losse.
import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Printer, X } from 'lucide-react'
import { useQueries } from '@tanstack/react-query'
import { startPickrondenBundel, startPickrondenVoorOrder } from '../queries/zendingen'
import { useVervoerders } from '../hooks/use-vervoerders'
import { fetchEffectieveVervoerderPerOrderregel } from '../queries/orderregel-vervoerder'
import { aggregeerVervoerderKeuzeVoorOrder } from '../queries/vervoerder-keuze'

const STALE_30_SEC = 30_000
import { clusterOpAdresEnVervoerder } from '@/modules/magazijn'
import type { ResolvedVervoerder } from '@/modules/magazijn'
import { PickerDropdown } from '@/components/orders/picker-dropdown'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils/cn'
import type { PickShipOrder } from '@/modules/magazijn'

interface BulkVerzendsetButtonProps {
  orders: PickShipOrder[]
  /** Optioneel: extra label-suffix, bv. "voor klant" of "voor 🇳🇱 NL". */
  context?: string
}

const LAST_PICKER_KEY = 'rugflow.last-picker-id'

function loadLastPicker(): number | null {
  try {
    const v = localStorage.getItem(LAST_PICKER_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

function saveLastPicker(id: number) {
  try {
    localStorage.setItem(LAST_PICKER_KEY, String(id))
  } catch {
    /* ignore */
  }
}

function isPickbaar(o: PickShipOrder): boolean {
  if (o.regels.length === 0) return false
  // Orders met een lopende pickronde tellen niet mee voor de bundel — die
  // zijn al gestart en hebben hun eigen "In pickronde"-link op de card.
  if (o.actieve_pickronde) return false
  return o.regels.every((r) => r.is_pickbaar)
}

export function BulkVerzendsetButton({ orders, context }: BulkVerzendsetButtonProps) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: vervoerders = [] } = useVervoerders()
  const [bezig, setBezig] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voortgang, setVoortgang] = useState<{ klaar: number; totaal: number } | null>(null)
  const [showPickerPopover, setShowPickerPopover] = useState(false)
  const [pickerId, setPickerId] = useState<number | null>(loadLastPicker())
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showPickerPopover) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPickerPopover(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPickerPopover])

  const pickbaar = useMemo(() => orders.filter(isPickbaar), [orders])
  const heeftAfhalen = pickbaar.some((o) => o.afhalen)
  const heeftVerzend = pickbaar.some((o) => !o.afhalen)
  // Vervoerder-eis geldt alleen als er minstens één verzend-order in de groep
  // zit. Pure afhaal-bundel hoeft niet door verzendregels gerouteerd te worden.
  const heeftActieveVervoerder = vervoerders.some((v) => v.actief)
  const vervoerderOk = !heeftVerzend || heeftActieveVervoerder

  // Per pickbare order: haal de per-regelvervoerder op en aggregeer naar één
  // effectieve code. Cache-deelt via dezelfde queryKeys als de inline-select.
  // De cluster-helper gebruikt de map om identieke (adres × vervoerder)-paren
  // te bundelen vóór de RPC-aanroepen (mig 222, ADR-0008).
  const perOrderQueries = useQueries({
    queries: pickbaar.map((o) => ({
      queryKey: ['logistiek', 'orderregel-vervoerder', o.order_id],
      queryFn: () => fetchEffectieveVervoerderPerOrderregel(o.order_id),
      staleTime: STALE_30_SEC,
    })),
  })
  const vervoerderMap = useMemo(() => {
    const m = new Map<number, ResolvedVervoerder>()
    pickbaar.forEach((o, i) => {
      const q = perOrderQueries[i]
      const regels = q?.data ?? []
      const aggregaat = aggregeerVervoerderKeuzeVoorOrder(regels)
      m.set(o.order_id, {
        code: aggregaat.soort === 'uniform' ? aggregaat.code : null,
        afhalen: o.afhalen,
      })
    })
    return m
  }, [pickbaar, perOrderQueries])

  // Clusters: bundels (≥2 orders) komen eerst, daarna solo's.
  const clusters = useMemo(
    () => clusterOpAdresEnVervoerder(pickbaar, vervoerderMap),
    [pickbaar, vervoerderMap],
  )
  const aantalBundels = clusters.filter((c) => c.isBundel).length

  const aantal = pickbaar.length
  // Caller (cluster/land-header) bepaalt of het zinvol is deze knop te
  // renderen — wij tonen 'm áltijd zodat de magazijnier ook bij 1 pickbare
  // order direct vanaf de klant-/land-kop kan starten. Disable bij 0.
  const aantalOverig = orders.length - aantal
  const niksTeDoen = aantal === 0
  const disabled = bezig || !vervoerderOk || niksTeDoen

  // Tooltip kort: extra zin als er bundels gedetecteerd zijn (mig 222).
  const bundelHint =
    aantalBundels > 0
      ? ` Hiervan ${aantalBundels === 1 ? 'wordt 1 bundel-pakbon' : `worden ${aantalBundels} bundel-pakbonnen`} gemaakt (gelijk afleveradres + vervoerder).`
      : ''

  const tooltip = !vervoerderOk
    ? 'Activeer eerst minstens één vervoerder bij Logistiek > Vervoerders'
    : niksTeDoen
      ? 'Geen pickbare orders in deze groep — eerst voorraad/snijden/confectie afronden'
      : aantalOverig > 0
        ? `Maak ${aantal} zending${aantal === 1 ? '' : 'en'} aan${context ? ` ${context}` : ''} en print alles in één bundel (${aantalOverig} order${aantalOverig === 1 ? '' : 's'} overgeslagen — nog niet pickbaar).${bundelHint}`
        : heeftAfhalen && heeftVerzend
          ? `Bundel ${aantal} zendingen${context ? ` ${context}` : ''} — verzend-orders krijgen stickers + pakbon, afhalen alleen pakbon, in één print-job.${bundelHint}`
          : heeftAfhalen
            ? `Bundel ${aantal} afhaal-pakbon${aantal === 1 ? '' : 'nen'}${context ? ` ${context}` : ''} in één print-job (geen stickers — orders zijn afhalen).${bundelHint}`
            : `Bundel ${aantal} verzendset${aantal === 1 ? '' : 'ten'}${context ? ` ${context}` : ''}: stickers + pakbonnen in één print-job.${bundelHint}`

  function openPickerPopover() {
    setError(null)
    setShowPickerPopover(true)
  }

  async function handleStart() {
    console.debug('[BulkVerzendset] handleStart triggered', { pickerId, clusters: clusters.length, bundels: aantalBundels })
    if (!pickerId) {
      setError('Kies eerst een picker')
      return
    }
    setError(null)
    setBezig(true)
    saveLastPicker(pickerId)
    setVoortgang({ klaar: 0, totaal: clusters.length })
    const zendingNrs: string[] = []

    try {
      // Sequentieel: elke cluster krijgt zijn eigen RPC-call. De RPC's zijn
      // niet idempotent op grote schaal — parallel uitvoeren kan nummer-
      // collisies geven en maakt fouten lastiger te diagnosticeren. Per
      // cluster: ≥2 orders → bundel-RPC (mig 222), 1 order → solo-RPC die
      // intern weer kan splitsen op per-regel-vervoerder (mig 220).
      for (let i = 0; i < clusters.length; i++) {
        const cl = clusters[i]
        const orderIds = cl.orders.map((o) => o.order_id)
        console.debug('[BulkVerzendset] processing cluster', { sleutel: cl.sleutel, isBundel: cl.isBundel, orders: orderIds })
        const zendingen = cl.isBundel
          ? await startPickrondenBundel(orderIds, pickerId)
          : await startPickrondenVoorOrder(orderIds[0], pickerId)
        console.debug('[BulkVerzendset] cluster created', {
          sleutel: cl.sleutel,
          aantal: zendingen.length,
          nrs: zendingen.map((z) => z.zending_nr),
        })
        zendingNrs.push(...zendingen.map((z) => z.zending_nr))
        setVoortgang({ klaar: i + 1, totaal: clusters.length })
      }
      // Invalideer pick-ship + zendingen-overzicht in één keer ná de batch.
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })
      // Mig 229: orders die nu in een actieve zending zitten verdwijnen uit
      // voorgestelde-bundels-view; refetch de live preview.
      qc.invalidateQueries({ queryKey: ['voorgestelde-bundels'] })

      setShowPickerPopover(false)
      const qs = encodeURIComponent(zendingNrs.join(','))
      console.debug('[BulkVerzendset] navigating to bulk-printset', { zendingNrs })
      navigate(`/logistiek/printset/bulk?zendingen=${qs}`)
    } catch (err) {
      // Bij partial fail: laat aangemaakte zendingen staan (geen rollback
      // nodig — magazijnier kan ze los afhandelen). Toon waar we vastliepen.
      console.error('[BulkVerzendset] handleStart failed', err)
      const klaarClusters = voortgang?.klaar ?? 0
      const fout = err instanceof Error ? err.message : String(err)
      setError(
        klaarClusters > 0
          ? `Vastgelopen na ${klaarClusters}/${clusters.length} groep(en): ${fout}. Reeds gemaakte zendingen staan in /logistiek.`
          : `Bulk-aanmaken mislukt: ${fout}`,
      )
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="relative inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={openPickerPopover}
        disabled={disabled}
        title={tooltip}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors',
          'bg-terracotta-500 text-white hover:bg-terracotta-600',
          'disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-terracotta-500',
        )}
      >
        {bezig ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}
        {bezig && voortgang
          ? `Bezig... ${voortgang.klaar}/${voortgang.totaal}`
          : niksTeDoen
            ? 'Niets pickbaar'
            : aantalOverig > 0
              ? `Bundel printen (${aantal} van ${orders.length})`
              : `Bundel printen (${aantal})`}
      </button>
      {error && <div className="max-w-72 text-right text-[11px] text-rose-600">{error}</div>}

      {showPickerPopover && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full z-30 mt-1 w-72 rounded-[var(--radius)] border border-slate-200 bg-white p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">
              Wie pickt deze {aantal === 1 ? 'order' : `${aantal} orders`}?
            </div>
            <button
              onClick={() => setShowPickerPopover(false)}
              className="text-slate-400 hover:text-slate-700"
            >
              <X size={14} />
            </button>
          </div>
          <PickerDropdown value={pickerId} onChange={setPickerId} placeholder="Kies picker…" />
          <p className="mt-2 text-[11px] text-slate-500">
            Alle zendingen in deze bundel krijgen dezelfde picker. Op de printset-pagina
            kun je per zending alsnog wisselen voor een shift-overgang.
          </p>
          {aantalBundels > 0 && (
            <p className="mt-1 text-[11px] text-terracotta-700">
              {aantalBundels === 1
                ? '1 adres-bundel gedetecteerd: orders met identiek afleveradres + vervoerder krijgen 1 gezamenlijke pakbon.'
                : `${aantalBundels} adres-bundels gedetecteerd: orders met identiek afleveradres + vervoerder krijgen elk 1 gezamenlijke pakbon.`}
            </p>
          )}
          {error && (
            <div className="mt-2 rounded-[var(--radius-sm)] border border-rose-100 bg-rose-50 px-2 py-1.5 text-[11px] text-rose-700">
              {error}
            </div>
          )}
          {bezig && voortgang && (
            <div className="mt-2 text-[11px] text-slate-600">
              Bezig… {voortgang.klaar}/{voortgang.totaal} groep(en) verwerkt
            </div>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              onClick={() => setShowPickerPopover(false)}
              disabled={bezig}
              className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 disabled:opacity-45"
            >
              Annuleren
            </button>
            <button
              type="button"
              onClick={handleStart}
              disabled={!pickerId || bezig}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-terracotta-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-terracotta-600 disabled:opacity-45"
            >
              {bezig && <Loader2 size={12} className="animate-spin" />}
              Start bundel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
