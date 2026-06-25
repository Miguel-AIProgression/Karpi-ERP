import { supabase } from '../client'
import { bepaalOrderAfleverdatum, type KlantLevertermijn } from '@/lib/orders/order-afleverdatum'
import { fetchOrderConfig } from './order-config'

export interface OrderFormData {
  debiteur_nr: number
  klant_referentie?: string
  afleverdatum?: string
  week?: string
  vertegenw_code?: string
  betaler?: number
  inkooporganisatie?: string
  fact_naam?: string
  fact_adres?: string
  fact_postcode?: string
  fact_plaats?: string
  fact_land?: string
  /** Mig 364: per-order snapshot van het factuur-e-mailadres. */
  fact_email?: string
  afl_naam?: string
  afl_naam_2?: string
  afl_adres?: string
  afl_postcode?: string
  afl_plaats?: string
  afl_land?: string
  /** Mig 084 (kolom) / mig 364 (RPC): per-order afleveradres-e-mailadres. */
  afl_email?: string
  /** Per-order keuze bij tekort. Default uit debiteuren.deelleveringen_toegestaan. NULL voor orders zonder tekort. */
  lever_modus?: 'deelleveringen' | 'in_een_keer' | null
  /** Klant haalt zelf af → UI onderdrukt automatische verzendkosten-regel; logistiek slaat vervoerder over. Mig 204. */
  afhalen?: boolean
  /** ADR 0014: 'week' = ergens binnen de leverweek (B2B-default), 'datum' = exact die afleverdatum (B2C). Mig 244. */
  lever_type?: 'week' | 'datum'
}

export interface OrderRegelFormData {
  id?: number
  artikelnr?: string
  karpi_code?: string
  omschrijving: string
  omschrijving_2?: string
  orderaantal: number
  te_leveren: number
  prijs?: number
  korting_pct: number
  bedrag?: number
  gewicht_kg?: number
  // Display-only fields (not sent to RPC)
  voorraad?: number
  vrije_voorraad?: number
  besteld_inkoop?: number
  klant_eigen_naam?: string
  klant_artikelnr?: string
  // Substitutie fields
  fysiek_artikelnr?: string
  fysiek_omschrijving?: string  // Display-only
  omstickeren?: boolean
  // Maatwerk fields
  is_maatwerk?: boolean
  maatwerk_vorm?: string
  maatwerk_lengte_cm?: number
  maatwerk_breedte_cm?: number
  maatwerk_afwerking?: string
  maatwerk_band_kleur?: string
  /** FK naar afwerking_kleuren.id — strict-key vanaf mig 194. */
  maatwerk_band_kleur_id?: number | null
  maatwerk_instructies?: string
  // Op-maat prijscomponenten (nieuw)
  maatwerk_m2_prijs?: number
  maatwerk_kostprijs_m2?: number
  maatwerk_oppervlak_m2?: number
  maatwerk_vorm_toeslag?: number
  maatwerk_afwerking_prijs?: number
  maatwerk_diameter_cm?: number
  maatwerk_kwaliteit_code?: string
  maatwerk_kleur_code?: string
  // Display-only: voorraad in m² (niet opgeslagen in DB)
  maatwerk_beschikbaar_m2?: number
  maatwerk_equiv_m2?: number
  /**
   * Handmatige allocatie-keuzes bij een voorraadtekort: gebruiker kiest zelf
   * hoeveel stuks via een uitwisselbaar product (omstickeren) en/of een
   * inkooporder (eigen of equivalent artikel) deze regel mag dekken — drie
   * optie-soorten, zie `allocatie_opties_voor_artikel` (mig 499/501). Niet
   * onderdeel van create_order_with_lines RPC — wordt na regel-INSERT via
   * set_allocatie_keuze-RPC gepersisteerd. Migratie 154, uitgebreid mig 497-500
   * (vervangt de automatische alias/IO-substitutie door een expliciete keuze).
   */
  uitwisselbaar_keuzes?: AllocatieKeuze[]
  /**
   * Display-only: of de prijs uit de klant-specifieke prijslijst komt (true)
   * of dat we zijn teruggevallen op `producten.verkoopprijs` (false). Wordt
   * niet opgeslagen — alleen voor UI-signalering aan de orderaanmaker dat
   * de getoonde prijs een fallback is. Issue #35.
   */
  prijs_uit_prijslijst?: boolean
  /**
   * Display-only: bron + breakdown van de via `bereken_orderregel_prijs`-RPC
   * (mig 191) bepaalde prijs. Wordt niet opgeslagen — voedt de UI-hint die
   * laat zien hoe een fallback-prijs is opgebouwd (m²-prijs × oppervlak +
   * vormtoeslag, etc.). Mig 190/191.
   */
  prijs_bron?: PrijsBron
  prijs_breakdown?: PrijsBreakdown
  /**
   * Display-only: admin-pseudo-flag van het gekoppelde product (mig 272,
   * ADR-0018). TRUE voor VERZEND/BUNDELKORTING/DREMPELKORTING — gevuld bij
   * artikel-selectie of bij form-load uit `producten.is_pseudo`. Gebruikt
   * door `isAdminPseudo(regel)` om dekking-preview, afleverdatum-filter
   * etc. te skippen. Wordt niet gepersisteerd; de DB leest het via JOIN
   * uit `producten.is_pseudo`.
   */
  is_pseudo?: boolean
  /**
   * Display-only: dropshipment-vlag van het gekoppelde product (mig 370,
   * ADR-0018-patroon). Gevuld door `applyDropshipmentLogic` (create) of de
   * order-edit-mapping (edit) uit `producten.is_dropship`. Gebruikt door
   * `isDropshipRegel`/`heeftDropshipRegel` voor de e-mail-validatie en
   * afl_email-defaults. Wordt niet gepersisteerd; de DB leest het via JOIN
   * (`is_dropship_order()`).
   */
  is_dropship?: boolean
  /** Mig 406: per-orderregel klantreferentie (bv. "REF Hugo / Veyron"). */
  klant_referentie?: string | null
}

/** Bronlabel voor de orderregel-prijs zoals geretourneerd door `bereken_orderregel_prijs` (mig 191, mig 253). */
export type PrijsBron =
  | 'prijslijst_vast'
  | 'product_vaste_verkoopprijs'
  | 'prijslijst_m2'
  | 'maatwerk_artikel_m2'
  | 'kwaliteit_m2'
  | 'product_verkoopprijs'
  | 'onbekend_artikel'
  | 'geen'

/** Vrij-vorm breakdown per fallback-tak. Aanwezigheid van velden hangt af van `bron`. */
export interface PrijsBreakdown {
  reden?: string
  prijslijst_nr?: string
  artikelnr?: string
  oppervlak_m2?: number
  m2_prijs?: number
  vorm_code?: string
  vorm_toeslag?: number
  maatwerk_artikel?: string
  kwaliteit_code?: string
}

export interface PrijsResolverResult {
  prijs: number | null
  bron: PrijsBron
  breakdown: PrijsBreakdown
}

/**
 * Eén handmatige allocatie-keuze: uitwisselbaar-equivalent op voorraad, óf een
 * inkooporder-claim (op het eigen artikel of op een equivalent) — de drie
 * optie-soorten uit `allocatie_opties_voor_artikel` (mig 499/501).
 *
 * `bron` is optioneel en valt terug op `'voorraad'` — back-compat met de
 * oorspronkelijke uitwisselbaar-keuze (mig 154), die altijd voorraad was en
 * dus nooit een `bron` droeg.
 */
export interface AllocatieKeuze {
  bron?: 'voorraad' | 'inkooporder_regel'
  artikelnr: string
  aantal: number
  omschrijving?: string
  inkooporder_regel_id?: number | null
  verwacht_datum?: string | null
}

/** Roept RPC `set_uitwisselbaar_claims` aan om handmatige uitwisselbaar-allocaties op een orderregel te zetten. Migratie 154. @deprecated geen nieuwe call-sites meer — gebruik `setAllocatieKeuze` (mig 500). */
export async function setUitwisselbaarClaims(
  orderRegelId: number,
  keuzes: { artikelnr: string; aantal: number }[],
) {
  const { error } = await supabase.rpc('set_uitwisselbaar_claims', {
    p_order_regel_id: orderRegelId,
    p_keuzes: keuzes,
  })
  if (error) throw error
}

/**
 * Roept RPC `set_allocatie_keuze` aan (mig 500): vervangt alle actieve claims
 * van de orderregel door de gegeven keuzes (handmatig, vergrendeld) en laat
 * het restant automatisch cascaderen via `herallocateer_orderregel_auto`.
 */
export async function setAllocatieKeuze(orderRegelId: number, keuzes: AllocatieKeuze[]) {
  const { error } = await supabase.rpc('set_allocatie_keuze', {
    p_order_regel_id: orderRegelId,
    p_keuzes: keuzes.map(k => ({
      bron: k.bron ?? 'voorraad',
      artikelnr: k.artikelnr,
      aantal: k.aantal,
      inkooporder_regel_id: k.inkooporder_regel_id ?? undefined,
    })),
  })
  if (error) throw error
}

/**
 * Roept RPC `ontgrendel_allocatie_keuze` aan (mig 500): release de handmatige
 * keuze van de orderregel en valt terug op de korte allocator-vorm (alleen
 * eigen voorraad) — bewust geen automatische herclaim van een equivalent/IO.
 */
export async function ontgrendelAllocatieKeuze(orderRegelId: number) {
  const { error } = await supabase.rpc('ontgrendel_allocatie_keuze', {
    p_order_regel_id: orderRegelId,
  })
  if (error) throw error
}

/**
 * Snapshot-context voor het schrijven van `orders.standaard_afleverdatum_berekend`
 * (Levertijd-Module, ADR-0020 / mig 276). Optioneel — als niet meegegeven, dan
 * berekenen we via `fetchOrderConfig()` zelf. Wanneer beide ontbreken slaan we
 * het schrijven over en blijft `levertijd_status = NULL` (legacy-pad).
 */
export interface LevertijdSnapshotContext {
  klant: KlantLevertermijn | null
}

/** Create order + lines atomically via RPC */
export async function createOrder(
  order: OrderFormData,
  regels: OrderRegelFormData[],
  snapshotCtx?: LevertijdSnapshotContext,
) {
  const p_order = {
    debiteur_nr: order.debiteur_nr,
    orderdatum: new Date().toISOString().split('T')[0],
    afleverdatum: order.afleverdatum || null,
    klant_referentie: order.klant_referentie || null,
    week: order.week || null,
    vertegenw_code: order.vertegenw_code || null,
    betaler: order.betaler || null,
    inkooporganisatie: order.inkooporganisatie || null,
    fact_naam: order.fact_naam || null,
    fact_adres: order.fact_adres || null,
    fact_postcode: order.fact_postcode || null,
    fact_plaats: order.fact_plaats || null,
    fact_land: order.fact_land || null,
    fact_email: order.fact_email || null,
    afl_naam: order.afl_naam || null,
    afl_naam_2: order.afl_naam_2 || null,
    afl_adres: order.afl_adres || null,
    afl_postcode: order.afl_postcode || null,
    afl_plaats: order.afl_plaats || null,
    afl_land: order.afl_land || null,
    afl_email: order.afl_email || null,
    lever_modus: order.lever_modus ?? null,
    afhalen: order.afhalen ?? false,
    lever_type: order.lever_type ?? 'week',
  }

  const p_regels = regels.map((r, i) => ({
    regelnummer: i + 1,
    artikelnr: r.artikelnr || null,
    karpi_code: r.karpi_code || null,
    omschrijving: r.omschrijving,
    omschrijving_2: r.omschrijving_2 || null,
    orderaantal: r.orderaantal,
    te_leveren: r.te_leveren,
    prijs: r.prijs ?? null,
    korting_pct: r.korting_pct,
    bedrag: r.bedrag ?? null,
    gewicht_kg: r.gewicht_kg ?? null,
    fysiek_artikelnr: r.fysiek_artikelnr || null,
    omstickeren: r.omstickeren ?? false,
    is_maatwerk: r.is_maatwerk ?? false,
    maatwerk_vorm: r.maatwerk_vorm || null,
    maatwerk_lengte_cm: r.maatwerk_lengte_cm ?? null,
    maatwerk_breedte_cm: r.maatwerk_breedte_cm ?? null,
    maatwerk_afwerking: r.maatwerk_afwerking || null,
    maatwerk_band_kleur: r.maatwerk_band_kleur || null,
    maatwerk_band_kleur_id: r.maatwerk_band_kleur_id ?? null,
    maatwerk_instructies: r.maatwerk_instructies || null,
    maatwerk_m2_prijs: r.maatwerk_m2_prijs ?? null,
    maatwerk_kostprijs_m2: r.maatwerk_kostprijs_m2 ?? null,
    maatwerk_oppervlak_m2: r.maatwerk_oppervlak_m2 ?? null,
    maatwerk_vorm_toeslag: r.maatwerk_vorm_toeslag ?? null,
    maatwerk_afwerking_prijs: r.maatwerk_afwerking_prijs ?? null,
    maatwerk_diameter_cm: r.maatwerk_diameter_cm ?? null,
    maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code || null,
    maatwerk_kleur_code: r.maatwerk_kleur_code || null,
    klant_referentie: r.klant_referentie || null,
  }))

  const { data, error } = await supabase.rpc('create_order_with_lines', {
    p_order: p_order,
    p_regels: p_regels,
  })

  if (error) throw error
  const created = data as { id: number; order_nr: string }

  // Levertijd-Module snapshot (ADR-0020 / mig 276): bereken de klant-standaard
  // afleverdatum en schrijf 'm één keer mee zodat de trigger uit mig 276 het
  // `levertijd_status`-label kan deriven uit afleverdatum vs snapshot.
  // Bewust een follow-up UPDATE — `create_order_with_lines`-RPC accepteert
  // het veld niet en uitbreiden van die RPC valt buiten scope (geen DB-changes
  // in deze stap).
  if (snapshotCtx) {
    const info = bepaalOrderAfleverdatum(regels, snapshotCtx.klant, await fetchOrderConfig())
    if (info.langsteDatum) {
      const { error: snapErr } = await supabase
        .from('orders')
        .update({ standaard_afleverdatum_berekend: info.langsteDatum })
        .eq('id', created.id)
      if (snapErr) {
        // Niet-blokkerend: snapshot ontbreekt ⇒ `levertijd_status` blijft NULL
        // (= geen badge). Order zelf is succesvol gemaakt.
        console.warn('[createOrder] kon levertijd-snapshot niet schrijven:', snapErr)
      }
    }
  }

  return created
}

/** Update order header + replace lines atomically via RPC */
export async function updateOrderWithLines(
  orderId: number,
  header: Partial<OrderFormData>,
  regels: OrderRegelFormData[],
  snapshotCtx?: LevertijdSnapshotContext,
) {
  const p_regels = regels.map((r, i) => ({
    id: r.id ?? null,
    regelnummer: i + 1,
    artikelnr: r.artikelnr || null,
    karpi_code: r.karpi_code || null,
    omschrijving: r.omschrijving,
    omschrijving_2: r.omschrijving_2 || null,
    orderaantal: r.orderaantal,
    te_leveren: r.te_leveren,
    prijs: r.prijs ?? null,
    korting_pct: r.korting_pct,
    bedrag: r.bedrag ?? null,
    gewicht_kg: r.gewicht_kg ?? null,
    fysiek_artikelnr: r.fysiek_artikelnr || null,
    omstickeren: r.omstickeren ?? false,
    is_maatwerk: r.is_maatwerk ?? false,
    maatwerk_vorm: r.maatwerk_vorm || null,
    maatwerk_lengte_cm: r.maatwerk_lengte_cm ?? null,
    maatwerk_breedte_cm: r.maatwerk_breedte_cm ?? null,
    maatwerk_afwerking: r.maatwerk_afwerking || null,
    maatwerk_band_kleur: r.maatwerk_band_kleur || null,
    maatwerk_band_kleur_id: r.maatwerk_band_kleur_id ?? null,
    maatwerk_instructies: r.maatwerk_instructies || null,
    maatwerk_m2_prijs: r.maatwerk_m2_prijs ?? null,
    maatwerk_kostprijs_m2: r.maatwerk_kostprijs_m2 ?? null,
    maatwerk_oppervlak_m2: r.maatwerk_oppervlak_m2 ?? null,
    maatwerk_vorm_toeslag: r.maatwerk_vorm_toeslag ?? null,
    maatwerk_afwerking_prijs: r.maatwerk_afwerking_prijs ?? null,
    maatwerk_diameter_cm: r.maatwerk_diameter_cm ?? null,
    maatwerk_kwaliteit_code: r.maatwerk_kwaliteit_code || null,
    maatwerk_kleur_code: r.maatwerk_kleur_code || null,
    klant_referentie: r.klant_referentie || null,
  }))

  const { error } = await supabase.rpc('update_order_with_lines', {
    p_order_id: orderId,
    p_header: header,
    p_regels: p_regels,
  })

  if (error) throw error

  // Levertijd-Module snapshot (ADR-0020 / mig 276): legacy-vul voor orders die
  // nog géén `standaard_afleverdatum_berekend` hebben (pre-mig 276 of door
  // create-pad zonder snapshotCtx aangemaakt). Immutable na commit — schrijft
  // alléén als de huidige waarde NULL is.
  if (snapshotCtx) {
    const { data: huidig, error: leesErr } = await supabase
      .from('orders')
      .select('standaard_afleverdatum_berekend')
      .eq('id', orderId)
      .single()
    if (!leesErr && huidig && (huidig as { standaard_afleverdatum_berekend: string | null }).standaard_afleverdatum_berekend === null) {
      const info = bepaalOrderAfleverdatum(regels, snapshotCtx.klant, await fetchOrderConfig())
      if (info.langsteDatum) {
        const { error: snapErr } = await supabase
          .from('orders')
          .update({ standaard_afleverdatum_berekend: info.langsteDatum })
          .eq('id', orderId)
        if (snapErr) {
          console.warn('[updateOrderWithLines] kon legacy levertijd-snapshot niet zetten:', snapErr)
        }
      }
    }
  }
}

/** Delete order, its lines, and recalculate stock reservations via RPC */
export async function deleteOrder(orderId: number) {
  const { error } = await supabase.rpc('delete_order', {
    p_order_id: orderId,
  })

  if (error) throw error
}

/**
 * Bevestig de (onzekere) debiteur van een order (mig 322). Zet debiteur_zeker=true
 * zodat de order uit de "Debiteur te bevestigen"-banner/-filter verdwijnt. Klopt
 * de gegokte debiteur niet, dan corrigeert de operator hem via order-bewerken
 * (de debiteur-keuze daar) — dat is een aparte, zwaardere mutatie. Deze actie
 * legt alleen de bevestiging vast; de match-bron blijft als audit bewaard.
 */
export async function bevestigDebiteur(orderId: number) {
  const { error } = await supabase
    .from('orders')
    .update({ debiteur_zeker: true })
    .eq('id', orderId)

  if (error) throw error
}

/**
 * Zet/wist de handmatige express-vlag (mig 450, Fase 2) — hoogste
 * sorteerprioriteit in de snijplanner (sortPieces). De caller triggert
 * daarna zelf auto-plan-groep voor de relevante (kwaliteit, kleur)-groepen
 * (zie fetchMaatwerkGroepenVoorOrder) zodat de heroptimalisatie meteen
 * plaatsvindt i.p.v. te wachten op de volgende reguliere trigger.
 */
export async function setExpress(orderId: number, express: boolean) {
  const { error } = await supabase
    .from('orders')
    .update({ express })
    .eq('id', orderId)

  if (error) throw error
}

/**
 * Unieke (kwaliteit_code, kleur_code)-paren van de maatwerk-regels op een
 * order — voor het triggeren van auto-plan-groep na een express-toggle.
 * Spiegelt order-form.tsx's triggerAutoplanForMaatwerk, maar leest hier de
 * al-opgeslagen regels rechtstreeks op i.p.v. uit form-state.
 */
export async function fetchMaatwerkGroepenVoorOrder(
  orderId: number,
): Promise<Array<{ kwaliteit_code: string; kleur_code: string }>> {
  const { data, error } = await supabase
    .from('order_regels')
    .select('producten!order_regels_artikelnr_fkey(kwaliteit_code, kleur_code)')
    .eq('order_id', orderId)
    .eq('is_maatwerk', true)

  if (error) throw error

  // Many-to-one embed: runtime geeft een object, PostgREST-types inferreren
  // een array (zelfde mismatch als elders bij snijplannen→order_regels).
  type ProductEmbed = { kwaliteit_code: string; kleur_code: string | null }
  function unwrapEmbed(v: ProductEmbed | ProductEmbed[] | null | undefined): ProductEmbed | null {
    if (Array.isArray(v)) return v[0] ?? null
    return v ?? null
  }

  const seen = new Set<string>()
  const out: Array<{ kwaliteit_code: string; kleur_code: string }> = []
  for (const row of (data ?? []) as unknown as Array<{ producten: ProductEmbed | ProductEmbed[] | null }>) {
    const product = unwrapEmbed(row.producten)
    if (!product?.kwaliteit_code || !product.kleur_code) continue
    const key = `${product.kwaliteit_code}|${product.kleur_code}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kwaliteit_code: product.kwaliteit_code, kleur_code: product.kleur_code })
  }
  return out
}

/** Lookup price for an article in a client's price list */
export async function lookupPrice(prijslijstNr: string, artikelnr: string): Promise<number | null> {
  const { data, error } = await supabase
    .from('prijslijst_regels')
    .select('prijs')
    .eq('prijslijst_nr', prijslijstNr)
    .eq('artikelnr', artikelnr)
    .maybeSingle()

  if (error) throw error
  return data?.prijs ?? null
}

/**
 * Resolver voor orderregel-prijs (mig 191). Roept SQL-RPC `bereken_orderregel_prijs`
 * aan die de fallback-keten doet:
 *   1. prijslijst_vast       — vaste prijs in `prijslijst_regels`
 *   2. prijslijst_m2         — m²-prijs uit prijslijst via maatwerk-artikel × oppervlak + vormtoeslag
 *   3. maatwerk_artikel_m2   — `producten.verkoopprijs` van maatwerk-artikel × oppervlak + vormtoeslag
 *   4. kwaliteit_m2          — `maatwerk_m2_prijzen.verkoopprijs_m2` × oppervlak + vormtoeslag
 *   5. product_verkoopprijs  — eigen `producten.verkoopprijs`
 *   6. geen                  — niets gevonden
 *
 * Vormtoeslag komt uit `maatwerk_vormen.toeslag` via `producten.maatwerk_vorm_code` (mig 190).
 * `prijslijstNr` mag NULL zijn — dan worden de prijslijst-stappen overgeslagen.
 */
export async function resolveOrderlinePrice(
  artikelnr: string,
  prijslijstNr: string | null,
): Promise<PrijsResolverResult> {
  const { data, error } = await supabase.rpc('bereken_orderregel_prijs', {
    p_artikelnr: artikelnr,
    p_prijslijst_nr: prijslijstNr,
  })

  if (error) throw error
  // RPC retourneert JSONB; supabase-js geeft het als object terug.
  const result = data as { prijs: number | null; bron: PrijsBron; breakdown: PrijsBreakdown }
  return {
    prijs:     result?.prijs ?? null,
    bron:      result?.bron ?? 'geen',
    breakdown: result?.breakdown ?? {},
  }
}

/** Fetch klant artikelnummer for an article + customer */
export async function fetchKlantArtikelnummer(debiteurNr: number, artikelnr: string) {
  const { data, error } = await supabase
    .from('klant_artikelnummers')
    .select('klant_artikel, omschrijving')
    .eq('debiteur_nr', debiteurNr)
    .eq('artikelnr', artikelnr)
    .maybeSingle()

  if (error) throw error
  return data as { klant_artikel: string; omschrijving: string | null } | null
}

/** Fetch prijslijst_nr and korting_pct for a debiteur (needed in edit mode) */
export async function fetchClientCommercialData(debiteurNr: number) {
  const { data, error } = await supabase
    .from('debiteuren')
    .select('prijslijst_nr, korting_pct, gratis_verzending, verzendkosten, verzend_drempel, standaard_maat_werkdagen, maatwerk_weken, deelleveringen_toegestaan, default_lever_type, email_factuur, email_overig, email_verzend, email_pakbon, afleverwijze')
    .eq('debiteur_nr', debiteurNr)
    .single()

  if (error) throw error
  return data as { prijslijst_nr: string | null; korting_pct: number; gratis_verzending: boolean; verzendkosten: number; verzend_drempel: number; standaard_maat_werkdagen: number | null; maatwerk_weken: number | null; deelleveringen_toegestaan: boolean; default_lever_type: 'week' | 'datum'; email_factuur: string | null; email_overig: string | null; email_verzend: string | null; email_pakbon: string | null; afleverwijze: string | null }
}

/** Update only the afwerking (+ optional band_kleur) on a single order_regel — used for locked orders where
 *  everything else is immutable but afwerking was still pending. */
export async function updateRegelAfwerking(
  regelId: number,
  afwerking: string,
  bandKleur: string | null,
) {
  const { error } = await supabase
    .from('order_regels')
    .update({
      maatwerk_afwerking: afwerking,
      maatwerk_band_kleur: bandKleur,
    })
    .eq('id', regelId)

  if (error) throw error
}
