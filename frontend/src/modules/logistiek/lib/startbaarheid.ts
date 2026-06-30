// Startbaarheid — het canonieke predikaat "kan deze order nú een pickronde
// starten, en zo niet, waaróm geblokkeerd" (ADR-0037).
//
// Vóór 2026-06-18 leefde dit op twee TS-plekken náást elkaar: `usePickbaarheid`
// (per-reden sets voor de knoppen) én inline in `pick-overview.tsx`
// (geblokkeerdeOrderIds / nietPrintbaarIds / selectableIds). Ze werden met de
// hand synchroon gehouden en weken subtiel af. Nu één pure functie die elke
// order in **precies één status** plaatst; alle consumenten lezen die.
//
// De prioriteit is de frontend-spiegel van de server-poort
// `_valideer_intake_gates` (mig 395/396: adres vóór prijs) + de
// geen-vervoerder-guard in `start_pickronden` (mig 373). De regel-/order-
// pickbaarheid zelf blijft de view `order_pickbaarheid` (mig 386) — dit
// predikaat consumeert `alle_regels_pickbaar`, herleidt niets opnieuw.

/**
 * De toestand van een order tegenover de pickronde-start. Precies één per order.
 * Canonieke prioriteit (eerste match wint):
 *   in_pickronde > niet_pickbaar > afl_adres > afl_gln > prijs > geen_vervoerder > startbaar
 */
export type StartStatus =
  | 'startbaar' // kan nu een pickronde starten
  | 'in_pickronde' // lopende pickronde (in uitvoering) — maakt andere blockers moot
  | 'niet_pickbaar' // ≥1 regel wacht op snijden/inkoop/confectie/inpak (view order_pickbaarheid)
  | 'afl_adres' // afleveradres onvolledig (mig 395)
  | 'afl_gln' // aflever-GLN matcht geen vestiging, niet vrijgegeven (mig 535)
  | 'prijs' // ≥1 regel zonder prijs €0 (mig 396)
  | 'geen_vervoerder' // niet-afhaal + geen matchende actieve vervoerder (mig 373)

export interface StartbaarheidInput {
  order_id: number
  /** TRUE = klant haalt zelf af → nooit een vervoerder-blokkade. */
  afhalen: boolean
  /** Order-niveau-predicaat uit view `order_pickbaarheid` (mig 386). */
  alle_regels_pickbaar: boolean
  /** Mig 479: heeft de order een nog-niet-gestarte ('Gepland') deelzending
   *  die gepromoveerd kan worden? Zo ja, dan blokkeert `!alle_regels_pickbaar`
   *  niet — start_pickronden promoot dan alleen die zending en laat de
   *  nog-niet-pickbare regel(s) ongemoeid liggen. */
  heeft_gepland_zending: boolean
  /** mig 395 — gezet = afleveradres onvolledig. */
  afl_adres_incompleet_sinds: string | null
  /** mig 535 — gezet = aflever-GLN matcht geen vestiging (stille HQ-fallback). */
  afl_gln_ongekoppeld_sinds: string | null
  /** mig 535 — gezet = adres bewust vrijgegeven (heft de GLN-blokkade op). */
  afl_gln_gecontroleerd_op: string | null
  /** mig 396 — gezet = ≥1 regel €0. */
  prijs_ontbreekt_sinds: string | null
  /** Loopt er al een pickronde voor deze order? (zending in 'Picken'). */
  in_pickronde: boolean
  /**
   * Heeft deze order geen effectieve vervoerder? Door de caller geresolved uit
   * de vervoerder-regels via `heeftGeenVervoerder` — deze pure functie fetcht niet.
   */
  geen_vervoerder: boolean
}

export interface OrderStartbaarheid {
  order_id: number
  status: StartStatus
}

/**
 * Bepaalt de canonieke startbaarheid-status van één order. De prioriteit-volgorde
 * (in_pickronde > niet_pickbaar > afl_adres > prijs > geen_vervoerder > startbaar)
 * spiegelt de server-poort: zo telt — net als de knop sinds jaar en dag — een
 * niet-pickbare order in géén intake-/vervoerder-blokkade (die zijn "isPickbaar-
 * guarded" doordat ze lager staan), en komt een order alléén op `geen_vervoerder`
 * terecht als de vervoerder zijn énige resterende blocker is.
 */
export function bepaalStartbaarheid(o: StartbaarheidInput): OrderStartbaarheid {
  let status: StartStatus
  if (o.in_pickronde) status = 'in_pickronde'
  else if (!o.alle_regels_pickbaar && !o.heeft_gepland_zending) status = 'niet_pickbaar'
  else if (o.afl_adres_incompleet_sinds) status = 'afl_adres'
  else if (o.afl_gln_ongekoppeld_sinds && !o.afl_gln_gecontroleerd_op) status = 'afl_gln'
  else if (o.prijs_ontbreekt_sinds) status = 'prijs'
  else if (o.geen_vervoerder) status = 'geen_vervoerder'
  else status = 'startbaar'
  return { order_id: o.order_id, status }
}

/**
 * Eén definitie van "heeft geen effectieve vervoerder" (was 2× inline: in
 * `usePickbaarheid` en in `pick-overview`). Een niet-afhaal-order met ≥1
 * orderregel met `bron='geen'` (geen matchende actieve selectie-regel — bv. een
 * land vóór de vervoerder-cutover) heeft geen vervoerder. Afhaal-orders nooit.
 * `undefined` regels (resolutie nog niet geladen) → (nog) geen blokkade.
 */
export function heeftGeenVervoerder(
  afhalen: boolean,
  regels: ReadonlyArray<{ bron: string }> | undefined,
): boolean {
  if (afhalen) return false
  return regels?.some((r) => r.bron === 'geen') ?? false
}
