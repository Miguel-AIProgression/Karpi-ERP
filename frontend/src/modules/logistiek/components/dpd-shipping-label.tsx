import { labelBarcode } from '@/lib/logistiek/labelbarcode'
import { externReferentie } from '@/lib/orders/referentie'
import { Code128Barcode } from './code128-barcode'
import {
  klanteigenReferentie,
  labelDatumKort,
  labelProductRegels,
  labelReferentie,
} from '@/modules/logistiek/lib/shipping-label-data'
import type { ZendingPrintRegel, ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

interface Props {
  zending: ZendingPrintSet
  regel: ZendingPrintRegel | null
  colliIndex: number
  colliTotal: number
  serviceCode: string | null
  /** SSCC uit `zending_colli` — null = geen colli-registratie, geen barcode. */
  sscc: string | null
  /** Mig 209/388: bevroren omschrijving-snapshots uit `zending_colli` — single
   * source, gelijk aan label/pakbon/vervoerder. null → val terug op live `regel`. */
  omschrijvingSnapshot: string | null
  klantOmschrijvingSnapshot: string | null
  /** Mig 419: klant-eigennaam voor de kwaliteit. null/leeg → geen "Uw referentie"-regel. */
  klanteigenNaamSnapshot: string | null
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
  omschrijvingSnapshot,
  klantOmschrijvingSnapshot,
  klanteigenNaamSnapshot,
}: Props) {
  const order = zending.orders
  // Single source (mig 388): één omschrijving-bron, gelijk aan label/pakbon/
  // vervoerder — geen eigen DPD-afleiding meer. Vaste-maat krijgt sinds
  // 2026-06-18 de kwaliteitsnaam + maten groot, Karpi-code klein.
  const productRegels = labelProductRegels(regel, { omschrijvingSnapshot, klantOmschrijvingSnapshot })
  const uwReferentie = klanteigenReferentie(klanteigenNaamSnapshot)
  const land = zending.afl_land ?? 'NL'
  const barcodeValue = labelBarcode(sscc) // AI(00)+SSCC, gedeelde seam
  const datum = labelDatumKort(zending)
  const referentie = labelReferentie(order)
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
              {externReferentie(order.klant_referentie) && (
                <span className="text-[7px]">Uw ref: {externReferentie(order.klant_referentie)}</span>
              )}
            </div>
            <div className="mt-0.5 text-[8px] font-semibold uppercase leading-snug">
              {productRegels.groot}
            </div>
            {uwReferentie && (
              <div className="text-[7px] font-semibold leading-snug">Uw referentie: {uwReferentie}</div>
            )}
            {productRegels.klein && (
              <div className="text-[7px] leading-snug">{productRegels.klein}</div>
            )}
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
