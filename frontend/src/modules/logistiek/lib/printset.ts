// Pure helpers voor de printset-rendering: label-expansie, vervoerder-info,
// label-formaat. Gebruikt door zowel de enkele-zending printset-pagina als de
// bulk-printset-pagina, zodat één zending er identiek uitziet ongeacht de bron.
import { isShippingRegel } from './is-shipping-regel'
import { getVervoerderDef } from '../registry'
import type {
  ZendingPrintRegel,
  ZendingPrintSet,
} from '../queries/zendingen'

// Zebra-standaard 3"×2" verzendlabel — fysiek formaat op de Karpi-printer
// (ZD420 met 76.2×50.8mm rollen). Per-vervoerder afwijkende formaten worden
// uitgelezen uit `vervoerders.label_breedte_mm / label_hoogte_mm`.
export const DEFAULT_LABEL_BREEDTE_MM = 76.2
export const DEFAULT_LABEL_HOOGTE_MM = 50.8

export interface LabelFormaat {
  breedteMm: number
  hoogteMm: number
}

export interface LabelItem {
  regel: ZendingPrintRegel | null
  index: number
  /** 18-cijferige SSCC uit `zending_colli.sscc` — exact de barcode die
   * `hst-send` bij de vervoerder aanmeldt. `null` = zending zonder
   * colli-registratie (legacy): het label print dan géén barcode. */
  sscc: string | null
  /** Mig 209: bevroren Karpi-product + maat ("Egyptische Wol 240x330 cm").
   * Single source — gelijk aan wat de vervoerder krijgt. `null` = legacy-colli
   * (val terug op de live `regel`). */
  omschrijvingSnapshot: string | null
  /** Mig 388: bevroren, ontdubbelde klant-omschrijving. `null` = legacy of
   * geen klant-omschrijving (val terug op de live `regel`). */
  klantOmschrijvingSnapshot: string | null
}

export interface VervoerderInfo {
  code: string | null
  naam: string
  actief: boolean | null
}

export function labelFormaatVoor(zending: ZendingPrintSet): LabelFormaat {
  return {
    breedteMm: zending.vervoerders?.label_breedte_mm ?? DEFAULT_LABEL_BREEDTE_MM,
    hoogteMm: zending.vervoerders?.label_hoogte_mm ?? DEFAULT_LABEL_HOOGTE_MM,
  }
}

export function vervoerderInfoVoor(zending: ZendingPrintSet): VervoerderInfo {
  const def = getVervoerderDef(zending.vervoerder_code)
  return {
    code: zending.vervoerder_code ?? null,
    naam: zending.vervoerders?.display_naam ?? def?.displayNaam ?? 'Geen vervoerder',
    actief: zending.vervoerders?.actief ?? null,
  }
}

/**
 * Expandeert een zending naar één label-item per fysieke colli.
 *
 * BRON-VAN-WAARHEID voor de SSCC: `zending_colli` (mig 209) — dezelfde rijen
 * waaruit `hst-send` de `BarCode` naar de vervoerder stuurt. De SSCC wordt
 * hier dus NOOIT client-side gegenereerd; label en vervoerder-aanmelding
 * kunnen daardoor niet meer uiteenlopen. (HST-overlossing-incident
 * 12-06-2026: de oude `generateSscc(zendingId, colliIndex)` printte barcodes
 * die HST niet kende → karpetten "geen data" op het depot.)
 *
 * Fallback voor legacy-zendingen zonder colli-rijen: één label per stuk uit
 * de zending_regels, maar zónder barcode (`sscc: null`) — een barcode die
 * nergens aangemeld is mag nooit geprint worden.
 */
export function expandLabels(zending: ZendingPrintSet): LabelItem[] {
  // Service-regels (verzendkosten) zijn factuur-only en hebben geen sticker.
  const fysiekeRegels = zending.zending_regels.filter((r) => !isShippingRegel(r))

  const colli = [...(zending.zending_colli ?? [])].sort((a, b) => a.colli_nr - b.colli_nr)
  if (colli.length > 0) {
    const regelPerOrderRegel = new Map<number, ZendingPrintRegel>()
    for (const regel of fysiekeRegels) {
      if (regel.order_regel_id != null && !regelPerOrderRegel.has(regel.order_regel_id)) {
        regelPerOrderRegel.set(regel.order_regel_id, regel)
      }
    }
    return colli.map((c, index) => ({
      regel:
        (c.order_regel_id != null ? regelPerOrderRegel.get(c.order_regel_id) : null) ?? null,
      index: index + 1,
      sscc: c.sscc,
      omschrijvingSnapshot: c.omschrijving_snapshot,
      klantOmschrijvingSnapshot: c.klant_omschrijving_snapshot,
    }))
  }

  // Legacy-pad: geen colli-registratie → adres-labels zonder barcode.
  const expanded: Array<{ regel: ZendingPrintRegel | null }> = []
  for (const regel of fysiekeRegels) {
    const aantal = Math.max(0, Math.trunc(Number(regel.aantal ?? 1)))
    for (let i = 0; i < aantal; i += 1) expanded.push({ regel })
  }
  const targetTotal = Math.max(expanded.length, 1)
  while (expanded.length < targetTotal) {
    expanded.push({ regel: expanded.at(-1)?.regel ?? null })
  }

  return expanded.slice(0, targetTotal).map((item, index) => ({
    ...item,
    index: index + 1,
    sscc: null,
    // Legacy-zending zonder colli-registratie: geen snapshot → val terug op
    // de live `regel` in de label-/pakbon-component.
    omschrijvingSnapshot: null,
    klantOmschrijvingSnapshot: null,
  }))
}
