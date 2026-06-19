// Pure helpers voor de printset-rendering: label-expansie, vervoerder-info,
// label-formaat. Gebruikt door zowel de enkele-zending printset-pagina als de
// bulk-printset-pagina, zodat één zending er identiek uitziet ongeacht de bron.
import { isShippingRegel } from './is-shipping-regel'
import { getVervoerderDef } from '../registry'
// Pakbon-regel-aggregatie = single source in _shared/pakbon (Pakbondocument-
// consolidatie 2026-06-19, ADR-0033). De label-`colliRijen`-expansie blijft hier
// (één renderer); alleen de `pakbonRegels`-tak deelt de gedeelde aggregatie.
import { bouwPakbonRegels } from '../../../../../supabase/functions/_shared/pakbon/aggregatie'
import type { PakbonRegel } from '../../../../../supabase/functions/_shared/pakbon/types'
import type {
  ZendingPrintRegel,
  ZendingPrintSet,
} from '../queries/zendingen'

// PakbonRegel woont nu in _shared/pakbon/types — re-export houdt de bestaande
// import `from '@/modules/logistiek/lib/printset'` (pakbon-document.tsx) intact.
export type { PakbonRegel } from '../../../../../supabase/functions/_shared/pakbon/types'

// Zebra-standaard 3"×6" liggend verzendlabel (152,4×76,2mm) — het fysieke
// formaat op de Karpi-printer (ZT231). HST stond al expliciet op deze maat
// (mig 362) en is de basis voor het canonieke verzendlabel; Rhenus/Verhoek
// (geen `vervoerders.label_*_mm`-rij → NULL) erven dit grote label nu vanzelf,
// zodat de afgekapte "Rhe…"-badge verdwijnt. De kolom blijft de override-seam:
// een vervoerder die echt afwijkt, zet zijn eigen `label_breedte_mm/_hoogte_mm`.
export const DEFAULT_LABEL_BREEDTE_MM = 152.4
export const DEFAULT_LABEL_HOOGTE_MM = 76.2

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
  /** Colli-volgnummer (`zending_colli.colli_nr`) of, in het legacy-pad, de
   * lopende index. De labelvarianten gebruiken dit niet direct (zij krijgen
   * `index`), maar de gedeelde expansie houdt het bij voor diagnose. */
  colliNr: number
  /** Bron-orderregel — voedt de pakbon-aggregatie (mig 388-snapshot-lookup)
   * en bundel-groepering. `null` = colli zonder regel-koppeling. */
  orderRegelId: number | null
  /** Bron-order (uit `order_regels.order_id`, fallback de primaire order) —
   * voedt de pakbon-groepering per bron-order (mig 222). */
  orderId: number | null
  /** Mig 419: bevroren klant-eigennaam voor de kwaliteit ("Uw referentie" op
   * het label). `null` = geen afwijkende naam / legacy-colli. */
  klanteigenNaamSnapshot: string | null
  /** Mig 436: karpi_code van het fysiek gepakte equivalent ("OMB:"-regel op het
   * label). `null` = geen omsticker / legacy-colli. */
  omstickerSnapshot: string | null
}

/**
 * Eén canonieke expansie van een zending, geconsumeerd door zowel de drie
 * labelvarianten (`colliRijen`, 1 per fysieke colli) als de pakbon
 * (`pakbonRegels`, 1 per orderregel). Beide views komen uit dezelfde
 * colli→regel-map, sortering en VERZEND-filter — dat is de hele bestaansreden
 * van deze functie (voorheen bouwden label en pakbon dit onafhankelijk op).
 */
export interface Verzenddocument {
  colliRijen: LabelItem[]
  pakbonRegels: PakbonRegel[]
  /** Aantal fysieke colli's (= `colliRijen.length`). */
  colliTotaal: number
  /** Σ(regelgewicht × geleverd) over de pakbonregels. De pakbon geeft
   * `zendingen.totaal_gewicht_kg` voorrang en valt hierop terug. */
  totaalGewichtKg: number
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
 * Expandeert een zending ÉÉN keer naar zowel de label-rijen (per fysieke colli)
 * als de pakbon-rijen (per orderregel). Single source: label en pakbon delen
 * dezelfde colli→regel-map, sortering, snapshot-omschrijving en VERZEND-filter,
 * zodat ze niet meer onafhankelijk kunnen driften (de klasse waar het
 * HST-overlossing-incident van 12-06-2026 uit kwam).
 *
 * BRON-VAN-WAARHEID voor de SSCC: `zending_colli` (mig 209) — dezelfde rijen
 * waaruit `hst-send` de `BarCode` naar de vervoerder stuurt; nooit client-side
 * gegenereerd. Legacy-zendingen zonder colli-rijen: één label per stuk uit de
 * zending_regels, zónder barcode (`sscc: null`).
 *
 * De besteld/geleverd/gewicht-formules van de pakbonregels zijn bewust gelijk
 * aan de historische pakbon-logica (regel-gebaseerd, niet colli-count) zodat de
 * geprinte pakbon byte-identiek blijft — geborgd door `pakbon-document.test.tsx`.
 */
export function bouwVerzenddocument(zending: ZendingPrintSet): Verzenddocument {
  // Service-regels (verzendkosten) zijn factuur-only en hebben geen sticker/colli.
  const fysiekeRegels = zending.zending_regels.filter((r) => !isShippingRegel(r))
  const primaireOrderId = zending.orders.id

  // Eén colli→regel-map (eerste fysieke regel per orderregel), gedeeld door
  // beide views.
  const regelPerOrderRegel = new Map<number, ZendingPrintRegel>()
  for (const regel of fysiekeRegels) {
    if (regel.order_regel_id != null && !regelPerOrderRegel.has(regel.order_regel_id)) {
      regelPerOrderRegel.set(regel.order_regel_id, regel)
    }
  }

  const orderIdVoor = (regel: ZendingPrintRegel | null): number =>
    regel?.order_regels?.order_id ?? primaireOrderId

  // ── colliRijen (labels) ──────────────────────────────────────────────────
  // Mig 420: gebundelde kind-colli (bundel_colli_id != null) vallen weg uit de
  // labels — die zitten fysiek in de zak onder de bundel-sticker. De bundel-rij
  // zelf (is_bundel) draagt zijn eigen SSCC en wordt wél geprint.
  const colli = [...(zending.zending_colli ?? [])]
    .filter((c) => c.bundel_colli_id == null)
    .sort((a, b) => a.colli_nr - b.colli_nr)
  let colliRijen: LabelItem[]
  if (colli.length > 0) {
    colliRijen = colli.map((c, index) => {
      const regel = (c.order_regel_id != null ? regelPerOrderRegel.get(c.order_regel_id) : null) ?? null
      return {
        regel,
        index: index + 1,
        colliNr: c.colli_nr,
        sscc: c.sscc,
        orderRegelId: c.order_regel_id,
        orderId: orderIdVoor(regel),
        omschrijvingSnapshot: c.omschrijving_snapshot,
        klantOmschrijvingSnapshot: c.klant_omschrijving_snapshot,
        klanteigenNaamSnapshot: c.klanteigen_naam_snapshot,
        omstickerSnapshot: c.omsticker_snapshot,
      }
    })
  } else {
    // Legacy-pad: geen colli-registratie → adres-labels zonder barcode, één per
    // stuk. Identiek aan de oude `expandLabels`-fallback (incl. de "minstens
    // één label"-garantie als alle regels aantal 0 hebben).
    const expanded: Array<ZendingPrintRegel | null> = []
    for (const regel of fysiekeRegels) {
      const aantal = Math.max(0, Math.trunc(Number(regel.aantal ?? 1)))
      for (let i = 0; i < aantal; i += 1) expanded.push(regel)
    }
    const targetTotal = Math.max(expanded.length, 1)
    while (expanded.length < targetTotal) expanded.push(expanded.at(-1) ?? null)
    colliRijen = expanded.slice(0, targetTotal).map((regel, index) => ({
      regel,
      index: index + 1,
      colliNr: index + 1,
      sscc: null,
      orderRegelId: regel?.order_regel_id ?? null,
      orderId: orderIdVoor(regel),
      omschrijvingSnapshot: null,
      klantOmschrijvingSnapshot: null,
      klanteigenNaamSnapshot: null,
      omstickerSnapshot: null,
    }))
  }

  // ── pakbonRegels (pakbon) ────────────────────────────────────────────────
  // Eén regel per fysieke orderregel — gedeelde aggregatie (single source met de
  // server-pakbon-PDF). De pakbon-component groepeert daarna per `orderId` voor
  // de bundel-subkoppen.
  const pakbonRegels = bouwPakbonRegels(zending)

  const totaalGewichtKg = pakbonRegels.reduce((sum, r) => sum + r.gewichtKg, 0)

  return { colliRijen, pakbonRegels, colliTotaal: colliRijen.length, totaalGewichtKg }
}

/**
 * Label-expansie: één item per fysieke colli. Dunne wrapper rond
 * `bouwVerzenddocument` zodat de labelvarianten en beide printset-pagina's
 * onaangeroerd blijven.
 */
export function expandLabels(zending: ZendingPrintSet): LabelItem[] {
  return bouwVerzenddocument(zending).colliRijen
}
