import { Link } from 'react-router-dom'
import { MapPinOff } from 'lucide-react'
import { useEdiAfleveradresOngekoppeld } from '@/modules/edi/hooks/use-edi'

/**
 * Waarschuwingsbanner: EDI-orders waarvan de aflever-GLN geen vestiging matcht.
 *
 * `create_edi_order` (mig 357) valt bij een onbekende vestiging-GLN STIL terug op
 * het debiteur-hoofdadres — de order is dan wél aangemaakt (de "Te koppelen"-vangnet,
 * mig 306, vuurt alleen als de hele order ongematcht blijft), maar het label gaat naar
 * het verkeerde adres. Aanleiding: ORD-2026-0892 (XXXLutz Gottfrieding → Würzburg-HQ),
 * meerdere stille gevallen over partners. Bron: view `edi_orders_afleveradres_ongekoppeld`
 * (mig 534). Onzichtbaar als er niets ongekoppeld is.
 *
 * Koppel de juiste vestiging-GLN aan het afleveradres (afleveradressen.gln_afleveradres)
 * zodat toekomstige orders auto-matchen en de order van deze lijst verdwijnt.
 */
export function EdiAfleveradresOngekoppeldBanner() {
  const { data: rows = [] } = useEdiAfleveradresOngekoppeld()

  if (rows.length === 0) return null

  return (
    <div className="mb-4 rounded-[var(--radius-sm)] border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        <MapPinOff size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="flex-1 text-sm text-amber-800">
          <span className="font-semibold">
            {rows.length} EDI-{rows.length === 1 ? 'order' : 'orders'} met niet-gekoppeld afleveradres
          </span>{' '}
          — de aflever-GLN matcht geen vestiging, dus het afleveradres viel terug op het
          hoofdadres. Controleer het adres en koppel de juiste vestiging-GLN.
          <div className="mt-2 flex flex-wrap gap-2">
            {rows.map((r) => (
              <Link
                key={r.order_id}
                to={`/orders/${r.order_id}`}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100"
              >
                {r.order_nr}
                {r.afl_plaats ? <span className="text-amber-600">· {r.afl_plaats}</span> : null}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
