import { AlertTriangle } from 'lucide-react'
import { useLatestShopifySyncRun } from '@/hooks/use-shopify-sync'

// De cron draait elke 10 minuten (mig 323) — als de laatst-gestarte run ouder
// is dan dit, is de cron vermoedelijk uitgevallen (zoals bij de dode webhook
// die deze poller juist moest vervangen).
const VERWACHTE_INTERVAL_MINUTEN = 10
const STALE_DREMPEL_MS = VERWACHTE_INTERVAL_MINUTEN * 3 * 60_000

/**
 * Waarschuwingsbanner: de geplande Shopify-orderpoll (sync-shopify-orders-poll)
 * is mislukt of stilgevallen. Onzichtbaar zolang de poll gewoon draait — dit is
 * een storingssignaal, geen statusoverzicht (vergelijk EdiTeKoppelenBanner).
 *
 * Bestaansreden: Shopify-orders #5562-#5577 zijn maandenlang stilletjes niet
 * ingeladen doordat de oude webhook dood was zónder dat iemand het zag. Deze
 * banner moet zo'n stille storing nu meteen zichtbaar maken op het orders-overzicht.
 */
export function ShopifySyncStatusBanner() {
  const { data: laatsteRun } = useLatestShopifySyncRun()

  if (!laatsteRun) return null

  const gestartOp = new Date(laatsteRun.gestart_op)
  const verlopenMs = Date.now() - gestartOp.getTime()
  const isVerouderd = verlopenMs > STALE_DREMPEL_MS
  const isFout = laatsteRun.status === 'fout'

  if (!isFout && !isVerouderd) return null

  const tijdstip = gestartOp.toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' })

  return (
    <div className="mb-4 flex items-center gap-3 rounded-[var(--radius-sm)] border border-rose-200 bg-rose-50 px-4 py-3">
      <AlertTriangle size={18} className="shrink-0 text-rose-600" />
      <div className="flex-1 text-sm text-rose-800">
        <span className="font-semibold">Shopify-ordersync lijkt vast te lopen</span>{' '}
        — laatste poging: {tijdstip}
        {isFout && laatsteRun.foutmelding ? ` (fout: ${laatsteRun.foutmelding})` : ''}
        {!isFout && isVerouderd ? ` (verwacht elke ${VERWACHTE_INTERVAL_MINUTEN} minuten een nieuwe run)` : ''}
        . Nieuwe Shopify-orders komen mogelijk niet automatisch binnen — controleer de cron en edge function-logs.
      </div>
    </div>
  )
}
