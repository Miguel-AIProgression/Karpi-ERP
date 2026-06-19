import { labelBarcode } from '@/lib/logistiek/labelbarcode'
import { externReferentie } from '@/lib/orders/referentie'
import { hstDepotVoorPostcode } from '@/modules/logistiek/lib/hst-depot'
import { Code128Barcode } from './code128-barcode'
import {
  klanteigenReferentie,
  labelDatumKort,
  labelProductRegels,
  labelReferentie,
} from '@/modules/logistiek/lib/shipping-label-data'
import {
  DEFAULT_LABEL_BREEDTE_MM,
  DEFAULT_LABEL_HOOGTE_MM,
  type LabelFormaat,
} from '@/modules/logistiek/lib/printset'
import type { ZendingPrintRegel, ZendingPrintSet } from '@/modules/logistiek/queries/zendingen'

export interface ShippingLabelProps {
  zending: ZendingPrintSet
  regel: ZendingPrintRegel | null
  colliIndex: number
  colliTotal: number
  vervoerderNaam: string
  /** SSCC uit `zending_colli` (= de bij de vervoerder aangemelde barcode).
   * null → label rendert zonder barcode; er mag nooit een niet-aangemelde
   * barcode geprint worden. */
  sscc: string | null
  /** Mig 209/388: bevroren omschrijving-snapshots uit `zending_colli` — single
   * source, gelijk aan wat de vervoerder krijgt. null → val terug op live `regel`. */
  omschrijvingSnapshot: string | null
  klantOmschrijvingSnapshot: string | null
  /** Mig 419: klant-eigennaam voor de kwaliteit (`zending_colli.klanteigen_naam_snapshot`).
   * null/leeg → geen "Uw referentie"-regel. */
  klanteigenNaamSnapshot: string | null
  labelFormaat?: LabelFormaat
}

// Basis-celafmetingen in mm bij het 76,2×50,8-ONTWERP — alle absolute posities,
// rijen en fonts zijn op die maat getuned. Grotere labels (152,4×76,2 liggend)
// schalen daar proportioneel vanaf via factor s.
const COL_RECHTS_MM = 22
const RIJ1_MM = 10
const RIJ3_MM = 13

// ONTWERP-BASIS (≠ het default-formaat!). De schaal-math hieronder rekent t.o.v.
// dit 76,2×50,8-ontwerp; het DEFAULT_LABEL_*_MM-formaat (152,4×76,2, de fallback
// voor carriers zonder eigen `label_*_mm`-rij) mag dit NIET verschuiven. Die twee
// scheiden voorkomt de regressie van 18-06: de default op 152,4×76,2 zetten maakte
// s=1,0 i.p.v. 1,5 (alles uitgerekt) en halveerde de badge-kolom ("Rhen…").
const BASIS_BREEDTE_MM = 76.2
const BASIS_HOOGTE_MM = 50.8

/**
 * Het canonieke verzendlabel: één liggende layout voor álle vervoerders. De
 * vroegere staande (`ShippingLabelTall`) en DPD-varianten zijn verwijderd —
 * een tweede labelvorm rechtvaardigt pas dán een echte tweede adapter (twee
 * adapters = een echte seam). Het enige per-vervoerder-verschil is het
 * HST-depotnummer onder de badge (gelokaliseerd, geen registry nodig).
 * Het formaat komt uit `labelFormaat` (override-seam) of de default.
 */
export function ShippingLabel({
  zending,
  regel,
  colliIndex,
  colliTotal,
  vervoerderNaam,
  sscc,
  omschrijvingSnapshot,
  klantOmschrijvingSnapshot,
  klanteigenNaamSnapshot,
  labelFormaat,
}: ShippingLabelProps) {
  // 0.5mm aftrekken voor sub-pixel rounding-marge bij printen.
  const breedteMm = (labelFormaat?.breedteMm ?? DEFAULT_LABEL_BREEDTE_MM) - 0.5
  const hoogteMm = (labelFormaat?.hoogteMm ?? DEFAULT_LABEL_HOOGTE_MM) - 0.5

  const order = zending.orders
  const snapshot = { omschrijvingSnapshot, klantOmschrijvingSnapshot }
  const productRegels = labelProductRegels(regel, snapshot)
  const uwReferentie = klanteigenReferentie(klanteigenNaamSnapshot)
  const land = zending.afl_land ?? 'NL'
  const barcodeValue = labelBarcode(sscc)
  const ref = labelReferentie(order)
  // HST-eis (postcodeverdeling 2026-06-17): depotnummer onder de HST-badge.
  // Alleen voor HST — andere vervoerders kennen dit depot-concept niet.
  const hstDepot =
    zending.vervoerder_code === 'hst_api'
      ? hstDepotVoorPostcode(zending.afl_postcode, land)
      : null

  // Schaalfactor t.o.v. het basis-ontwerp: 1.0 op een 3"×2"-rol, 1.5 op de
  // volle 3"×6" liggend. Hoogte stuurt rijen en fonts; de rechterkolom blijft
  // proportioneel aan de BREEDTE zodat de verhoudingen van het origineel
  // behouden blijven (anders oogt de linkerkolom uitgerekt). Rekent t.o.v. de
  // ONTWERP-basis (76,2×50,8), niet het default-formaat — zie BASIS_*_MM.
  const s = hoogteMm / (BASIS_HOOGTE_MM - 0.5)
  const fz = (px: number) => `${Math.round(px * s * 10) / 10}px`
  const dik = (px: number) => `${Math.max(px, Math.round(px * s))}px`

  // Veilige marges (mm) rondom de inhoud. BELANGRIJK: de inhoud wordt absoluut
  // INGESPRONGEN (zie de return), NIET via padding op .shipping-label — die
  // padding wordt door de @media-print-regel genuld, waardoor de marge enkel op
  // het scherm zichtbaar was en de print tegen/over de rand liep. Vast in mm
  // (geen schaling): een fysieke veiligheidsmarge is absoluut. Tunebaar — ruim
  // links (afsnijding + zwart streepje), iets minder onder, compacter/centraler.
  const margeLinksMm = 7
  const margeRechtsMm = 4
  const margeBovenMm = 4
  const margeOnderMm = 3
  const binnenBreedteMm = breedteMm - margeLinksMm - margeRechtsMm
  const binnenHoogteMm = hoogteMm - margeBovenMm - margeOnderMm

  const colRechtsMm = binnenBreedteMm * (COL_RECHTS_MM / (BASIS_BREEDTE_MM - 0.5))
  const rij1Mm = RIJ1_MM * s
  const rij3Mm = RIJ3_MM * s
  const colLinksMm = binnenBreedteMm - colRechtsMm
  const rij2Mm = binnenHoogteMm - rij1Mm - rij3Mm
  // Beschikbare breedte voor de barcode (linkerkolom minus padding) — de
  // barcode kiest daarbinnen zelf een dot-aligned module-breedte.
  const barcodeFitMm = colLinksMm - 2 * s

  const cellBase: React.CSSProperties = {
    position: 'absolute',
    boxSizing: 'border-box',
    overflow: 'hidden',
  }

  return (
    <div
      className="shipping-label bg-white"
      data-shipping-label-v="4-inset"
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
      {/* Inhoud absoluut INGESPRONGEN i.p.v. via root-padding, zodat de marge
          ook bij het printen behouden blijft (de print-CSS nult padding). */}
      <div
        style={{
          position: 'absolute',
          top: `${margeBovenMm}mm`,
          left: `${margeLinksMm}mm`,
          width: `${binnenBreedteMm}mm`,
          height: `${binnenHoogteMm}mm`,
        }}
      >
      {/* Rij 1 — links: order/uw-ref + productnaam */}
      <div
        style={{
          ...cellBase,
          top: 0,
          left: 0,
          width: `${colLinksMm}mm`,
          height: `${rij1Mm}mm`,
          borderRight: '1px solid #000',
          borderBottom: '1px solid #000',
          padding: `${0.5 * s}mm ${s}mm`,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: fz(6), lineHeight: 1.1 }}>
          <strong>Order:</strong> {order.order_nr}
          {externReferentie(order.klant_referentie) && (
            <>
              {' '}
              <strong>Ref:</strong> {externReferentie(order.klant_referentie)}
            </>
          )}
        </div>
        <div
          style={{
            fontSize: fz(10),
            fontWeight: 700,
            textTransform: 'uppercase',
            lineHeight: 1.1,
            marginTop: `${0.3 * s}mm`,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {productRegels.groot}
        </div>
        {uwReferentie && (
          <div
            style={{
              fontSize: fz(6),
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            Uw referentie: {uwReferentie}
          </div>
        )}
        {productRegels.klein && (
          <div
            style={{
              fontSize: fz(6),
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {productRegels.klein}
          </div>
        )}
      </div>

      {/* Rij 1 — rechts: Karpi BV afzender + vervoerder-depotnummer (HST-eis Thom ten Brinke 2026-02-26) */}
      <div
        style={{
          ...cellBase,
          top: 0,
          right: 0,
          width: `${colRechtsMm}mm`,
          height: `${rij1Mm}mm`,
          borderBottom: '1px solid #000',
          padding: `${0.5 * s}mm ${s}mm`,
          fontSize: fz(6),
          lineHeight: 1.15,
        }}
      >
        <div style={{ fontWeight: 600 }}>Karpi BV</div>
        {zending.track_trace ? (
          <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>{zending.track_trace}</div>
        ) : (
          <div>7122 LB Aalten</div>
        )}
        <div style={{ fontSize: fz(5) }}>Z {zending.zending_nr}</div>
      </div>

      {/* Rij 2 — links: afleveradres met dik kader */}
      <div
        style={{
          ...cellBase,
          top: `${rij1Mm}mm`,
          left: 0,
          width: `${colLinksMm}mm`,
          height: `${rij2Mm}mm`,
          borderRight: '1px solid #000',
          padding: `${s}mm`,
        }}
      >
        <div
          style={{
            height: '100%',
            width: '100%',
            border: `${dik(2)} solid #000`,
            padding: `${s}mm ${1.5 * s}mm`,
            fontSize: fz(8),
            fontWeight: 700,
            textTransform: 'uppercase',
            lineHeight: 1.6,
            boxSizing: 'border-box',
            overflow: 'hidden',
            // Horizontaal (textAlign) én verticaal (flex-kolom + justify center)
            // centreren, zodat het adres écht in het midden van het zwarte vak
            // staat i.p.v. bovenaan.
            textAlign: 'center',
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
          <div style={{ display: 'flex', justifyContent: 'center', gap: `${2 * s}mm` }}>
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {zending.afl_postcode ?? ''} {zending.afl_plaats ?? ''}
            </span>
            <span>{land}</span>
          </div>
        </div>
      </div>

      {/* Rij 2 — rechts: vervoerder-badge gecentreerd, met HST-depot eronder */}
      <div
        style={{
          ...cellBase,
          top: `${rij1Mm}mm`,
          right: 0,
          width: `${colRechtsMm}mm`,
          height: `${rij2Mm}mm`,
          padding: `${s}mm`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: `${0.8 * s}mm`,
        }}
      >
        <div
          style={{
            border: `${dik(3)} solid #000`,
            padding: `${s}mm ${2 * s}mm`,
            fontSize: fz(13),
            fontWeight: 700,
            textAlign: 'center',
            lineHeight: 1.1,
            letterSpacing: '0.03em',
            maxWidth: '100%',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {vervoerderNaam}
        </div>
        {hstDepot && (
          <div
            style={{
              fontSize: fz(9),
              fontWeight: 700,
              lineHeight: 1,
              whiteSpace: 'nowrap',
            }}
          >
            Depot {hstDepot}
          </div>
        )}
      </div>

      {/* Rij 3 — links: barcode + cijfers */}
      <div
        style={{
          ...cellBase,
          bottom: 0,
          left: 0,
          width: `${colLinksMm}mm`,
          height: `${rij3Mm}mm`,
          borderRight: '1px solid #000',
          borderTop: '1px solid #000',
          padding: `${0.5 * s}mm ${s}mm`,
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
              fitMm={barcodeFitMm}
              style={{ height: `${8 * s}mm` }}
            />
            <div
              style={{
                marginTop: `${0.3 * s}mm`,
                textAlign: 'center',
                fontFamily: 'monospace',
                fontSize: fz(9),
                fontWeight: 600,
                letterSpacing: '0.12em',
                lineHeight: 1,
              }}
            >
              {barcodeValue}
            </div>
          </>
        ) : (
          <div style={{ fontSize: fz(7), textAlign: 'center' }}>
            Geen colli-barcode geregistreerd
          </div>
        )}
      </div>

      {/* Rij 3 — rechts: colli + REFERENTIE + datum/ref */}
      <div
        style={{
          ...cellBase,
          bottom: 0,
          right: 0,
          width: `${colRechtsMm}mm`,
          height: `${rij3Mm}mm`,
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
            fontSize: fz(10),
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {colliIndex} VAN {colliTotal}
        </div>
        <div style={{ padding: `${0.3 * s}mm ${s}mm` }}>
          <div
            style={{
              fontSize: fz(5),
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              lineHeight: 1,
            }}
          >
            Referentie
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: `${s}mm`,
              fontSize: fz(7),
              fontFamily: 'monospace',
              lineHeight: 1.1,
            }}
          >
            <span>{labelDatumKort(zending)}</span>
            <span>{ref}</span>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
