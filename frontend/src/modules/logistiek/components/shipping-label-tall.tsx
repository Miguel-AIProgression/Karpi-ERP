import { labelBarcode } from '@/lib/logistiek/labelbarcode'
import { Code128Barcode } from './code128-barcode'
import {
  labelDatumKort,
  labelReferentie,
  productMaat,
  productNamen,
} from '@/modules/logistiek/lib/shipping-label-data'
import type { ShippingLabelProps } from './shipping-label'

// Staand verzendlabel voor 3"×6"-rollen (76,2×152,4mm) — de fysieke rol in de
// Zebra ZT231 sinds juni 2026. Zelfde informatie als het compacte label, maar
// gestapeld en met grotere fonts/barcode zodat chauffeur en scanner het van
// afstand kunnen lezen. Alles puur #000: grijstinten worden op een thermische
// printer geditherd en ogen wazig.
//
// Rij-hoogtes in mm — som = hoogteMm zodat de print-engine niets kan opbreken.
const RIJ_AFZENDER_MM = 16
const RIJ_ORDER_MM = 15
const RIJ_ADRES_MM = 58
const RIJ_COLLI_MM = 14

// 3 dots per Code128-module op 203dpi (0.125mm/dot) → balken op hele dots.
const BARCODE_MODULE_MM = 0.375

export function ShippingLabelTall({
  zending,
  regel,
  colliIndex,
  colliTotal,
  vervoerderNaam,
  sscc,
  omschrijvingSnapshot,
  klantOmschrijvingSnapshot,
  breedteMm,
  hoogteMm,
}: ShippingLabelProps & { breedteMm: number; hoogteMm: number }) {
  const order = zending.orders
  const snapshot = { omschrijvingSnapshot, klantOmschrijvingSnapshot }
  const namen = productNamen(regel, snapshot)
  const toonKarpi = namen.karpiNaam && namen.karpiNaam !== namen.klantNaam
  const maat = productMaat(regel, snapshot)
  const land = zending.afl_land ?? 'NL'
  const barcodeValue = labelBarcode(sscc)
  const ref = labelReferentie(order)

  const rijBarcodeMm = hoogteMm - RIJ_AFZENDER_MM - RIJ_ORDER_MM - RIJ_ADRES_MM - RIJ_COLLI_MM

  const rijBase: React.CSSProperties = {
    boxSizing: 'border-box',
    overflow: 'hidden',
    borderBottom: '1px solid #000',
  }

  return (
    <div
      className="shipping-label bg-white"
      data-shipping-label-v="4-tall"
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
        color: '#000',
      }}
    >
      {/* Rij 1 — afzender + vervoerder-badge */}
      <div
        style={{
          ...rijBase,
          height: `${RIJ_AFZENDER_MM}mm`,
          display: 'flex',
          alignItems: 'stretch',
        }}
      >
        <div style={{ flex: '1 1 auto', padding: '1.5mm 2mm', lineHeight: 1.25 }}>
          <div style={{ fontSize: '12px', fontWeight: 700 }}>Karpi BV</div>
          {zending.track_trace ? (
            <div style={{ fontSize: '11px', fontWeight: 700, fontFamily: 'monospace' }}>
              {zending.track_trace}
            </div>
          ) : (
            <div style={{ fontSize: '10px' }}>7122 LB Aalten</div>
          )}
          <div style={{ fontSize: '9px' }}>Z {zending.zending_nr}</div>
        </div>
        <div
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            padding: '1.5mm 2mm',
          }}
        >
          <div
            style={{
              border: '2.5px solid #000',
              padding: '1mm 2.5mm',
              fontSize: '15px',
              fontWeight: 700,
              lineHeight: 1.1,
              maxWidth: '26mm',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {vervoerderNaam}
          </div>
        </div>
      </div>

      {/* Rij 2 — order/referentie + product */}
      <div style={{ ...rijBase, height: `${RIJ_ORDER_MM}mm`, padding: '1mm 2mm', lineHeight: 1.2 }}>
        <div style={{ fontSize: '10px' }}>
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
            fontSize: '12px',
            fontWeight: 700,
            textTransform: 'uppercase',
            marginTop: '0.5mm',
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
              fontSize: '9px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {namen.karpiNaam}
          </div>
        )}
      </div>

      {/* Rij 3 — afleveradres, het hoofd-element van het label */}
      <div style={{ ...rijBase, height: `${RIJ_ADRES_MM}mm`, padding: '2mm' }}>
        <div
          style={{
            height: '100%',
            width: '100%',
            border: '3px solid #000',
            padding: '3mm',
            fontSize: '16px',
            fontWeight: 700,
            textTransform: 'uppercase',
            lineHeight: 1.45,
            boxSizing: 'border-box',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {zending.afl_naam ?? order.debiteuren?.naam ?? ''}
          </div>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {zending.afl_adres ?? ''}
          </div>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {zending.afl_postcode ?? ''} {zending.afl_plaats ?? ''}
          </div>
          <div style={{ fontSize: '20px' }}>{land}</div>
        </div>
      </div>

      {/* Rij 4 — colli-telling + referentie */}
      <div
        style={{
          ...rijBase,
          height: `${RIJ_COLLI_MM}mm`,
          display: 'flex',
          alignItems: 'stretch',
        }}
      >
        <div
          style={{
            flex: '1 1 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRight: '1px solid #000',
            fontSize: '20px',
            fontWeight: 700,
          }}
        >
          {colliIndex} VAN {colliTotal}
        </div>
        <div
          style={{
            flex: '0 0 32mm',
            padding: '1.5mm 2mm',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              fontSize: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              lineHeight: 1.2,
            }}
          >
            Referentie
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '2mm',
              fontSize: '11px',
              fontFamily: 'monospace',
              lineHeight: 1.2,
            }}
          >
            <span>{labelDatumKort(zending)}</span>
            <span>{ref}</span>
          </div>
        </div>
      </div>

      {/* Rij 5 — SSCC-barcode, groot en dot-aligned */}
      <div
        style={{
          height: `${rijBarcodeMm}mm`,
          boxSizing: 'border-box',
          overflow: 'hidden',
          padding: '2mm',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {barcodeValue ? (
          <>
            <Code128Barcode
              value={barcodeValue}
              moduleMm={BARCODE_MODULE_MM}
              style={{ height: `${Math.max(rijBarcodeMm - 12, 16)}mm` }}
            />
            <div
              style={{
                marginTop: '1.5mm',
                textAlign: 'center',
                fontFamily: 'monospace',
                fontSize: '12px',
                letterSpacing: '0.1em',
                lineHeight: 1,
              }}
            >
              {barcodeValue}
            </div>
          </>
        ) : (
          <div style={{ fontSize: '10px', textAlign: 'center' }}>
            Geen colli-barcode geregistreerd
          </div>
        )}
      </div>
    </div>
  )
}
