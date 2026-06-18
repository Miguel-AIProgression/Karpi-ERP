// Pure helpers voor de printset-rendering: label-expansie, vervoerder-info,
// label-formaat. Gebruikt door zowel de enkele-zending printset-pagina als de
// bulk-printset-pagina, zodat één zending er identiek uitziet ongeacht de bron.
import { isShippingRegel } from './is-shipping-regel'
import { getVervoerderDef } from '../registry'
import type { OmschrijvingSnapshot } from './shipping-label-data'
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
}

/**
 * Eén pakbonregel = één fysieke orderregel in de zending (geaggregeerd over de
 * colli's, anders dan een `LabelItem` dat per colli is). Komt uit dezelfde
 * `bouwVerzenddocument`-expansie als de labels, zodat sortering, snapshot-
 * omschrijving en regelfilter (VERZEND) niet meer kunnen driften tussen sticker
 * en pakbon. De besteld/geleverd/gewicht-formules zijn bewust gelijk aan de
 * historische pakbon-logica (byte-identieke output — zie `pakbon-document.test.tsx`).
 */
export interface PakbonRegel {
  regel: ZendingPrintRegel
  orderRegelId: number | null
  /** Bron-order voor groepering per orderbevestiging (mig 222). */
  orderId: number
  /** `order_regels.orderaantal`, fallback geleverd. */
  besteld: number
  /** Geleverd in deze zending — ladder `aantal ?? te_leveren ?? orderaantal ?? 1`. */
  geleverd: number
  /** `regelgewicht × geleverd` — opgeteld levert dit het zending-totaal. */
  gewichtKg: number
  /** Mig 388-snapshot uit de eerste colli van deze regel, of `null` als de
   * regel géén colli heeft (legacy). `null` ⟺ val terug op de live afleiding én
   * toon de losse maat-regel — exact de `snapshotVoor`-semantiek van de oude
   * pakbon (een colli met lege snapshot-inhoud telt als non-null). */
  snapshot: OmschrijvingSnapshot | null
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

/** Geleverd-aantal in deze zending — identiek aan de historische pakbon-ladder. */
function geleverdAantal(regel: ZendingPrintRegel): number {
  return Number(
    regel.aantal ?? regel.order_regels?.te_leveren ?? regel.order_regels?.orderaantal ?? 1,
  )
}

/** Regelgewicht (kg) — `order_regels.gewicht_kg` met product-fallback. */
function regelGewichtKg(regel: ZendingPrintRegel): number {
  const r = regel.order_regels
  if (!r) return 0
  return Number(r.gewicht_kg ?? r.producten?.gewicht_kg ?? 0)
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

  // Snapshot-omschrijving per orderregel (eerste colli — compose is in V1
  // regel-deterministisch, dus alle colli van een regel zijn identiek).
  const snapshotPerOrderRegel = new Map<
    number,
    { omschrijvingSnapshot: string | null; klantOmschrijvingSnapshot: string | null }
  >()
  for (const c of zending.zending_colli ?? []) {
    if (c.order_regel_id != null && !snapshotPerOrderRegel.has(c.order_regel_id)) {
      snapshotPerOrderRegel.set(c.order_regel_id, {
        omschrijvingSnapshot: c.omschrijving_snapshot,
        klantOmschrijvingSnapshot: c.klant_omschrijving_snapshot,
      })
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
    }))
  }

  // ── pakbonRegels (pakbon) ────────────────────────────────────────────────
  // Eén regel per fysieke orderregel, gesorteerd op regelnummer. De pakbon-
  // component groepeert deze daarna per `orderId` voor de bundel-subkoppen.
  const pakbonRegels: PakbonRegel[] = [...fysiekeRegels]
    .sort((a, b) => (a.order_regels?.regelnummer ?? 0) - (b.order_regels?.regelnummer ?? 0))
    .map((regel) => {
      const geleverd = geleverdAantal(regel)
      const snapshot =
        (regel.order_regel_id != null
          ? snapshotPerOrderRegel.get(regel.order_regel_id)
          : undefined) ?? null
      return {
        regel,
        orderRegelId: regel.order_regel_id,
        orderId: orderIdVoor(regel),
        besteld: Number(regel.order_regels?.orderaantal ?? geleverd),
        geleverd,
        gewichtKg: regelGewichtKg(regel) * geleverd,
        snapshot,
      }
    })

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
