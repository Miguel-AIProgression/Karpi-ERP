import type { OrderDetail } from '@/lib/supabase/queries/orders'

interface OrderAddressesProps {
  order: OrderDetail
}

export function OrderAddresses({ order }: OrderAddressesProps) {
  const hasFactuur = order.fact_naam || order.fact_adres
  const hasAflever = order.afl_naam || order.afl_adres

  if (!hasFactuur && !hasAflever) return null

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
      {hasFactuur && (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-500 mb-2">Factuuradres</h3>
          <AddressBlock
            naam={order.fact_naam}
            adres={order.fact_adres}
            postcode={order.fact_postcode}
            plaats={order.fact_plaats}
            land={order.fact_land}
          />
        </div>
      )}
      {hasAflever && (
        <div className="bg-white rounded-[var(--radius)] border border-slate-200 p-5">
          <h3 className="text-sm font-medium text-slate-500 mb-2">Afleveradres</h3>
          <AddressBlock
            naam={order.afl_naam}
            naam2={order.afl_naam_2}
            adres={order.afl_adres}
            postcode={order.afl_postcode}
            plaats={order.afl_plaats}
            land={order.afl_land}
          />
        </div>
      )}
    </div>
  )
}

function AddressBlock(props: {
  naam?: string | null
  naam2?: string | null
  adres?: string | null
  postcode?: string | null
  plaats?: string | null
  land?: string | null
}) {
  return (
    <div className="text-sm leading-relaxed">
      {props.naam && <p className="font-medium">{props.naam}</p>}
      {props.naam2 && <p className="text-slate-500">{props.naam2}</p>}
      {props.adres && <p>{props.adres}</p>}
      <p>
        {[props.postcode, props.plaats].filter(Boolean).join(' ')}
      </p>
      {props.land && props.land !== 'NL' && <p>{props.land}</p>}
    </div>
  )
}
