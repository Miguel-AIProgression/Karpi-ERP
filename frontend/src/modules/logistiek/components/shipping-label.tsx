import { Code128Barcode } from './code128-barcode'
import type { ZendingPrintRegel, ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

interface ShippingLabelProps {
  zending: ZendingPrintSet
  regel: ZendingPrintRegel | null
  colliIndex: number
  colliTotal: number
  vervoerderNaam: string
  sscc: string
}

function productOmschrijving(regel: ZendingPrintRegel | null): string {
  const orderRegel = regel?.order_regels
  if (!orderRegel) return regel?.artikelnr ?? 'Artikel'
  return [orderRegel.omschrijving, orderRegel.omschrijving_2].filter(Boolean).join(' ')
}

function productMaat(regel: ZendingPrintRegel | null): string {
  const orderRegel = regel?.order_regels
  if (!orderRegel?.is_maatwerk) return ''
  const lengte = orderRegel.maatwerk_lengte_cm
  const breedte = orderRegel.maatwerk_breedte_cm
  if (!lengte || !breedte) return ''
  return `${breedte}x${lengte} cm`
}

export function ShippingLabel({
  zending,
  regel,
  colliIndex,
  colliTotal,
  vervoerderNaam,
  sscc,
}: ShippingLabelProps) {
  const order = zending.orders
  const product = productOmschrijving(regel)
  const maat = productMaat(regel)
  const land = zending.afl_land ?? 'NL'
  const barcodeValue = `00${sscc}`

  return (
    <div className="shipping-label bg-white border border-slate-300 text-slate-950" style={{ width: '105mm', height: '60mm' }}>
      <div className="grid h-full grid-cols-[1fr_38mm] grid-rows-[16mm_1fr_13mm] text-[9px] leading-tight">
        <div className="border-b border-r border-slate-900 p-1.5">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div>
                <span className="font-semibold">Order:</span> {order.order_nr}
              </div>
              {order.klant_referentie && (
                <div>
                  <span className="font-semibold">Uw ref:</span> {order.klant_referentie}
                </div>
              )}
            </div>
            <div className="font-mono text-[8px]">{regel?.artikelnr ?? ''}</div>
          </div>
          <div className="mt-1 line-clamp-2 text-[10px] font-semibold">
            {product}
            {maat ? ` - ${maat}` : ''}
          </div>
        </div>

        <div className="border-b border-slate-900 p-1.5">
          <div className="font-semibold">Karpi BV</div>
          <div>7122 LB Aalten</div>
          <div className="mt-3 text-right text-[8px]">Zending {zending.zending_nr}</div>
        </div>

        <div className="border-r border-slate-900 p-1.5">
          <div className="mb-1 inline-block border border-slate-900 px-1.5 py-0.5 text-[8px] font-semibold">
            AFLEVERADRES
          </div>
          <div className="border-2 border-slate-900 p-1.5 text-[10px] font-semibold uppercase">
            <div>{zending.afl_naam ?? order.debiteuren?.naam ?? ''}</div>
            <div>{zending.afl_adres ?? ''}</div>
            <div>
              {zending.afl_postcode ?? ''} {zending.afl_plaats ?? ''}
              <span className="float-right">{land}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between p-1.5">
          <div className="self-start border border-slate-900 px-1.5 py-0.5 text-[9px] font-semibold">
            {vervoerderNaam}
          </div>
          <div className="border-2 border-slate-900 p-1 text-center text-[12px] font-bold">
            {colliIndex} VAN {colliTotal}
          </div>
        </div>

        <div className="border-r border-t border-slate-900 px-1.5 py-1">
          <Code128Barcode value={barcodeValue} className="h-8 w-full" />
          <div className="mt-0.5 text-center font-mono text-[8px] tracking-wide">{barcodeValue}</div>
        </div>

        <div className="grid grid-cols-2 border-t border-slate-900 text-[8px]">
          <div className="border-r border-slate-900 p-1">{new Date().toLocaleDateString('nl-NL')}</div>
          <div className="p-1 text-right">{String(order.oud_order_nr ?? order.id).padStart(6, '0')}</div>
        </div>
      </div>
    </div>
  )
}
