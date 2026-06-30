import { useQuery } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import type { OrderDetail } from '@/lib/supabase/queries/orders'
import { fetchBedrijfsConfig } from '@/lib/supabase/queries/bedrijfsconfig'
import {
  DROPSHIP_EMAIL_MELDING,
  type DropshipEmailProbleem,
} from '@/lib/orders/dropship-email'

interface OrderAddressesProps {
  order: OrderDetail
  /** Alleen gevuld bij dropshipment-orders: toets van het T&T-adres (dropship-email.ts). */
  dropshipEmailProbleem?: DropshipEmailProbleem | null
}

export function OrderAddresses({ order, dropshipEmailProbleem }: OrderAddressesProps) {
  const hasFactuur = order.fact_naam || order.fact_adres
  const hasAflever = !order.afhalen && (order.afl_naam || order.afl_adres)

  const { data: bedrijf } = useQuery({
    queryKey: ['bedrijfsgegevens'],
    queryFn: fetchBedrijfsConfig,
    staleTime: 10 * 60 * 1000,
    enabled: !!order.afhalen,
  })

  if (!hasFactuur && !hasAflever && !order.afhalen) return null

  return (
    <div className="space-y-3 mb-6">
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
            <div className="mt-3 pt-3 border-t border-slate-100 text-sm">
              <span className="text-slate-400 block mb-0.5">Factuur per e-mail naar</span>
              {order.fact_email ? (
                <span className="text-slate-700">{order.fact_email}</span>
              ) : order.klant_email ? (
                <span className="text-slate-700">
                  {order.klant_email}
                  <span className="ml-1.5 text-xs text-slate-400">(klantprofiel)</span>
                </span>
              ) : (
                <span className="text-amber-600">Geen factuur-e-mailadres bekend</span>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 text-sm">
              <span className="text-slate-400 block mb-0.5">Pakbon per e-mail naar</span>
              {order.klant_email_pakbon ? (
                <span className="text-slate-700">{order.klant_email_pakbon}</span>
              ) : order.fact_email || order.klant_email ? (
                <span className="text-slate-700">
                  {order.fact_email || order.klant_email}
                  <span className="ml-1.5 text-xs text-slate-400">· zelfde als factuur</span>
                </span>
              ) : (
                <span className="text-amber-600">Geen pakbon-e-mailadres bekend</span>
              )}
            </div>
          </div>
        )}

        {order.afhalen ? (
          <div className="bg-amber-50 rounded-[var(--radius)] border border-amber-200 p-5">
            <h3 className="text-sm font-medium text-amber-700 mb-2 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Afhaallocatie
            </h3>
            <div className="text-sm leading-relaxed text-amber-900">
              {bedrijf ? (
                <>
                  <p className="font-medium">{bedrijf.bedrijfsnaam}</p>
                  <p>{bedrijf.adres}</p>
                  <p>{bedrijf.postcode} {bedrijf.plaats}</p>
                  {bedrijf.telefoon && (
                    <p className="text-amber-700 mt-1">{bedrijf.telefoon}</p>
                  )}
                </>
              ) : (
                <p className="text-amber-700">Klant haalt op bij Karpi BV</p>
              )}
            </div>
            <p className="mt-2 pt-2 border-t border-amber-200 text-xs text-amber-700">
              Geen verzending — klant haalt deze order zelf op.
            </p>
          </div>
        ) : hasAflever ? (
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
            <div className="mt-3 pt-3 border-t border-slate-100 text-sm">
              <span className="text-slate-400 block mb-0.5">Track &amp; trace naar</span>
              {order.afl_email ? (
                <span className="text-slate-700">{order.afl_email}</span>
              ) : dropshipEmailProbleem === 'ontbreekt' ? (
                <span className="text-amber-600">{DROPSHIP_EMAIL_MELDING.ontbreekt}</span>
              ) : (
                <span className="text-amber-600">
                  Geen e-mailadres ingevuld — klant ontvangt geen track &amp; trace van de vervoerder
                </span>
              )}
              {(dropshipEmailProbleem === 'gelijk_aan_factuur' ||
                dropshipEmailProbleem === 'gelijk_aan_debiteur') && (
                <p className="mt-1 text-rose-600 text-xs">
                  {DROPSHIP_EMAIL_MELDING[dropshipEmailProbleem]} Pas aan via order bewerken.
                </p>
              )}
            </div>
            {order.opmerkingen && (
              <div className="mt-3 pt-3 border-t border-slate-100 text-sm text-slate-600">
                <span className="text-slate-400 block mb-0.5">Opmerking</span>
                {order.opmerkingen}
              </div>
            )}
          </div>
        ) : null}
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
