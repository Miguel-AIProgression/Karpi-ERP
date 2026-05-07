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
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Printer } from 'lucide-react'
import { createZendingVoorOrder } from '../queries/zendingen'
import { useVervoerders } from '../hooks/use-vervoerders'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils/cn'
import type { PickShipOrder } from '@/modules/magazijn'

interface BulkVerzendsetButtonProps {
  orders: PickShipOrder[]
  /** Optioneel: extra label-suffix, bv. "voor klant" of "voor 🇳🇱 NL". */
  context?: string
}

function isPickbaar(o: PickShipOrder): boolean {
  if (o.regels.length === 0) return false
  return o.regels.every((r) => r.is_pickbaar)
}

export function BulkVerzendsetButton({ orders, context }: BulkVerzendsetButtonProps) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: vervoerders = [] } = useVervoerders()
  const [bezig, setBezig] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voortgang, setVoortgang] = useState<{ klaar: number; totaal: number } | null>(null)

  const pickbaar = orders.filter(isPickbaar)
  const heeftAfhalen = pickbaar.some((o) => o.afhalen)
  const heeftVerzend = pickbaar.some((o) => !o.afhalen)
  // Vervoerder-eis geldt alleen als er minstens één verzend-order in de groep
  // zit. Pure afhaal-bundel hoeft niet door verzendregels gerouteerd te worden.
  const heeftActieveVervoerder = vervoerders.some((v) => v.actief)
  const vervoerderOk = !heeftVerzend || heeftActieveVervoerder

  const aantal = pickbaar.length
  // Caller (cluster/land-header) bepaalt of het zinvol is deze knop te
  // renderen — wij tonen 'm áltijd zodat de magazijnier ook bij 1 pickbare
  // order direct vanaf de klant-/land-kop kan starten. Disable bij 0.
  const aantalOverig = orders.length - aantal
  const niksTeDoen = aantal === 0
  const disabled = bezig || !vervoerderOk || niksTeDoen

  const tooltip = !vervoerderOk
    ? 'Activeer eerst minstens één vervoerder bij Logistiek > Vervoerders'
    : niksTeDoen
      ? 'Geen pickbare orders in deze groep — eerst voorraad/snijden/confectie afronden'
      : aantalOverig > 0
        ? `Maak ${aantal} zending${aantal === 1 ? '' : 'en'} aan${context ? ` ${context}` : ''} en print alles in één bundel (${aantalOverig} order${aantalOverig === 1 ? '' : 's'} overgeslagen — nog niet pickbaar)`
        : heeftAfhalen && heeftVerzend
          ? `Bundel ${aantal} zendingen${context ? ` ${context}` : ''} — verzend-orders krijgen stickers + pakbon, afhalen alleen pakbon, in één print-job`
          : heeftAfhalen
            ? `Bundel ${aantal} afhaal-pakbon${aantal === 1 ? '' : 'nen'}${context ? ` ${context}` : ''} in één print-job (geen stickers — orders zijn afhalen)`
            : `Bundel ${aantal} verzendset${aantal === 1 ? '' : 'ten'}${context ? ` ${context}` : ''}: stickers + pakbonnen in één print-job`

  async function handleClick() {
    setError(null)
    setBezig(true)
    setVoortgang({ klaar: 0, totaal: aantal })
    const zendingNrs: string[] = []

    try {
      // Sequentieel: elke zending krijgt zijn eigen RPC-call. De RPC
      // (`start_pickronde`) is niet idempotent op grote schaal — parallel
      // uitvoeren kan nummer-collisies geven en maakt fouten lastiger te
      // diagnosticeren. Stap-voor-stap is OK: typisch 2-10 zendingen.
      for (let i = 0; i < pickbaar.length; i++) {
        const order = pickbaar[i]
        const zending = await createZendingVoorOrder(order.order_id)
        zendingNrs.push(zending.zending_nr)
        setVoortgang({ klaar: i + 1, totaal: aantal })
      }
      // Invalideer pick-ship + zendingen-overzicht in één keer ná de batch.
      qc.invalidateQueries({ queryKey: ['logistiek', 'zendingen'] })
      qc.invalidateQueries({ queryKey: ['pick-ship'] })

      const qs = encodeURIComponent(zendingNrs.join(','))
      navigate(`/logistiek/printset/bulk?zendingen=${qs}`)
    } catch (err) {
      // Bij partial fail: laat aangemaakte zendingen staan (geen rollback
      // nodig — magazijnier kan ze los afhandelen). Toon waar we vastliepen.
      const klaar = zendingNrs.length
      const fout = err instanceof Error ? err.message : String(err)
      setError(
        klaar > 0
          ? `Vastgelopen na ${klaar}/${aantal}: ${fout}. Reeds gemaakte zendingen staan in /logistiek.`
          : `Bulk-aanmaken mislukt: ${fout}`,
      )
    } finally {
      setBezig(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
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
    </div>
  )
}
