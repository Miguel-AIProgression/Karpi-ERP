import { Code128Barcode } from './code128-barcode'
import {
  DEFAULT_LABEL_BREEDTE_MM,
  DEFAULT_LABEL_HOOGTE_MM,
  type LabelFormaat,
} from '@/modules/logistiek/lib/printset'
import type { ZendingPrintRegel, ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

interface ShippingLabelProps {
  zending: ZendingPrintSet
  regel: ZendingPrintRegel | null
  colliIndex: number
  colliTotal: number
  vervoerderNaam: string
  sscc: string
  labelFormaat?: LabelFormaat
}

interface RegelNamen {
  klantNaam: string
  karpiNaam: string | null
}

function productNamen(regel: ZendingPrintRegel | null): RegelNamen {
  const orderRegel = regel?.order_regels
  if (!orderRegel) {
    return { klantNaam: regel?.artikelnr ?? 'Artikel', karpiNaam: null }
  }
  const klantNaam = [orderRegel.omschrijving, orderRegel.omschrijving_2].filter(Boolean).join(' ')
  const karpiNaam = orderRegel.producten?.omschrijving ?? null
  return { klantNaam: klantNaam || (regel?.artikelnr ?? 'Artikel'), karpiNaam }
}

function productMaat(regel: ZendingPrintRegel | null): string {
  const orderRegel = regel?.order_regels
  if (!orderRegel?.is_maatwerk) return ''
  const lengte = orderRegel.maatwerk_lengte_cm
  const breedte = orderRegel.maatwerk_breedte_cm
  if (!lengte || !breedte) return ''
  return `${breedte}x${lengte} cm`
}

function datumKort(): string {
  const now = new Date()
  const dd = String(now.getDate()).padStart(2, '0')
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const yy = String(now.getFullYear()).slice(-2)
  return `${dd}/${mm}/${yy}`
}

// Cell-afmetingen in mm — alles wordt absoluut gepositioneerd zodat de
// print-engine het label NIET over twee pagina's kan opbreken. De som van de
// rij-hoogtes is precies hoogteMm; idem voor de kolommen.
const COL_RECHTS_MM = 22
const RIJ1_MM = 10
const RIJ3_MM = 13

export function ShippingLabel({
  zending,
  regel,
  colliIndex,
  colliTotal,
  vervoerderNaam,
  sscc,
  labelFormaat,
}: ShippingLabelProps) {
  const order = zending.orders
  const namen = productNamen(regel)
  const toonKarpi = namen.karpiNaam && namen.karpiNaam !== namen.klantNaam
  const maat = productMaat(regel)
  const land = zending.afl_land ?? 'NL'
  const barcodeValue = `00${sscc}`
  const ref = String(order.oud_order_nr ?? order.id).padStart(6, '0')

  // 0.5mm aftrekken voor sub-pixel rounding-marge bij printen.
  const breedteMm = (labelFormaat?.breedteMm ?? DEFAULT_LABEL_BREEDTE_MM) - 0.5
  const hoogteMm = (labelFormaat?.hoogteMm ?? DEFAULT_LABEL_HOOGTE_MM) - 0.5
  const colLinksMm = breedteMm - COL_RECHTS_MM
  const rij2Mm = hoogteMm - RIJ1_MM - RIJ3_MM

  const cellBase: React.CSSProperties = {
    position: 'absolute',
    boxSizing: 'border-box',
    overflow: 'hidden',
  }

  return (
    <div
      className="shipping-label bg-white text-slate-950"
      data-shipping-label-v="3-absolute"
      style={{
        width: `${breedteMm}mm`,
        height: `${hoogteMm}mm`,
        maxWidth: `${breedteMm}mm`,
        maxHeight: `${hoogteMm}mm`,
        position: 'relative',
        boxSizing: 'border-box',
        overflow: 'hidden',
        display: 'block',
        contain: 'layout paint size',
      }}
    >
      {/* Rij 1 — links: order/uw-ref + productnaam */}
      <div
        style={{
          ...cellBase,
          top: 0,
          left: 0,
          width: `${colLinksMm}mm`,
          height: `${RIJ1_MM}mm`,
          borderRight: '1px solid #000',
          borderBottom: '1px solid #000',
          padding: '0.5mm 1mm',
        }}
      >
        <div style={{ fontSize: '6px', lineHeight: 1.1 }}>
          <strong>Order:</strong> {order.order_nr}
          {order.klant_referentie && (
            <>
              {' '}
              <strong>Ref:</strong> {order.klant_referentie}
            </>
          )}
        </div>
        <div
          style={{
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            lineHeight: 1.1,
            marginTop: '0.3mm',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {namen.klantNaam}
          {maat ? ` - ${maat}` : ''}
        </div>
        {toonKarpi && (
          <div
            style={{
              fontSize: '6px',
              color: '#475569',
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {namen.karpiNaam}
          </div>
        )}
      </div>

      {/* Rij 1 — rechts: Karpi BV afzender */}
      <div
        style={{
          ...cellBase,
          top: 0,
          right: 0,
          width: `${COL_RECHTS_MM}mm`,
          height: `${RIJ1_MM}mm`,
          borderBottom: '1px solid #000',
          padding: '0.5mm 1mm',
          fontSize: '6px',
          lineHeight: 1.15,
        }}
      >
        <div style={{ fontWeight: 600 }}>Karpi BV</div>
        <div>7122 LB Aalten</div>
        <div style={{ fontSize: '5px', color: '#475569' }}>Z {zending.zending_nr}</div>
      </div>

      {/* Rij 2 — links: afleveradres met dik kader */}
      <div
        style={{
          ...cellBase,
          top: `${RIJ1_MM}mm`,
          left: 0,
          width: `${colLinksMm}mm`,
          height: `${rij2Mm}mm`,
          borderRight: '1px solid #000',
          padding: '1mm',
        }}
      >
        <div
          style={{
            height: '100%',
            width: '100%',
            border: '2px solid #000',
            padding: '1mm 1.5mm',
            fontSize: '8px',
            fontWeight: 700,
            textTransform: 'uppercase',
            lineHeight: 1.25,
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {zending.afl_naam ?? order.debiteuren?.naam ?? ''}
          </div>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {zending.afl_adres ?? ''}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '2mm' }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {zending.afl_postcode ?? ''} {zending.afl_plaats ?? ''}
            </span>
            <span>{land}</span>
          </div>
        </div>
      </div>

      {/* Rij 2 — rechts: vervoerder-badge gecentreerd */}
      <div
        style={{
          ...cellBase,
          top: `${RIJ1_MM}mm`,
          right: 0,
          width: `${COL_RECHTS_MM}mm`,
          height: `${rij2Mm}mm`,
          padding: '1mm',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            border: '2px solid #000',
            padding: '0.5mm 1mm',
            fontSize: '8px',
            fontWeight: 700,
            textAlign: 'center',
            lineHeight: 1.1,
            maxWidth: '100%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {vervoerderNaam}
        </div>
      </div>

      {/* Rij 3 — links: barcode + cijfers */}
      <div
        style={{
          ...cellBase,
          bottom: 0,
          left: 0,
          width: `${colLinksMm}mm`,
          height: `${RIJ3_MM}mm`,
          borderRight: '1px solid #000',
          borderTop: '1px solid #000',
          padding: '0.5mm 1mm',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <Code128Barcode value={barcodeValue} className="w-full" style={{ height: '8mm' }} />
        <div
          style={{
            marginTop: '0.3mm',
            textAlign: 'center',
            fontFamily: 'monospace',
            fontSize: '6px',
            letterSpacing: '0.05em',
            lineHeight: 1,
          }}
        >
          {barcodeValue}
        </div>
      </div>

      {/* Rij 3 — rechts: colli + REFERENTIE + datum/ref */}
      <div
        style={{
          ...cellBase,
          bottom: 0,
          right: 0,
          width: `${COL_RECHTS_MM}mm`,
          height: `${RIJ3_MM}mm`,
          borderTop: '1px solid #000',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            flex: '1 1 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid #000',
            fontSize: '10px',
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {colliIndex} VAN {colliTotal}
        </div>
        <div style={{ padding: '0.3mm 1mm' }}>
          <div
            style={{
              fontSize: '5px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: '#64748b',
              lineHeight: 1,
            }}
          >
            Referentie
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '1mm',
              fontSize: '7px',
              fontFamily: 'monospace',
              lineHeight: 1.1,
            }}
          >
            <span>{datumKort()}</span>
            <span>{ref}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
