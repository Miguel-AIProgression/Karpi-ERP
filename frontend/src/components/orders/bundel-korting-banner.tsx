import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import { useBundelInfoVoorFactuur } from '@/modules/facturatie'
import { formatCurrency } from '@/lib/utils/formatters'

interface BundelKortingBannerProps {
  orderId: number
  factuurId: number
  factuurNr: string
}

export function BundelKortingBanner({
  orderId,
  factuurId,
  factuurNr,
}: BundelKortingBannerProps) {
  const { data: info } = useBundelInfoVoorFactuur(factuurId)
  if (!info || !info.isBundel) return null

  const andere = info.andereOrders.filter((o) => o.id !== orderId)
  // Edge-case: als de huidige order de enige is in `andereOrders` (data-inconsistentie),
  // hebben we niets te tonen. Beter niets dan "Verzonden samen met . Verzendkosten…".
  if (andere.length === 0) return null

  const titel = info.heeftDrempelKorting ? 'Bundel-korting toegepast' : 'Gebundelde zending'
  const kostenLabel = formatCurrency(info.verzendkostenBedrag)
  const factuurLink = (
    <Link
      to={`/facturatie/${factuurId}`}
      className="font-mono text-terracotta-500 hover:underline"
    >
      {factuurNr}
    </Link>
  )

  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/60 px-3 py-2 mt-2 text-xs text-slate-700">
      <div className="flex items-center gap-1 font-medium text-emerald-700 mb-1">
        <Package size={12} aria-hidden />
        {titel}
      </div>
      <div className="text-slate-600 leading-relaxed">
        Verzonden samen met{' '}
        {andere.map((o, i) => (
          <span key={o.id}>
            {i > 0 && ', '}
            <Link
              to={`/orders/${o.id}`}
              className="font-mono text-terracotta-500 hover:underline"
            >
              {o.nr}
            </Link>
          </span>
        ))}
        .{' '}
        {info.heeftDrempelKorting ? (
          <>
            Verzendkosten ({kostenLabel}) weggestreept op {factuurLink}.
          </>
        ) : (
          <>
            1× verzendkosten i.p.v. {andere.length + 1}× — bespaart {formatCurrency(andere.length * info.verzendkostenBedrag)} op {factuurLink}.
          </>
        )}
      </div>
    </div>
  )
}
