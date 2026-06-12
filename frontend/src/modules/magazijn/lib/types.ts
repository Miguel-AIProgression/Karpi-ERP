// modules/magazijn/lib/types.ts — public shapes voor pickbaarheid + pick-flow.
// VervoerderSelectieStatus is verhuisd naar modules/logistiek (slot-pattern via
// useActieveVervoerder + <VervoerderTag>); magazijn weet niets meer over
// vervoerders. Zie ADR-0002.

// Pick & Ship-bucket = welke verzendweek-tab een order valt in. Tabs zijn de
// vijf eerstvolgende ISO-verzendweken (relatief aan vandaag) plus 'later'.
// Bewust *relatieve* offsets, niet absolute weeknummers, zodat het type
// stabiel blijft over tijd. Het werkelijke weeknummer (Week 20, Week 21, …)
// wordt door `genereerWeekTabs(vandaag)` afgeleid op de pagina.
//
// 'wk_1' = eerstvolgende verzendweek (huidige_week + 1) — bevat ook de orders
//          van de huidige verzendweek én achterstallige orders, zodat alles
//          dat 'nu gepickt moet worden' op één plek staat.
// 'wk_2'..'wk_5' = +2 t/m +5 weken vooruit.
// 'later' = +6 of verder, of orders zonder afleverdatum.
export type BucketKey = 'wk_1' | 'wk_2' | 'wk_3' | 'wk_4' | 'wk_5' | 'later'

export const BUCKET_VOLGORDE: BucketKey[] = ['wk_1', 'wk_2', 'wk_3', 'wk_4', 'wk_5', 'later']

export type PickShipBron = 'snijplan' | 'rol' | 'producten_default' | null
export type PickShipWachtOp = 'snijden' | 'confectie' | 'inpak' | 'inkoop' | null

export interface PickShipRegel {
  order_regel_id: number
  artikelnr: string | null
  is_maatwerk: boolean
  product: string
  kleur: string | null
  maat_cm: string
  m2: number
  orderaantal: number
  is_pickbaar: boolean
  bron: PickShipBron
  fysieke_locatie: string | null
  wacht_op: PickShipWachtOp
  totaal_stuks?: number | null
  pickbaar_stuks?: number | null
}

export interface PickShipOrder {
  order_id: number
  order_nr: string
  status: string
  klant_naam: string
  debiteur_nr: number
  afl_naam: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  /** ISO-2 of vrij geschreven landnaam — gebruikt voor land-tag op pick-row. */
  afl_land: string | null
  afleverdatum: string | null
  /** TRUE = klant haalt zelf af. UI toont afhalen-tag i.p.v. vervoerder en het
   *  knop-label wordt "Markeer afgehaald" — geen verzendstickers. Mig 204/205. */
  afhalen: boolean
  /** ADR 0014 / mig 244: 'datum' = specifieke leverdag-belofte; 'week' = ergens
   *  binnen de leverweek. Bepaalt of Pick & Ship een datum-badge toont en of de
   *  order pas vlak voor afleverdatum naar boven komt. */
  lever_type: 'week' | 'datum'
  bucket: BucketKey
  /** Sorteersleutel voor groepering, format "YYYY-Www" (bv. "2026-W19").
   *  Orders zonder afleverdatum krijgen "9999-W99" zodat ze achteraan komen.
   *  Bron: `lib/orders/verzendweek`-seam. */
  verzend_week_sleutel: string
  /** Vol label voor groepskop, bv. "Verzendweek 19" of "Geen datum". */
  verzend_week_label: string
  /** Compact label voor card/tag, bv. "Wk 19". */
  verzend_week_kort: string
  regels: PickShipRegel[]
  totaal_m2: number
  /** Som van `gewicht_kg × orderaantal` over de view-regels (mig 385) (kg).
   *  0 als gewicht nog onbekend. Indicatief op Pick & Ship; definitieve waarde
   *  wordt door `create_zending_voor_order` op de zending gezet. */
  totaal_gewicht_kg: number
  aantal_regels: number
  /** Mig 385: order-niveau-predicaat uit view `order_pickbaarheid`. Bron voor
   *  de pick-start-knop (StartPickrondesButton) — niet client-side herleiden. */
  alle_regels_pickbaar: boolean
  /** Mig 217: lopende Pickronde voor deze order (zending in status='Picken').
   *  Aanwezig zodra `start_pickronde` is aangeroepen, weg na voltooi.
   *  Drijft de "in progress"-staat op de pick-card. */
  actieve_pickronde: ActievePickronde | null
}

export interface ActievePickronde {
  zending_id: number
  zending_nr: string
  picker_id: number | null
  picker_naam: string | null
}
