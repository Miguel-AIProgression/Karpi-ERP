// Golden fixtures voor bouwOrderCommit — pinnen het HUIDIGE gedrag van de
// create-flow in saveMutation.mutationFn (order-form.tsx) vóór de extractie.
// Eigenaardigheden zijn bewust vastgelegd (gedragsbehoud, zie detailplan
// 2026-06-10-fase1-order-commit-pipeline-detailplan.md):
//   - IO-tekort-split: sub-orders krijgen lever_modus 'in_een_keer' en
//     behouden de oorspronkelijke afleverdatum/week uit de header.
//   - Verzend-tie (gelijke totalen) gaat naar deel A.
//   - Spoed-regel (geen is_pseudo-vlag) telt als IO-tekort en verhuist bij
//     een IO-split volledig naar het IO-deel.
import type { OrderFormData, OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import type { OrderCommitInput, OrderCommitPlan } from '../order-commit'
import { SHIPPING_PRODUCT_ID } from '@/lib/constants/shipping'
import { SPOED_PRODUCT_ID } from '@/lib/constants/spoed'

export interface OrderCommitGolden {
  naam: string
  toelichting: string
  input: OrderCommitInput
  verwacht: OrderCommitPlan
}

const DEBITEUR_NR = 100001

const HEADER: Partial<OrderFormData> = {
  klant_referentie: 'TEST-REF',
  afleverdatum: '2026-06-19', // ISO-week 25
  week: '25',
  fact_naam: 'Testklant BV',
  afl_naam: 'Testklant BV',
  afl_plaats: 'Utrecht',
  lever_type: 'week',
}

/** Spiegelt orderData in de huidige mutationFn (zonder lever_modus-override). */
const ORDER_DATA: OrderFormData = { ...HEADER, afhalen: false, debiteur_nr: DEBITEUR_NR }

const GEMENGD_INFO = {
  standaardDatum: '2026-06-12', // ISO-week 24
  maatwerkDatum: '2026-07-10',
  langsteDatum: '2026-07-10',
  heeftGemengd: true,
}

const STANDAARD_INFO = {
  standaardDatum: '2026-06-12',
  maatwerkDatum: null,
  langsteDatum: '2026-06-12',
  heeftGemengd: false,
}

// — regels —
const STANDAARD_300: OrderRegelFormData = {
  artikelnr: '10001', omschrijving: 'Karpet 160x230',
  orderaantal: 2, te_leveren: 2, prijs: 150, korting_pct: 0, bedrag: 300,
  vrije_voorraad: 10,
}
const MAATWERK_500: OrderRegelFormData = {
  artikelnr: 'MW-VLOER', omschrijving: 'Maatwerk vloerkleed',
  orderaantal: 1, te_leveren: 1, prijs: 500, korting_pct: 0, bedrag: 500,
  is_maatwerk: true, maatwerk_kwaliteit_code: 'VERR', maatwerk_kleur_code: '130',
  maatwerk_lengte_cm: 300, maatwerk_breedte_cm: 200,
}
// Zoals applyShippingLogic hem aanmaakt — mét is_pseudo (telt dus niet als IO-tekort).
const VERZEND_15: OrderRegelFormData = {
  artikelnr: SHIPPING_PRODUCT_ID, omschrijving: 'Verzendkosten',
  orderaantal: 1, te_leveren: 1, prijs: 15, korting_pct: 0, bedrag: 15,
  is_pseudo: true,
}
// Zoals applySpoedToeslag hem aanmaakt — ZONDER is_pseudo (telt als IO-tekort).
const SPOED_50: OrderRegelFormData = {
  artikelnr: SPOED_PRODUCT_ID, omschrijving: 'Spoedtoeslag',
  orderaantal: 1, te_leveren: 1, prijs: 50, korting_pct: 0, bedrag: 50,
}
const TEKORT_REGEL: OrderRegelFormData = {
  artikelnr: '20001', omschrijving: 'Karpet A',
  orderaantal: 10, te_leveren: 10, prijs: 100, korting_pct: 0, bedrag: 1000,
  vrije_voorraad: 4,
  uitwisselbaar_keuzes: [{ artikelnr: '20002', aantal: 2 }],
}
const GEDEKTE_REGEL: OrderRegelFormData = {
  artikelnr: '20003', omschrijving: 'Karpet B',
  orderaantal: 2, te_leveren: 2, prijs: 50, korting_pct: 0, bedrag: 100,
  vrije_voorraad: 5,
}
const PSEUDO_REGEL: OrderRegelFormData = {
  artikelnr: 'KORTING1', omschrijving: 'Administratieve korting',
  orderaantal: 3, te_leveren: 3, korting_pct: 0, bedrag: 0,
  is_pseudo: true,
}
const TEKORT_KLEIN: OrderRegelFormData = {
  artikelnr: '30001', omschrijving: 'Karpet C',
  orderaantal: 5, te_leveren: 5, prijs: 100, korting_pct: 0, bedrag: 500,
  vrije_voorraad: 2,
}
const GEDEKTE_400: OrderRegelFormData = {
  artikelnr: '40001', omschrijving: 'Karpet D',
  orderaantal: 4, te_leveren: 4, prijs: 100, korting_pct: 0, bedrag: 400,
  vrije_voorraad: 4,
}

export const ORDER_COMMIT_GOLDENS: OrderCommitGolden[] = [
  {
    naam: 'a-gemengde-split-verzend-naar-duurste',
    toelichting:
      'deelleveringen AAN + gemengd → 2 orders; standaard-order krijgt standaardDatum (wk 24), ' +
      'maatwerk-order krijgt seam-datum (wk 29); verzend naar duurste deel (maatwerk, 500 > 300); ' +
      'autoplan alleen op maatwerk-deel.',
    input: {
      regels: [STANDAARD_300, MAATWERK_500, VERZEND_15],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: true,
      afleverdatumInfo: GEMENGD_INFO,
      echteMaatwerkDatum: '2026-07-17', // ISO-week 29
    },
    verwacht: {
      gesplitst: true,
      orders: [
        {
          header: { ...ORDER_DATA, afleverdatum: '2026-06-12', week: '24' },
          regels: [STANDAARD_300],
          triggerAutoplan: false,
        },
        {
          header: { ...ORDER_DATA, afleverdatum: '2026-07-17', week: '29' },
          regels: [MAATWERK_500, VERZEND_15],
          triggerAutoplan: true,
        },
      ],
    },
  },
  {
    naam: 'b-io-tekort-split-met-override-modus',
    toelichting:
      'overrideLeverModus=deelleveringen + IO-tekort → 2 orders met lever_modus in_een_keer; ' +
      'tekort-regel splitst 6/4 met proportionele bedragen; gedekte + maatwerk-regels blijven direct; ' +
      'verzend naar duurste deel (direct, 1200 > 400); afleverdatum/week ongewijzigd uit header; ' +
      'deelleveringen-checkbox UIT + heeftGemengd=true pint dat gemengd alléén niet splitst.',
    input: {
      regels: [TEKORT_REGEL, GEDEKTE_REGEL, MAATWERK_500, VERZEND_15],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      overrideLeverModus: 'deelleveringen',
      afleverdatumInfo: { ...GEMENGD_INFO },
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: true,
      orders: [
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [
            { ...TEKORT_REGEL, orderaantal: 6, te_leveren: 6, bedrag: 600 },
            GEDEKTE_REGEL,
            MAATWERK_500,
            VERZEND_15,
          ],
          triggerAutoplan: true,
        },
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [
            { ...TEKORT_REGEL, orderaantal: 4, te_leveren: 4, uitwisselbaar_keuzes: [], bedrag: 400 },
          ],
          triggerAutoplan: false,
        },
      ],
    },
  },
  {
    naam: 'c-geen-split',
    toelichting: 'geen modus, geen gemengd, alles gedekt → 1 order, regels ongewijzigd incl. verzend.',
    input: {
      regels: [STANDAARD_300, VERZEND_15],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      afleverdatumInfo: STANDAARD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: false,
      orders: [
        { header: ORDER_DATA, regels: [STANDAARD_300, VERZEND_15], triggerAutoplan: true },
      ],
    },
  },
  {
    naam: 'd-verzend-tie-naar-deel-a-en-seam-fallback',
    toelichting:
      'gemengde split met gelijke totalen (250 == 250) → verzend naar deel A (standaard); ' +
      'echteMaatwerkDatum null → maatwerk-order valt terug op header-afleverdatum/week.',
    input: {
      regels: [
        { ...STANDAARD_300, prijs: 125, bedrag: 250 },
        { ...MAATWERK_500, prijs: 250, bedrag: 250 },
        { ...VERZEND_15, prijs: 10, bedrag: 10 },
      ],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: true,
      afleverdatumInfo: GEMENGD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: true,
      orders: [
        {
          header: { ...ORDER_DATA, afleverdatum: '2026-06-12', week: '24' },
          regels: [
            { ...STANDAARD_300, prijs: 125, bedrag: 250 },
            { ...VERZEND_15, prijs: 10, bedrag: 10 },
          ],
          triggerAutoplan: false,
        },
        {
          header: { ...ORDER_DATA },
          regels: [{ ...MAATWERK_500, prijs: 250, bedrag: 250 }],
          triggerAutoplan: true,
        },
      ],
    },
  },
  {
    naam: 'e-admin-pseudo-blijft-direct-header-modus',
    toelichting:
      'lever_modus uit header (geen override) + IO-tekort → split; admin-pseudo-regel heeft ' +
      'dekking 0/0/0 (geskipt) en blijft ongewijzigd in het directe deel; geen verzendregel.',
    input: {
      regels: [PSEUDO_REGEL, TEKORT_KLEIN],
      header: { ...HEADER, lever_modus: 'deelleveringen' },
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      afleverdatumInfo: STANDAARD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: true,
      orders: [
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [PSEUDO_REGEL, { ...TEKORT_KLEIN, orderaantal: 2, te_leveren: 2, bedrag: 200 }],
          triggerAutoplan: true,
        },
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [
            { ...TEKORT_KLEIN, orderaantal: 3, te_leveren: 3, uitwisselbaar_keuzes: [], bedrag: 300 },
          ],
          triggerAutoplan: false,
        },
      ],
    },
  },
  {
    naam: 'f-spoed-zonder-modus-geen-split',
    toelichting:
      'spoed-regel geeft ioTekort 1 (geen is_pseudo-vlag), maar zonder lever_modus volgt ' +
      'gewoon 1 order met alle regels — eigenaardigheid bewust gepind.',
    input: {
      regels: [GEDEKTE_REGEL, SPOED_50],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      afleverdatumInfo: STANDAARD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: false,
      orders: [
        { header: ORDER_DATA, regels: [GEDEKTE_REGEL, SPOED_50], triggerAutoplan: true },
      ],
    },
  },
  {
    naam: 'g-spoed-eigenaardigheid-verhuist-naar-io-deel',
    toelichting:
      'EIGENAARDIGHEID (gepind, niet fixen): bij modus deelleveringen triggert de spoed-regel ' +
      'zelf de IO-split (ioTekort 1 door ontbrekende is_pseudo-vlag) en verhuist hij volledig ' +
      'naar het IO-deel, met geleegde uitwisselbaar_keuzes.',
    input: {
      regels: [GEDEKTE_400, SPOED_50],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      overrideLeverModus: 'deelleveringen',
      afleverdatumInfo: STANDAARD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: true,
      orders: [
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [GEDEKTE_400],
          triggerAutoplan: true,
        },
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [{ ...SPOED_50, uitwisselbaar_keuzes: [] }],
          triggerAutoplan: false,
        },
      ],
    },
  },
  {
    naam: 'h-in-een-keer-met-tekort-geen-split',
    toelichting:
      'overrideLeverModus=in_een_keer + IO-tekort → GEEN split (alleen deelleveringen splitst); ' +
      '1 order waarvan de header de override-modus draagt; regels ongewijzigd.',
    input: {
      regels: [TEKORT_KLEIN],
      header: HEADER,
      debiteurNr: DEBITEUR_NR,
      afhalen: false,
      deelleveringen: false,
      overrideLeverModus: 'in_een_keer',
      afleverdatumInfo: STANDAARD_INFO,
      echteMaatwerkDatum: null,
    },
    verwacht: {
      gesplitst: false,
      orders: [
        {
          header: { ...ORDER_DATA, lever_modus: 'in_een_keer' },
          regels: [TEKORT_KLEIN],
          triggerAutoplan: true,
        },
      ],
    },
  },
]
