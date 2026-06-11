import type { OrderDetail } from '@/lib/supabase/queries/orders'

interface OrderAddressesProps {
  order: OrderDetail
}

export function OrderAddresses({ order }: OrderAddressesProps) {
  const hasFactuur = order.fact_naam || order.fact_adres
  const hasAflever = order.afl_naam || order.afl_adres

  if (!hasFactuur && !hasAflever && !order.afhalen) return null

  return (
    <div className="space-y-3 mb-6">
      {order.afhalen && (
        <div className="bg-amber-50 border border-amber-200 rounded-[var(--radius-sm)] p-3 text-sm text-amber-800 flex items-center gap-2">
          <span className="inline-block px-2 py-0.5 rounded bg-amber-200 text-amber-900 text-xs font-medium">
            Afhalen
          </span>
          Klant haalt deze order zelf op bij Karpi — geen verzending.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
            {order.fact_email && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-sm">
                <span className="text-slate-400 block mb-0.5">Factuur per e-mail naar</span>
                <span className="text-slate-700">{order.fact_email}</span>
              </div>
            )}
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
              telefoon={order.afl_telefoon}
            />
            {!order.afhalen && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-sm">
                <span className="text-slate-400 block mb-0.5">Track &amp; trace naar</span>
                {order.afl_email ? (
                  <span className="text-slate-700">{order.afl_email}</span>
                ) : (
                  <span className="text-amber-600">
                    Geen e-mailadres ingevuld — klant ontvangt geen track &amp; trace van de vervoerder
                  </span>
                )}
              </div>
            )}
            {order.opmerkingen && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-sm text-slate-600">
                <span className="text-slate-400 block mb-0.5">Opmerking</span>
                {order.opmerkingen}
              </div>
            )}
          </div>
        )}
      </div>
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
  telefoon?: string | null
}) {
  return (
    <div className="text-sm leading-relaxed">
      {props.naam && <p className="font-medium">{props.naam}</p>}
      {props.naam2 && <p className="text-slate-500">{props.naam2}</p>}
      {props.adres && <p>{props.adres}</p>}
      <p>{[props.postcode, props.plaats].filter(Boolean).join(' ')}</p>
      {props.land && props.land !== 'NL' && <p>{props.land}</p>}
      {props.telefoon && <p className="text-slate-500 mt-1">{props.telefoon}</p>}
    </div>
  )
}
