import { Code128Barcode } from './code128-barcode'
import type { ZendingPrintRegel, ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

interface Props {
  zending: ZendingPrintSet
  regel: ZendingPrintRegel | null
  colliIndex: number
  colliTotal: number
  serviceCode: string | null
  /** SSCC uit `zending_colli` — null = geen colli-registratie, geen barcode. */
  sscc: string | null
}

function omschrijvingVoorRegel(regel: ZendingPrintRegel | null): string {
  const orderRegel = regel?.order_regels
  if (!orderRegel) return regel?.artikelnr ?? ''

  if (orderRegel.is_maatwerk) {
    const lengte = orderRegel.maatwerk_lengte_cm
    const breedte = orderRegel.maatwerk_breedte_cm
    const productNaam = orderRegel.producten?.omschrijving ?? orderRegel.omschrijving ?? ''
    const dim =
      lengte && breedte
        ? `${String(breedte).padStart(3, '0')}x${String(lengte).padStart(3, '0')} cm`
        : ''
    const kwaliteit = orderRegel.maatwerk_kwaliteit_code
      ? `, ${orderRegel.maatwerk_kwaliteit_code}`
      : ''
    const band = orderRegel.maatwerk_afwerking
      ? ` Band:${orderRegel.maatwerk_afwerking}`
      : ''
    return `MAATW. ${productNaam.toUpperCase()} ${dim}${kwaliteit}${band}`.trim()
  }

  const productNaam = orderRegel.producten?.omschrijving ?? orderRegel.omschrijving ?? ''
  const breedte = orderRegel.producten?.breedte_cm
  const lengte = orderRegel.producten?.lengte_cm
  const dim =
    breedte && lengte
      ? ` ${String(breedte).padStart(3, '0')}x${String(lengte).padStart(3, '0')} cm`
      : ''
  return `${productNaam}${dim}`.trim()
}

/**
 * DPD-stijl thermische sticker, 80×150mm — bedoeld voor de Zebra ZT230
 * via Windows-print-dialoog (PDF→ZPL via driver). Layout volgt het voorbeeld
 * dat Karpi vandaag op de DPD-portaal-stickers heeft.
 */
export function DpdShippingLabel({
  zending,
  regel,
  colliIndex,
  colliTotal,
  serviceCode,
  sscc,
}: Props) {
  const order = zending.orders
  const omschrijving = omschrijvingVoorRegel(regel)
  const land = zending.afl_land ?? 'NL'
  const barcodeValue = sscc ? `00${sscc}` : null // SSCC-AI(00) prefix
  const datum = formatLabelDatum(zending.verzenddatum ?? zending.created_at)
  const referentie = String(zending.id).padStart(7, '0')
  const serviceLabel = (serviceCode ?? 'SRV').toUpperCase()

  return (
    <div
      className="shipping-label dpd-label bg-white text-black"
      style={{ width: '80mm', height: '150mm' }}
    >
      <div className="flex h-full flex-col p-2 font-sans text-[8px] leading-tight">
        {/* HEADER: order/ref/product + Karpi afzender */}
        <div className="grid grid-cols-[1fr_28mm] gap-2 border-b border-black pb-1.5">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">Order: {order.order_nr}</span>
              {order.klant_referentie && (
                <span className="text-[7px]">Uw ref: {order.klant_referentie}</span>
              )}
            </div>
            <div className="mt-0.5 text-[8px] font-semibold leading-snug">
              {omschrijving}
            </div>
          </div>
          <div className="text-right text-[8px] leading-tight">
            <div>Karpi BV</div>
            <div>7122 LB Aalten</div>
          </div>
        </div>

        {/* GEADRESSEERDE — groot kader, hoofdblok */}
        <div className="my-2 grid grid-cols-[1fr_24mm] gap-2">
          <div className="border-2 border-black p-2 text-[10px] font-semibold uppercase leading-snug">
            <div>{zending.afl_naam ?? order.debiteuren?.naam ?? ''}</div>
            <div className="mt-2">{zending.afl_adres ?? ''}</div>
            <div>
              {zending.afl_postcode ?? ''} {zending.afl_plaats ?? ''}
              <span className="float-right">{land}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="border border-black px-2 py-1 text-center text-[9px] font-bold">
              {serviceLabel}
            </div>
            <div className="border border-black px-2 py-2 text-center text-[12px] font-bold">
              {colliIndex} VAN {colliTotal}
            </div>
          </div>
        </div>

        {/* BARCODE — neemt veel verticale ruimte */}
        <div className="border border-black p-2">
          {barcodeValue ? (
            <>
              <Code128Barcode value={barcodeValue} className="h-16 w-full" />
              <div className="mt-1 text-center font-mono text-[9px] tracking-wider">
                {barcodeValue}
              </div>
            </>
          ) : (
            <div className="py-6 text-center text-[9px]">Geen colli-barcode geregistreerd</div>
          )}
        </div>

        {/* FOOTER: datum + referentie */}
        <div className="mt-auto grid grid-cols-2 border border-t-0 border-black text-[9px] font-medium">
          <div className="border-r border-black px-2 py-1.5">{datum}</div>
          <div className="px-2 py-1.5 text-right">
            <span className="text-[7px] text-slate-500 uppercase tracking-wider">Referentie</span>{' '}
            {referentie}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatLabelDatum(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = String(d.getFullYear() % 100).padStart(2, '0')
  return `${dd}/${mm}/${yy}`
}
