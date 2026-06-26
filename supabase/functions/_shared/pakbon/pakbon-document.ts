// Canonieke pakbon-document-builder: zet een zending + bedrijfsgegevens om in een
// medium-onafhankelijk `PakbonDocument` waarin alle presentatie-beslissingen al
// genomen zijn (welke tekst, groepering, totalen). Spiegelt de afleiding in de
// React-component `pakbon-document.tsx`; de pdf-lib-renderer doet alleen lay-out.

import { bouwPakbonRegels, klantNaamWijktAf, productNamen, telColli } from './aggregatie.ts'
import { externReferentie } from '../referentie.ts'
import { afwerkingPresentatie, type AfwerkingTypeMap } from '../afwerking-presentatie.ts'
import type {
  PakbonDocument,
  PakbonOrderGroep,
  PakbonRegel,
  PakbonRegelDisplay,
  PakbonZendingInput,
} from './types.ts'

// Pakbon toont het land voluit zoals het oude Lieferschein ("DUITSLAND");
// onbekende codes vallen terug op de code zelf. Gelijk aan pakbon-document.tsx.
const LAND_NAMEN: Record<string, string> = {
  NL: 'NEDERLAND',
  DE: 'DUITSLAND',
  BE: 'BELGIË',
  FR: 'FRANKRIJK',
  AT: 'OOSTENRIJK',
  LU: 'LUXEMBURG',
  CH: 'ZWITSERLAND',
  DK: 'DENEMARKEN',
}

function landNaam(code: string | null): string | null {
  if (!code) return null
  return LAND_NAMEN[code.toUpperCase()] ?? code
}

const nlGetal = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 })
const nlGewicht = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function formatAantal(v: number): string {
  return nlGetal.format(v)
}

/** ISO ('YYYY-MM-DD' of timestamp) → DD-MM-YYYY (mirror frontend formatDate). */
function formatDatum(iso: string | null): string {
  if (!iso) return ''
  const datumDeel = iso.slice(0, 10)
  const [y, m, d] = datumDeel.split('-')
  if (!y || !m || !d) return ''
  return `${d}-${m}-${y}`
}

/** Bouw de display-regels voor één bron-order-groep. */
function bouwGroepRegels(regels: PakbonRegel[], afwerkingTypes: AfwerkingTypeMap): PakbonRegelDisplay[] {
  return regels.map((pr, idx) => {
    const namen = productNamen(pr.regel, pr.snapshot)
    const hoofdNaam = namen.karpiNaam ?? namen.klantNaam
    // "Uw naam" alleen als die zinvol afwijkt van de hoofdregel — niet als het
    // slechts de hoofdregel-mín-maat of de Karpi-code is (single source met de
    // geprinte pakbon, mig 388/436).
    const toonUwNaam = klantNaamWijktAf(hoofdNaam, namen.klantNaam, pr.regel.artikelnr)
    const orderRegel = pr.regel.order_regels
    // Maat zit al in de bevroren omschrijving; aparte regel alleen bij legacy-
    // zending zonder colli-snapshot (= `!snapshot`).
    const maatRegel =
      orderRegel?.is_maatwerk && !pr.snapshot
        ? `Op maat ${orderRegel.maatwerk_breedte_cm ?? '-'} x ${orderRegel.maatwerk_lengte_cm ?? '-'} cm`
        : null
    // Afwerking zit NOOIT in de bevroren snapshot (die kent alleen kwaliteit/
    // kleur/maat) — dus altijd tonen, ook mét colli-snapshot.
    const afwerkingRegel = afwerkingPresentatie(
      orderRegel?.maatwerk_afwerking ?? null,
      orderRegel?.maatwerk_band_kleur ?? null,
      afwerkingTypes,
    )
    return {
      regelnummer: String(orderRegel?.regelnummer ?? idx + 1).padStart(2, '0'),
      artikelnr: pr.regel.artikelnr ?? '-',
      hoofdNaam,
      uwNaam: toonUwNaam ? namen.klantNaam : null,
      maatRegel,
      afwerkingRegel,
      omstickerCodes: pr.omstickerCodes,
      besteld: formatAantal(pr.besteld),
      geleverd: formatAantal(pr.geleverd),
      isManco: pr.isManco,
    }
  })
}

export interface BouwPakbonDocumentOpties {
  /** Aantal colli (komt normaal uit de label-expansie / colli-count). */
  kolli?: number
  /** Routecode (HST-depot) — geïnjecteerde render-context, géén document-
   *  eigenschap. Print-only voor de magazijn-sortering: de geprinte React-pakbon
   *  geeft `hstDepotVoorPostcode` mee, de factuurmail-PDF niets (→ NULL). */
  routecode?: string | null
  /** code → {naam, type_bewerking} uit `afwerking_types` (fetchAfwerkingTypeMap). */
  afwerkingTypes?: AfwerkingTypeMap
}

export function bouwPakbonDocument(
  zending: PakbonZendingInput,
  opties: BouwPakbonDocumentOpties = {},
): PakbonDocument {
  const order = zending.orders
  const pakbonRegels = bouwPakbonRegels(zending)
  const afwerkingTypes = opties.afwerkingTypes ?? new Map()

  // Groepeer per bron-order (mig 222). Solo-zending = één groep.
  const isBundel = zending.bundel_orders.length > 1
  const orderNrPerOrderId = new Map(zending.bundel_orders.map((bo) => [bo.id, bo.order_nr]))
  const regelsPerOrder = new Map<number, PakbonRegel[]>()
  for (const pr of pakbonRegels) {
    const lijst = regelsPerOrder.get(pr.orderId) ?? []
    lijst.push(pr)
    regelsPerOrder.set(pr.orderId, lijst)
  }
  const orderIdRenderVolgorde: number[] = [
    ...zending.bundel_orders.map((bo) => bo.id).filter((id) => regelsPerOrder.has(id)),
    ...Array.from(regelsPerOrder.keys()).filter(
      (id) => !zending.bundel_orders.some((bo) => bo.id === id),
    ),
  ]
  const groepen: PakbonOrderGroep[] = orderIdRenderVolgorde.map((oid) => ({
    orderId: oid,
    orderNr: orderNrPerOrderId.get(oid) ?? null,
    regels: bouwGroepRegels(regelsPerOrder.get(oid) ?? [], afwerkingTypes),
  }))

  // Totalen: gewicht uit zending wint, val terug op SUM(regelgewicht × geleverd).
  const somGewicht = pakbonRegels.reduce((sum, r) => sum + r.gewichtKg, 0)
  const totaalGewichtKg = Number(zending.totaal_gewicht_kg ?? 0) || somGewicht
  const kolli = (opties.kolli ?? 0) > 0 ? (opties.kolli as number) : telColli(zending)

  // Adresblokken.
  const aflLand = landNaam(zending.afl_land)
  const afleveradres = [
    zending.afl_naam ?? order.debiteuren?.naam ?? '',
    order.afl_naam_2 ?? '',
    zending.afl_adres ?? '',
    `${zending.afl_postcode ?? ''} ${zending.afl_plaats ?? ''}`.trim(),
    aflLand && zending.afl_land !== 'NL' ? aflLand : '',
  ].filter((r) => r.trim().length > 0)

  const klantLand = landNaam(order.fact_land)
  const factuuradres = [
    order.fact_naam || order.debiteuren?.naam || '',
    order.fact_adres ?? '',
    `${order.fact_postcode ?? ''} ${order.fact_plaats ?? ''}`.trim(),
    klantLand && order.fact_land !== 'NL' ? klantLand : '',
  ].filter((r) => r.trim().length > 0)

  // Referentie-meta. externReferentie strips de interne " / Shopify: #NNN"-suffix
  // (mag nooit op een extern document) — gelijk aan de geprinte pakbon.
  const referentieRegel =
    [externReferentie(order.klant_referentie), order.week ? `(WK ${order.week})` : null]
      .filter(Boolean)
      .join(' ') || '-'
  const vertegenwoordiger = order.vertegenwoordigers?.naam ?? order.vertegenw_code ?? '-'
  const bundelRegels = isBundel
    ? zending.bundel_orders.map((bo) => {
        const ref =
          [externReferentie(bo.klant_referentie), bo.week ? `(WK ${bo.week})` : null]
            .filter(Boolean)
            .join(' ') || '-'
        return `· ${bo.order_nr} : Ref. ${ref}`
      })
    : []

  return {
    pakbonnr: zending.zending_nr,
    datum: formatDatum(zending.verzenddatum ?? zending.created_at),
    isDeelzending: zending.is_deelzending === true,
    afleveradres,
    afleverTelefoon: zending.afl_telefoon,
    factuuradres,
    isBundel,
    referentieRegel,
    vertegenwoordiger,
    orderDebiteur: `${order.order_nr}/${order.debiteur_nr}`,
    debiteur: String(order.debiteur_nr),
    // Geïnjecteerde print-only render-context (geen `debiteuren.route` meer — die
    // legacy-bron toonde bij élke vervoerder een waarde, ook op een Rhenus-pakbon).
    routecode: opties.routecode ?? null,
    bundelRegels,
    groepen,
    kolli,
    totaalGewichtKg,
  }
}

export { formatAantal, formatDatum, nlGewicht }
