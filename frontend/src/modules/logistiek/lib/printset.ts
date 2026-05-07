// Pure helpers voor de printset-rendering: SSCC-expansie, vervoerder-info,
// label-formaat. Gebruikt door zowel de enkele-zending printset-pagina als de
// bulk-printset-pagina, zodat één zending er identiek uitziet ongeacht de bron.
import { isShippingRegel } from './is-shipping-regel'
import { generateSscc } from './sscc'
import { getVervoerderDef } from '../registry'
import type {
  ZendingPrintRegel,
  ZendingPrintSet,
} from '../queries/zendingen'

export const DEFAULT_LABEL_BREEDTE_MM = 105
export const DEFAULT_LABEL_HOOGTE_MM = 60

export interface LabelFormaat {
  breedteMm: number
  hoogteMm: number
}

export interface LabelItem {
  regel: ZendingPrintRegel | null
  index: number
  sscc: string
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
 * Expandeert een zending naar één label-item per fysiek collo. Service-regels
 * (verzendkosten) worden eruit gefilterd — die zijn factuur-only en hebben
 * geen sticker. SSCC's worden hier gegenereerd zodat dezelfde zending ALTIJD
 * dezelfde SSCC's terug-rendert (deterministisch op zending_id + colli-index).
 */
export function expandLabels(zending: ZendingPrintSet): LabelItem[] {
  const sortedRegels = zending.zending_regels
    .filter((r) => !isShippingRegel(r))
    .sort((a, b) => {
      const ar = a.order_regels?.regelnummer ?? 0
      const br = b.order_regels?.regelnummer ?? 0
      return ar - br
    })

  const expanded: Array<{ regel: ZendingPrintRegel | null }> = []
  for (const regel of sortedRegels) {
    const aantal = Math.max(0, Math.trunc(Number(regel.aantal ?? 1)))
    for (let i = 0; i < aantal; i += 1) expanded.push({ regel })
  }

  // Aantal_colli kan in oude zendingen verzendkosten meetellen — gebruik dus
  // expanded.length als bovengrens, niet zending.aantal_colli.
  const targetTotal = Math.max(expanded.length, 1)
  while (expanded.length < targetTotal) {
    expanded.push({ regel: expanded.at(-1)?.regel ?? null })
  }

  return expanded.slice(0, targetTotal).map((item, index) => ({
    ...item,
    index: index + 1,
    sscc: generateSscc(zending.id, index + 1),
  }))
}
