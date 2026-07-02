import { supabase } from '../client'
import { sanitizeSearch } from '@/lib/utils/sanitize'
import { fetchKlanteigenNamenMap } from '@/modules/debiteuren'
import { filterDebiteurTeBevestigen } from '@/lib/orders/intake-predicaten'
import { filterLeverweekTeBevestigen } from '@/lib/orders/edi-leverweek'
import { filterAfleveradresIncompleet } from '@/lib/orders/afleveradres-gate'
import { filterPrijsOntbreekt } from '@/lib/orders/prijs-ontbreekt'
import { filterGeenVerzendweek } from '@/lib/orders/geen-verzendweek'
import { filterVerzendweekVerstreken } from '@/lib/orders/verzendweek-verstreken'
import { filterMancoMarker } from '@/lib/orders/manco-marker'
import { filterPickBackorder } from '@/lib/orders/pick-backorder'

export interface OrderRow {
  id: number
  order_nr: string
  oud_order_nr: number | null
  debiteur_nr: number
  klant_referentie: string | null
  orderdatum: string
  afleverdatum: string | null
  status: string
  aantal_regels: number
  totaal_bedrag: number
  totaal_gewicht: number
  vertegenw_code: string | null
  klant_naam?: string
  heeft_unmatched_regels?: boolean
  bron_systeem?: string | null
  bron_shop?: string | null
  /** EDI (mig 158): tijdstip waarop de leverweek/orderbev bevestigd is. NULL = te bevestigen. */
  edi_bevestigd_op?: string | null
  /** EDI (mig 309): door de partner gewenste leverdatum (snapshot). NULL voor niet-EDI. */
  edi_gewenste_afleverdatum?: string | null
  /** Mig 322: FALSE = debiteur via onzekere (fuzzy) strategie geraden → te bevestigen. */
  debiteur_zeker?: boolean
  /** Mig 322: welke strategie de debiteur bepaalde (bv. company_name_ilike, env_fallback). */
  debiteur_match_bron?: string | null
  /** ADR 0014 / mig 244 — overzicht toont 'Wk X · YYYY' bij 'week', dag-badge bij 'datum'. */
  lever_type?: 'week' | 'datum'
  /** ADR-0016 / mig 259 — bundel-info uit zending_orders M2M. NULL voor solo-orders. */
  bundel_zending_id?: number | null
  bundel_zending_nr?: string | null
  bundel_order_count?: number | null
  /**
   * ADR-0027 / Ingreep 5 — TRUE als de order in de laatste 30 dagen een
   * `order_events`-rij heeft met `event_type='deadline_conflict_na_swap'`.
   * Wordt in `fetchOrders` per pagina-batch in één extra query opgehaald
   * (geen N+1) en als vlag op de OrderRow geplakt. UI toont rode chip.
   * Wanneer `order_events` door RLS niet leesbaar is, blijft de vlag FALSE.
   */
  heeft_deadline_conflict_na_swap?: boolean
  /** Datum van het laatste deadline_conflict_na_swap-event (ISO), voor tooltip. */
  deadline_conflict_na_swap_at?: string | null
  /**
   * Mig 326: tijdstip van de laatst gedetecteerde levertijd-wijziging door een
   * leverancier/Karpi-ETA-update (sync_order_afleverdatum_eta), nog niet
   * herbevestigd aan de klant. NULL = niets open. Spiegelt
   * isLevertijdWijzigingTeBevestigen / het 'Levertijd gewijzigd'-tab-predicaat.
   */
  levertijd_wijziging_te_bevestigen_sinds?: string | null
  /** Mig 335: tijdstip waarop de orderbevestiging per e-mail is verstuurd. NULL = nog niet bevestigd. */
  bevestigd_at?: string | null
  /**
   * Mig 395: tijdstip waarop gedetecteerd is dat het afleveradres-snapshot
   * onvolledig is (niet-afhaal-order, naam/adres/postcode/plaats leeg). NULL =
   * compleet. Spiegelt isAfleveradresIncompleet / het 'Afleveradres ontbreekt'-tab.
   */
  afl_adres_incompleet_sinds?: string | null
  /**
   * Mig 396: tijdstip waarop gedetecteerd is dat ≥1 normale regel (niet pseudo,
   * niet VERZEND, korting < 100%) een prijs van €0/NULL heeft. NULL = geen
   * ontbrekende prijs of bewust geaccepteerd. Spiegelt isPrijsOntbreekt / het
   * 'Prijs ontbreekt'-tab.
   */
  prijs_ontbreekt_sinds?: string | null
  /**
   * Mig 535: tijdstip waarop gedetecteerd is dat de aflever-GLN van een
   * EDI-order geen vestiging matcht (create_edi_order viel terug op het
   * debiteur-hoofdadres). NULL = gekoppeld/n.v.t. Spiegelt
   * isAfleveradresGlnGeblokkeerd; blokkeert de pick-start.
   */
  afl_gln_ongekoppeld_sinds?: string | null
  /** Mig 535: gezet = adres bewust vrijgegeven (markeer_afleveradres_gecontroleerd). */
  afl_gln_gecontroleerd_op?: string | null
  /**
   * Mig 450 (Fase 2): handmatige vlag (planner/verkoper) — hoogste
   * sorteerprioriteit in de snijplanner (sortPieces). Optional zodat oude
   * cache-data zonder deze kolom niet crasht; default-render = false.
   */
  express?: boolean
  /**
   * Mig 518: permanente manco-markering — gezet bij de eerste niet-gevonden
   * colli op deze order, nooit gewist (ook na Verzonden zichtbaar). Voedt de
   * 'Had mankement'-tab + de manco-badge op de orderrij. Optional zodat oude
   * cache-data zonder deze kolom niet crasht.
   */
  manco_sinds?: string | null
  /**
   * Mig 563 (ADR-0039/0040): grootte van de Combi-levering-groep (debiteur x
   * afleveradres) waar deze order deel van is. NULL/undefined of < 2 = geen
   * bundel, geen badge. Los van de fysieke zending-bundel (bundel_zending_nr
   * hierboven) — dit is de vóór-verzending financiële groepering op de
   * vrachtvrije-drempel.
   */
  combi_levering_aantal_orders?: number | null
  /** Mig 563: TRUE zolang de groep de vrachtvrije-drempel nog niet haalt. */
  wacht_op_combi_levering?: boolean | null
  /** Mig 563: overige orders in dezelfde Combi-levering-groep, voor de badge-tooltip/links. */
  combi_levering_andere_orders?: { id: number; order_nr: string }[] | null
}

export interface OrderDetail extends OrderRow {
  /** Mig 524: TRUE = retroactieve order, direct als Verzonden aangemaakt. */
  is_achteraf?: boolean
  week: string | null
  fact_naam: string | null
  fact_adres: string | null
  fact_postcode: string | null
  fact_plaats: string | null
  fact_land: string | null
  fact_email: string | null
  afl_naam: string | null
  afl_naam_2: string | null
  afl_adres: string | null
  afl_postcode: string | null
  afl_plaats: string | null
  afl_land: string | null
  afl_email: string | null
  afl_telefoon: string | null
  /** Mig 306/535: aflever-GLN-snapshot uit het EDI-bericht. */
  afleveradres_gln: string | null
  opmerkingen: string | null
  betaler: number | null
  inkooporganisatie: string | null
  compleet_geleverd: boolean
  vertegenw_naam?: string
  lever_modus: 'deelleveringen' | 'in_een_keer' | null
  afhalen: boolean
  /** Mig 550/ADR-0039: klant wil dít exemplaar toch los verzonden, met
   *  verzendkosten, ongeacht debiteuren.combi_levering. */
  combi_levering_override: boolean
  /** ADR 0014 / mig 244: 'week' = ergens binnen de leverweek (B2B-default);
   *  'datum' = specifieke leverdag-belofte (B2C, prominentere weergave + striktere
   *  pick-horizon + snij-prioriteit). */
  lever_type: 'week' | 'datum'
  verzonden_at: string | null
  bevestigd_at: string | null
  bevestigd_door: string | null
  bevestiging_email: string | null
  klant_email: string | null
  /** Default-ontvanger voor de orderbevestiging: email_overig → email_factuur.
   *  Bewust ANDERSOM dan klant_email (factuur-eerst, voedt o.a. de dropship-
   *  check): de bevestiging hoort naar het algemene/orderbevestiging-adres,
   *  niet naar het factuuradres (melding Marjon 11-06-2026, klant 803741). */
  klant_email_orderbev: string | null
  /** Pakbon-bestemming op klantniveau (debiteuren.email_pakbon, mig 496). NULL =
   *  geen apart adres → de weergave valt terug op het factuuradres. De aparte
   *  pakbonmail (factuur-verzenden) gebruikt dezelfde terugval. */
  klant_email_pakbon: string | null
  /** Mig 327 / ADR-0029: TRUE = productie-only order uit Basta (alleen snijden+
   *  confectie in RugFlow; verzending/facturatie in Basta). Voedt het
   *  BastaAfhandelingPaneel op order-detail. Voor gewone orders FALSE. */
  alleen_productie: boolean
}

export interface OrderRegelSnijplan {
  id: number
  snijplan_nr: string
  status: string
  scancode: string
  locatie: string | null
  /** Mig-overzicht: alleen gevuld zodra het stuk daadwerkelijk op een rol
   *  geplaatst is. status='Gepland' zonder rol_id betekent "in de wachtrij/
   *  tekort-pool", géén echte planning op een specifieke dag/rol. */
  rol_id: number | null
  rolnummer: string | null
}

export interface OrderRegel {
  id: number
  regelnummer: number
  artikelnr: string | null
  karpi_code: string | null
  omschrijving: string
  omschrijving_2: string | null
  orderaantal: number
  te_leveren: number
  backorder: number
  prijs: number | null
  korting_pct: number
  bedrag: number | null
  gewicht_kg: number | null
  /** Vrije voorraad van het gekoppelde product (producten.vrije_voorraad via join,
   *  niet de ongebruikte order_regels-kolom). Voedt de Order-hydratie. */
  vrije_voorraad: number | null
  /** Totale fysieke voorraad (producten.voorraad via join) — voor het onderscheid
   *  "0 vrij maar wél 28 stuks op voorraad (alles gereserveerd)" vs. "echt 0". */
  voorraad?: number | null
  /** Openstaande inkoop van het gekoppelde product (producten.besteld_inkoop via join). */
  besteld_inkoop?: number | null
  klant_eigen_naam?: string | null
  klant_artikelnr?: string | null
  /** Admin-pseudo-flag (mig 272 / ADR-0018) — gemapt uit producten.is_pseudo via join. */
  is_pseudo?: boolean
  /** Dropshipment-vlag (mig 370 / ADR-0018) — gemapt uit producten.is_dropship via join. */
  is_dropship?: boolean
  // Substitutie
  fysiek_artikelnr?: string | null
  omstickeren?: boolean
  fysiek_omschrijving?: string | null
  // Maatwerk
  is_maatwerk?: boolean
  maatwerk_vorm?: string | null
  maatwerk_lengte_cm?: number | null
  maatwerk_breedte_cm?: number | null
  maatwerk_diameter_cm?: number | null
  maatwerk_afwerking?: string | null
  maatwerk_band_kleur?: string | null
  maatwerk_instructies?: string | null
  maatwerk_m2_prijs?: number | null
  maatwerk_oppervlak_m2?: number | null
  maatwerk_vorm_toeslag?: number | null
  maatwerk_afwerking_prijs?: number | null
  // Productie tracking
  snijplannen?: OrderRegelSnijplan[]
  /** Handmatige verzendweek-override (mig 334). NULL = auto in frontend. */
  verzendweek?: string | null
  /** Herkomst van `verzendweek` (mig 469): 'handmatig' | 'automatisch_voorraad' | null. */
  verzendweek_bron?: string | null
  /** Mig 406: per-orderregel klantreferentie. */
  klant_referentie?: string | null
  /** Mig 524: vrije omschrijvingsregel zonder artikelnr (geen voorraad, geen pick). */
  is_vrije_regel?: boolean
  /** Actieve voorraad-claims van DIT order op deze regel (order_reserveringen bron='voorraad', status='actief').
   *  Voedt de "N× gereserveerd voor dit order"-notitie in order-line-editor.tsx.
   *  NULL = niet opgehaald (o.a. bij nieuwe orders). */
  eigen_voorraad_actief?: number
  /** Mig 412: vroegste verzenddatum voor deze regel op basis van actieve claims.
   * NULL = geen dekking of maatwerk. CURRENT_DATE of later = beschikbaar. */
  vroegst_leverbaar?: string | null
  /** Mig 518: open manco (niet gevonden tijdens picken, wacht op binnendienst).
   *  NOT NULL + geannuleerd_op NULL = open manco. */
  pick_backorder_sinds?: string | null
  /** Mig 518: manco afgesloten als niet-leverbaar (DE/buitenland). NOT NULL =
   *  regel definitief niet geleverd op deze order. */
  pick_backorder_geannuleerd_op?: string | null
  /** Kwaliteit/kleur + afmetingen van het gekoppelde product (producten-join) —
   *  voedt o.a. "omzetten naar maatwerk" (mig 472, prefill + kandidaat-rollen-lookup). */
  product_kwaliteit_code?: string | null
  product_kleur_code?: string | null
  product_lengte_cm?: number | null
  product_breedte_cm?: number | null
}

export interface StatusCount {
  status: string
  aantal: number
}

export type OrderSortField = 'orderdatum' | 'afleverdatum' | 'klant_naam' | 'totaal_bedrag' | 'aantal_regels' | 'order_nr' | 'status'
export type SortDirection = 'asc' | 'desc'

/** Fetch orders with client name, optionally filtered by status or debiteur */
export async function fetchOrders(params: {
  status?: string
  search?: string
  debiteurNr?: number
  debiteurNrs?: number[]
  bronSystemen?: string[]
  page?: number
  pageSize?: number
  sortBy?: OrderSortField
  sortDir?: SortDirection
}) {
  const { status, search, debiteurNr, debiteurNrs, bronSystemen, page = 0, pageSize = 50, sortBy = 'orderdatum', sortDir = 'desc' } = params

  let query = supabase
    .from('orders_list')
    .select('*', { count: 'exact' })
    // afleverdatum (= Verzendweek): NULLs altijd onderaan ongeacht richting;
    // PostgreSQL-default is NULLS FIRST voor DESC, waardoor orders zonder datum
    // boven alles zouden staan — niet wat de gebruiker verwacht.
    .order(sortBy, { ascending: sortDir === 'asc', nullsFirst: sortBy === 'afleverdatum' ? false : undefined })
    // Tiebreaker: id is monotoon stijgend (auto-increment) → bij gelijke
    // sort-waarde (typisch: meerdere orders op dezelfde orderdatum) komt de
    // laatst-aangemaakte order bovenaan. orders heeft geen aangemaakt_op
    // kolom, dus id DESC is de pragmatische proxy. Zie issue #34.
    .order('id', { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1)

  if (status === 'Actie vereist') {
    // Union: 'Wacht op voorraad' / 'Wacht op inkoop' (blocking-fases uit
    // ADR-0016) + webshop-orders met ≥1 regel zonder artikelnr-koppeling.
    // Legacy 'Actie vereist' status (mig 144 timeframe) wordt ook nog
    // herkend voor historische data.
    query = query.or(
      'status.eq.Wacht op voorraad,status.eq.Wacht op inkoop,status.eq.Actie vereist,heeft_unmatched_regels.eq.true'
    )
  } else if (status === 'Te bevestigen') {
    // EDI-orders waarvan de leverweek nog bevestigd moet worden (mig 309).
    // Status-overstijgend: filtert op bron + ontbrekende bevestiging.
    // Geannuleerde orders uitgesloten: die hoeven geen leverweek-bevestiging
    // (annuleren vereist geen bevestiging, dus edi_bevestigd_op blijft NULL).
    query = filterLeverweekTeBevestigen(query)
  } else if (status === 'Debiteur te bevestigen') {
    // Mig 322: orders waarvan de debiteur via een onzekere fuzzy strategie
    // geraden is. env_fallback (verzameldebiteur) is bewust géén fout en valt
    // af. Status-overstijgend; geannuleerde orders uitgesloten. De bron-OR is
    // NULL-safe: een onzekere order zonder vastgelegde bron telt mee (alleen
    // expliciet env_fallback valt af) — anders zou hij stil uit beeld vallen,
    // wat de "geen order verloren"-garantie ondermijnt. Spiegelt de JS-conditie
    // op order-detail én countTeBevestigenDebiteurOrders.
    query = filterDebiteurTeBevestigen(query)
  } else if (status === 'Levertijd gewijzigd') {
    // Mig 326: orders waarvan de levertijd is verschoven (andere ISO-leverweek)
    // door een leverancier/Karpi-ETA-update op een gekoppelde inkooporderregel,
    // en die nog niet handmatig aan de klant zijn herbevestigd. Status-overstijgend;
    // de gate is een enkele nullable timestamp (NULL = niets open) zodat dit met
    // een simpele .not(...is.null) filterbaar is — spiegelt isLevertijdWijzigingTeBevestigen.
    query = query
      .not('levertijd_wijziging_te_bevestigen_sinds', 'is', null)
      .not('status', 'in', '("Verzonden","Geannuleerd")')
  } else if (status === 'Afleveradres ontbreekt') {
    // Mig 395: orders met een onvolledig afleveradres-snapshot dat eerst
    // aangevuld moet worden (geen labels zonder adres). Status-overstijgend;
    // de gate is een enkele nullable timestamp (NULL = compleet). Spiegelt
    // isAfleveradresIncompleet en de DB-trigger fn_orders_afl_adres_gate.
    query = filterAfleveradresIncompleet(query)
  } else if (status === 'Prijs ontbreekt') {
    // Mig 396: orders met ≥1 regel zonder prijs (€0/NULL) die gecorrigeerd of
    // bewust bevestigd moet worden. Status-overstijgend; nullable timestamp
    // (NULL = geen probleem / geaccepteerd). Spiegelt isPrijsOntbreekt en de
    // DB-trigger fn_order_regels_prijs_gate.
    query = filterPrijsOntbreekt(query)
  } else if (status === 'Geen verzendweek') {
    // Orders waarvan afleverdatum NULL is — geen weekindeling mogelijk in
    // Pick & Ship. Aanleiding: EDI-orders van SB MÖBEL BOSS / OSTERMANN kwamen
    // binnen zonder afleverdatum (2026-06-24). Productie-only orders (Basta)
    // worden uitgesloten (verzending via Basta, ADR-0029).
    query = filterGeenVerzendweek(query)
  } else if (status === 'Verzendweek verstreken') {
    // Orders waarvan de afleverdatum (verzendweek) in het verleden ligt maar die
    // nog niet (deels) verzonden zijn — achterstallige verzendingen. De caller
    // sorteert op afleverdatum oplopend zodat de langst-over-tijd order bovenaan
    // staat. Spiegelt isVerzendweekVerstreken.
    query = filterVerzendweekVerstreken(query)
  } else if (status === 'Had mankement') {
    // Mig 518: orders waarop ooit een manco (niet-gevonden colli tijdens het
    // picken) is gedetecteerd. Status-overstijgend én historisch — blijft ook
    // zichtbaar nadat de order Verzonden is. Spiegelt isMancoMarker.
    query = filterMancoMarker(query)
  } else if (status === 'Manco') {
    // De 'Manco'-tab toont de regel-niveau werklijst (MancoTab), niet de
    // orderlijst — geef hier bewust niets terug zodat de (ongebruikte) tabel
    // leeg blijft als de query toch draait.
    query = query.eq('id', -1)
  } else if (status && status !== 'Alle') {
    query = query.eq('status', status)
  }

  if (debiteurNrs && debiteurNrs.length > 0) {
    query = query.in('debiteur_nr', debiteurNrs)
  } else if (debiteurNr) {
    query = query.eq('debiteur_nr', debiteurNr)
  }

  if (search) {
    const s = sanitizeSearch(search)
    if (s) {
      // Productie-only orders (Basta) zoekbaar op hun oude Basta-ordernummer.
      // `oud_order_nr` is een BIGINT — exact-match alleen toevoegen bij een
      // puur-numerieke term, anders gooit PostgREST een typefout op de kolom.
      const numeriek = /^\d+$/.test(s) ? s : null
      const orFilter = numeriek
        ? `order_nr.ilike.%${s}%,klant_referentie.ilike.%${s}%,klant_naam.ilike.%${s}%,oud_order_nr.eq.${numeriek}`
        : `order_nr.ilike.%${s}%,klant_referentie.ilike.%${s}%,klant_naam.ilike.%${s}%`
      query = query.or(orFilter)
    }
  }

  if (bronSystemen && bronSystemen.length > 0) {
    // 'handmatig' is de UI-sleutel voor NULL of expliciet 'handmatig' in de DB.
    const heeftHandmatig = bronSystemen.includes('handmatig')
    const overige = bronSystemen.filter((b) => b !== 'handmatig')
    const orParts: string[] = []
    if (heeftHandmatig) orParts.push('bron_systeem.is.null', 'bron_systeem.eq.handmatig')
    for (const b of overige) orParts.push(`bron_systeem.eq.${b}`)
    query = query.or(orParts.join(','))
  }

  const { data, error, count } = await query

  if (error) throw error

  const orders = (data ?? []) as OrderRow[]

  // ADR-0027 / Ingreep 5 — verrijk de pagina-batch met de
  // `deadline_conflict_na_swap`-vlag in één extra query (geen N+1).
  // Tijdsvenster: laatste 30 dagen. Bij meerdere events per order pakken
  // we de meest recente (sorteren op created_at DESC). Faalt deze query
  // (bv. RLS-blokker), dan loggen we maar laten de orders-lijst staan —
  // de chip wordt simpelweg niet getoond.
  if (orders.length > 0) {
    const orderIds = orders.map((o) => o.id)
    const sinds = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const { data: events, error: eventsError } = await supabase
      .from('order_events')
      .select('order_id, created_at')
      .eq('event_type', 'deadline_conflict_na_swap')
      .in('order_id', orderIds)
      .gte('created_at', sinds)
      .order('created_at', { ascending: false })

    if (eventsError) {
      // Niet fataal — orders blijven zichtbaar zonder vlag. Bv. RLS-blokker
      // op order_events SELECT-pad; rapport zou dan een SELECT-policy of
      // RPC-laag voorstellen.
      console.warn(
        '[fetchOrders] kon deadline_conflict_na_swap-events niet ophalen',
        eventsError,
      )
    } else {
      const laatsteConflictPerOrder = new Map<number, string>()
      for (const ev of (events ?? []) as { order_id: number; created_at: string }[]) {
        // ASC false op .order, dus eerste hit per order_id is de meest recente.
        if (!laatsteConflictPerOrder.has(ev.order_id)) {
          laatsteConflictPerOrder.set(ev.order_id, ev.created_at)
        }
      }
      for (const o of orders) {
        const conflictAt = laatsteConflictPerOrder.get(o.id)
        if (conflictAt) {
          o.heeft_deadline_conflict_na_swap = true
          o.deadline_conflict_na_swap_at = conflictAt
        }
      }
    }
  }

  return { orders, totalCount: count ?? 0 }
}

export interface StatusCountResult {
  counts: StatusCount[]
  /** Totaal unieke orders: som van orders_status_telling VOOR extra cross-cutting
   *  buckets worden toegevoegd. Gebruik dit voor de 'Alle'-badge — de optelsom
   *  van counts geeft dubbeltelling door de heeft_unmatched_regels-component van
   *  'Actie vereist' en de status-overstijgende tabs (Te bevestigen, etc.). */
  totalOrders: number
}

/** Fetch status counts for tabs. "Actie vereist" wordt aangevuld met orders
 * die heeft_unmatched_regels=true hebben (webshop-review), zodat die tab
 * altijd reflecteert wat er in de lijst verschijnt bij selectie.
 */
export async function fetchStatusCounts(): Promise<StatusCountResult> {
  const [
    tellingRes,
    unmatchedRes,
    teBevestigenRes,
    debiteurTeBevestigenRes,
    levertijdGewijzigdRes,
    aflAdresOntbreektRes,
    prijsOntbreektRes,
    geenVerzendweekRes,
    verzendweekVerstrekenRes,
    mancoRes,
    hadMankementRes,
  ] = await Promise.all([
    supabase.from('orders_status_telling').select('status, aantal'),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('heeft_unmatched_regels', true)
      .neq('status', 'Actie vereist'),
    filterLeverweekTeBevestigen(
      supabase.from('orders').select('id', { count: 'exact', head: true }),
    ),
    countTeBevestigenDebiteurOrders(),
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .not('levertijd_wijziging_te_bevestigen_sinds', 'is', null)
      .not('status', 'in', '("Verzonden","Geannuleerd")'),
    filterAfleveradresIncompleet(
      supabase.from('orders').select('id', { count: 'exact', head: true }),
    ),
    filterPrijsOntbreekt(
      supabase.from('orders').select('id', { count: 'exact', head: true }),
    ),
    filterGeenVerzendweek(
      supabase.from('orders').select('id', { count: 'exact', head: true }),
    ),
    // 'Verzendweek verstreken' = afleverdatum in het verleden, nog niet (deels) verzonden.
    filterVerzendweekVerstreken(
      supabase.from('orders').select('id', { count: 'exact', head: true }),
    ),
    // Mig 518: 'Manco' = open manco-werklijst (regel-niveau, open backorders).
    filterPickBackorder(
      supabase.from('order_regels').select('id', { count: 'exact', head: true }),
    ),
    // Mig 518: 'Had mankement' = orders met een (historische) manco-markering.
    filterMancoMarker(
      supabase.from('orders').select('id', { count: 'exact', head: true }),
    ),
  ])

  if (tellingRes.error) throw tellingRes.error

  const counts = (tellingRes.data ?? []) as StatusCount[]
  // Bewaar het echte totaal VOOR de cross-cutting extras erbij komen.
  const totalOrders = counts.reduce((sum, c) => sum + (c.aantal ?? 0), 0)
  const extraUnmatched = unmatchedRes.count ?? 0

  if (extraUnmatched > 0) {
    const existing = counts.find((c) => c.status === 'Actie vereist')
    if (existing) existing.aantal += extraUnmatched
    else counts.push({ status: 'Actie vereist', aantal: extraUnmatched })
  }

  const teBevestigen = teBevestigenRes.count ?? 0
  if (teBevestigen > 0) {
    counts.push({ status: 'Te bevestigen', aantal: teBevestigen })
  }

  if (debiteurTeBevestigenRes > 0) {
    counts.push({ status: 'Debiteur te bevestigen', aantal: debiteurTeBevestigenRes })
  }

  const levertijdGewijzigd = levertijdGewijzigdRes.count ?? 0
  if (levertijdGewijzigd > 0) {
    counts.push({ status: 'Levertijd gewijzigd', aantal: levertijdGewijzigd })
  }

  const aflAdresOntbreekt = aflAdresOntbreektRes.count ?? 0
  if (aflAdresOntbreekt > 0) {
    counts.push({ status: 'Afleveradres ontbreekt', aantal: aflAdresOntbreekt })
  }

  const prijsOntbreekt = prijsOntbreektRes.count ?? 0
  if (prijsOntbreekt > 0) {
    counts.push({ status: 'Prijs ontbreekt', aantal: prijsOntbreekt })
  }

  const geenVerzendweek = geenVerzendweekRes.count ?? 0
  if (geenVerzendweek > 0) {
    counts.push({ status: 'Geen verzendweek', aantal: geenVerzendweek })
  }

  const verzendweekVerstreken = verzendweekVerstrekenRes.count ?? 0
  if (verzendweekVerstreken > 0) {
    counts.push({ status: 'Verzendweek verstreken', aantal: verzendweekVerstreken })
  }

  const manco = mancoRes.count ?? 0
  if (manco > 0) {
    counts.push({ status: 'Manco', aantal: manco })
  }

  const hadMankement = hadMankementRes.count ?? 0
  if (hadMankement > 0) {
    counts.push({ status: 'Had mankement', aantal: hadMankement })
  }

  return { counts, totalOrders }
}

/**
 * Aantal open orders zonder afleverdatum (= geen verzendweek). Voedt de
 * waarschuwingsbanner op het orders-overzicht. Productie-only orders (Basta)
 * worden uitgesloten — die verzenden via Basta zelf (ADR-0029).
 */
export async function countGeenVerzendweekOrders(): Promise<number> {
  const { count, error } = await filterGeenVerzendweek(
    supabase.from('orders').select('id', { count: 'exact', head: true }),
  )
  if (error) throw error
  return count ?? 0
}

/**
 * Aantal orders met een onzekere (fuzzy) debiteur-match die nog bevestigd moet
 * worden (mig 322). Voedt zowel de status-tab-telling als de waarschuwingsbanner
 * op het orders-overzicht. env_fallback (verzameldebiteur) is bewust uitgesloten
 * — dat is de verwachte eindbestemming voor consumenten-webshops, geen fout.
 * Eén bron-van-waarheid voor het predicaat; pas hier én in fetchOrders
 * ('Debiteur te bevestigen'-branch) aan als het ooit moet wijzigen.
 */
export async function countTeBevestigenDebiteurOrders(): Promise<number> {
  const { count, error } = await filterDebiteurTeBevestigen(
    supabase.from('orders').select('id', { count: 'exact', head: true }),
  )
  if (error) throw error
  return count ?? 0
}

export interface OrderKlantOptie {
  debiteur_nr: number
  klant_naam: string
}

/** Distinct (debiteur, naam) over alle orders — voedt het klant-filter op de
 * orders-overview. Lichtgewicht select (geen `count`), JS-dedupe omdat
 * PostgREST geen DISTINCT ondersteunt. Range ruim bemeten op de huidige
 * order-volumes; vervang door een DB-view als dit knelt. */
export async function fetchOrderKlantOpties(): Promise<OrderKlantOptie[]> {
  const { data, error } = await supabase
    .from('orders_list')
    .select('debiteur_nr, klant_naam')
    .range(0, 9999)

  if (error) throw error

  const map = new Map<number, string>()
  for (const r of (data ?? []) as { debiteur_nr: number; klant_naam: string | null }[]) {
    if (!map.has(r.debiteur_nr)) {
      map.set(r.debiteur_nr, r.klant_naam ?? `Debiteur ${r.debiteur_nr}`)
    }
  }
  return Array.from(map, ([debiteur_nr, klant_naam]) => ({ debiteur_nr, klant_naam })).sort(
    (a, b) => a.klant_naam.localeCompare(b.klant_naam, 'nl', { sensitivity: 'base' }),
  )
}

/** Fetch single order with details */
export async function fetchOrderDetail(id: number): Promise<OrderDetail> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .single()

  if (error) throw error

  const order = data as Record<string, unknown>

  // Fetch klant naam + klant's vertegenwoordiger as fallback
  let klant_naam = '—'
  let klant_vertegenw_code: string | null = null
  if (order.debiteur_nr) {
    const { data: deb } = await supabase
      .from('debiteuren')
      .select('naam, vertegenw_code, email_factuur, email_overig, email_pakbon')
      .eq('debiteur_nr', order.debiteur_nr)
      .single()
    if (deb) {
      klant_naam = deb.naam
      klant_vertegenw_code = deb.vertegenw_code
      ;(order as Record<string, unknown>).klant_email = deb.email_factuur ?? deb.email_overig ?? null
      ;(order as Record<string, unknown>).klant_email_orderbev = deb.email_overig ?? deb.email_factuur ?? null
      // Pakbon-bestemming: het aparte pakbon-adres als dat gezet is, anders NULL
      // → de weergave valt dan terug op het factuuradres ("zelfde als factuur").
      ;(order as Record<string, unknown>).klant_email_pakbon = deb.email_pakbon ?? null
    }
  }

  // Gebruik altijd de vertegenw_code van de klant (actueel); fallback op de order zelf
  const effectiveCode = klant_vertegenw_code || (order.vertegenw_code as string | null)
  let vertegenw_naam: string | undefined
  if (effectiveCode) {
    const { data: vtw } = await supabase
      .from('vertegenwoordigers')
      .select('naam')
      .eq('code', effectiveCode)
      .single()
    if (vtw) vertegenw_naam = vtw.naam
  }

  // Mig 563: Combi-levering-groepsinfo leeft in orders_list (niet in de kale
  // orders-tabel hierboven) — lichte extra fetch, geen bundel = geen rij.
  const { data: combiLevering } = await supabase
    .from('orders_list')
    .select('combi_levering_aantal_orders, wacht_op_combi_levering, combi_levering_andere_orders')
    .eq('id', id)
    .maybeSingle()

  return {
    ...order,
    klant_naam,
    vertegenw_naam,
    ...(combiLevering ?? {}),
  } as unknown as OrderDetail
}

/** Fetch order lines enriched with klanteigen namen and klant artikelnummers */
export async function fetchOrderRegels(orderId: number): Promise<OrderRegel[]> {
  // debiteur_nr en de order_regels hangen beide alleen van orderId af → parallel.
  const [{ data: orderData }, { data, error }] = await Promise.all([
    supabase.from('orders').select('debiteur_nr').eq('id', orderId).single(),
    supabase
      .from('order_regels')
      .select('id, regelnummer, artikelnr, karpi_code, omschrijving, omschrijving_2, orderaantal, te_leveren, backorder, prijs, korting_pct, bedrag, gewicht_kg, vrije_voorraad, fysiek_artikelnr, omstickeren, is_maatwerk, maatwerk_vorm, maatwerk_lengte_cm, maatwerk_breedte_cm, maatwerk_diameter_cm, maatwerk_afwerking, maatwerk_band_kleur, maatwerk_instructies, maatwerk_m2_prijs, maatwerk_oppervlak_m2, maatwerk_vorm_toeslag, maatwerk_afwerking_prijs, verzendweek, verzendweek_bron, klant_referentie, vroegst_leverbaar, pick_backorder_sinds, pick_backorder_geannuleerd_op, is_vrije_regel, producten!order_regels_artikelnr_fkey(kwaliteit_code, kleur_code, is_pseudo, is_dropship, karpi_code, voorraad, vrije_voorraad, besteld_inkoop, lengte_cm, breedte_cm)')
      .eq('order_id', orderId)
      .order('regelnummer'),
  ])

  if (error) throw error

  const regels = data ?? []
  const debiteurNr = orderData?.debiteur_nr

  // Helper to strip the joined 'producten' field and cast to OrderRegel
  function toRegel(
    r: (typeof regels)[number],
    eigenNaamMap?: Map<string, string>,
    klantArtMap?: Map<string, string>,
    fysiekOmschMap?: Map<string, string>,
  ): OrderRegel {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = r as any
    const product = row.producten as { kwaliteit_code: string; kleur_code: string | null; is_pseudo: boolean | null; is_dropship: boolean | null; karpi_code: string | null; voorraad: number | null; vrije_voorraad: number | null; besteld_inkoop: number | null; lengte_cm: number | null; breedte_cm: number | null } | null
    const kwalCode = product?.kwaliteit_code ?? null
    const kleurCode = product?.kleur_code ?? null
    const isPseudo = product?.is_pseudo === true
    const isDropship = product?.is_dropship === true

    let klantEigenNaam: string | null = null
    if (kwalCode && eigenNaamMap) {
      // Specifieke (kwaliteit, kleur)-match wint van de kwaliteit-fallback (kleur=NULL).
      const specifiek = kleurCode ? eigenNaamMap.get(`${kwalCode}_${kleurCode}`) : undefined
      const fallback = eigenNaamMap.get(`${kwalCode}_`)
      klantEigenNaam = specifiek ?? fallback ?? null
    }

    return {
      id: row.id,
      regelnummer: row.regelnummer,
      artikelnr: row.artikelnr,
      karpi_code: row.karpi_code ?? product?.karpi_code ?? null,
      omschrijving: row.omschrijving,
      omschrijving_2: row.omschrijving_2,
      orderaantal: row.orderaantal,
      te_leveren: row.te_leveren,
      backorder: row.backorder,
      prijs: row.prijs,
      korting_pct: row.korting_pct,
      bedrag: row.bedrag,
      gewicht_kg: row.gewicht_kg,
      // Bron-van-waarheid is producten.vrije_voorraad (de order_regels-kolom
      // wordt niet onderhouden en is meestal NULL). Nodig zodat de Order-
      // hydratie (order-edit → form-state) de dekking-velden correct vult en
      // berekenRegelDekking geen vals IO-tekort meldt. Mig 149 / ADR-0015.
      voorraad: product?.voorraad ?? null,
      vrije_voorraad: product?.vrije_voorraad ?? row.vrije_voorraad,
      besteld_inkoop: product?.besteld_inkoop ?? null,
      klant_eigen_naam: klantEigenNaam,
      klant_artikelnr: row.artikelnr && klantArtMap ? klantArtMap.get(row.artikelnr) ?? null : null,
      is_pseudo: isPseudo,  // mig 272 / ADR-0018: admin-pseudo-flag uit producten.is_pseudo
      is_dropship: isDropship,  // mig 370 / ADR-0018: dropship-vlag uit producten.is_dropship
      fysiek_artikelnr: row.fysiek_artikelnr ?? null,
      omstickeren: row.omstickeren ?? false,
      fysiek_omschrijving: row.fysiek_artikelnr && fysiekOmschMap
        ? fysiekOmschMap.get(row.fysiek_artikelnr) ?? null : null,
      is_maatwerk: row.is_maatwerk ?? false,
      maatwerk_vorm: row.maatwerk_vorm ?? null,
      maatwerk_lengte_cm: row.maatwerk_lengte_cm ?? null,
      maatwerk_breedte_cm: row.maatwerk_breedte_cm ?? null,
      maatwerk_diameter_cm: row.maatwerk_diameter_cm ?? null,
      maatwerk_afwerking: row.maatwerk_afwerking ?? null,
      maatwerk_band_kleur: row.maatwerk_band_kleur ?? null,
      maatwerk_instructies: row.maatwerk_instructies ?? null,
      maatwerk_m2_prijs: row.maatwerk_m2_prijs ?? null,
      maatwerk_oppervlak_m2: row.maatwerk_oppervlak_m2 ?? null,
      maatwerk_vorm_toeslag: row.maatwerk_vorm_toeslag ?? null,
      maatwerk_afwerking_prijs: row.maatwerk_afwerking_prijs ?? null,
      verzendweek: row.verzendweek ?? null,
      verzendweek_bron: row.verzendweek_bron ?? null,
      klant_referentie: row.klant_referentie ?? null,
      vroegst_leverbaar: row.vroegst_leverbaar ?? null,
      pick_backorder_sinds: row.pick_backorder_sinds ?? null,
      pick_backorder_geannuleerd_op: row.pick_backorder_geannuleerd_op ?? null,
      product_kwaliteit_code: kwalCode,
      product_kleur_code: kleurCode,
      product_lengte_cm: product?.lengte_cm ?? null,
      product_breedte_cm: product?.breedte_cm ?? null,
      is_vrije_regel: row.is_vrije_regel === true,
    }
  }

  // Fetch omschrijving for substituted products
  const fysiekeArtikelnrs = regels
    .map((r: any) => r.fysiek_artikelnr)
    .filter((a: string | null) => a != null) as string[]

  let fysiekOmschMap = new Map<string, string>()
  if (fysiekeArtikelnrs.length > 0) {
    const { data: fysiekData } = await supabase
      .from('producten')
      .select('artikelnr, omschrijving')
      .in('artikelnr', fysiekeArtikelnrs)
    fysiekOmschMap = new Map(
      (fysiekData ?? []).map((p: { artikelnr: string; omschrijving: string }) => [p.artikelnr, p.omschrijving])
    )
  }

  if (!debiteurNr) {
    return regels.map((r) => toRegel(r, undefined, undefined, fysiekOmschMap))
  }

  // Beide hangen alleen van debiteurNr af (onafhankelijk van elkaar) → parallel.
  const [eigenNaamMap, { data: klantArtNrs }] = await Promise.all([
    fetchKlanteigenNamenMap(debiteurNr),
    supabase
      .from('klant_artikelnummers')
      .select('artikelnr, klant_artikel')
      .eq('debiteur_nr', debiteurNr),
  ])

  const klantArtMap = new Map(
    (klantArtNrs ?? []).map((n: { artikelnr: string; klant_artikel: string }) => [n.artikelnr, n.klant_artikel])
  )

  const baseRegels = regels.map((r) => toRegel(r, eigenNaamMap, klantArtMap, fysiekOmschMap))

  // Fetch snijplannen for maatwerk regels
  const maatwerkRegelIds = baseRegels.filter((r) => r.is_maatwerk).map((r) => r.id)
  if (maatwerkRegelIds.length > 0) {
    const { data: snijplanData } = await supabase
      .from('snijplanning_overzicht')
      .select('id, snijplan_nr, status, scancode, snijplan_locatie, rol_id, rolnummer, order_regel_id')
      .in('order_regel_id', maatwerkRegelIds)
      .order('snijplan_nr')

    if (snijplanData) {
      const snijplanMap = new Map<number, OrderRegelSnijplan[]>()
      for (const sp of snijplanData) {
        const regelId = sp.order_regel_id as number
        if (!snijplanMap.has(regelId)) snijplanMap.set(regelId, [])
        snijplanMap.get(regelId)!.push({
          id: sp.id,
          snijplan_nr: sp.snijplan_nr,
          status: sp.status,
          scancode: sp.scancode,
          locatie: (sp as { snijplan_locatie?: string | null }).snijplan_locatie ?? null,
          rol_id: (sp as { rol_id?: number | null }).rol_id ?? null,
          rolnummer: (sp as { rolnummer?: string | null }).rolnummer ?? null,
        })
      }
      for (const regel of baseRegels) {
        if (snijplanMap.has(regel.id)) {
          regel.snijplannen = snijplanMap.get(regel.id)!
        }
      }
    }
  }

  // Fetch actieve voorraad-claims per orderregel voor DIT order — voor de
  // "N× gereserveerd voor dit order"-notitie in order-line-editor.tsx.
  // Doel: onderscheiden of vrije_voorraad=0 door EIGEN reservering (dan is de
  // order al gedekt) of door ANDERE orders (dan is de order ongedekt tekort).
  const alleRegelIds = baseRegels.map((r) => r.id)
  if (alleRegelIds.length > 0) {
    const { data: reserveringen } = await supabase
      .from('order_reserveringen')
      .select('order_regel_id, aantal')
      .in('order_regel_id', alleRegelIds)
      .eq('bron', 'voorraad')
      .eq('status', 'actief')

    if (reserveringen && reserveringen.length > 0) {
      const reserveringMap = new Map<number, number>()
      for (const r of reserveringen) {
        const id = r.order_regel_id as number
        reserveringMap.set(id, (reserveringMap.get(id) ?? 0) + (r.aantal as number))
      }
      for (const regel of baseRegels) {
        regel.eigen_voorraad_actief = reserveringMap.get(regel.id) ?? 0
      }
    } else {
      for (const regel of baseRegels) {
        regel.eigen_voorraad_actief = 0
      }
    }
  }

  return baseRegels
}

/** Stel handmatige verzendweek in voor een orderregel (mig 334). NULL = reset. */
export async function setRegelVerzendweek(regelId: number, verzendweek: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_regel_verzendweek', {
    p_regel_id: regelId,
    p_verzendweek: verzendweek,
  })
  if (error) throw error
}

/** Metadata-payload bij `order_events.event_type = 'levertijd_gewijzigd_door_eta'` (mig 326). */
export interface LevertijdWijzigingMetadata {
  afleverdatum_oud: string | null
  afleverdatum_nieuw: string | null
  verzendweek_oud: string | null
  verzendweek_nieuw: string | null
  inkooporder_regel_id: number | null
  eta_bijgewerkt_door: 'karpi' | 'leverancier' | null
}

export interface LevertijdWijzigingEvent {
  id: number
  created_at: string
  metadata: LevertijdWijzigingMetadata
}

/**
 * Haalt het meest recente `levertijd_gewijzigd_door_eta`-event voor een order op
 * (mig 326) — voedt de detailweergave (oud/nieuw-week, oorzaak) in
 * `LevertijdWijzigingBanner`. Spiegelt `fetchInkomendBerichtVoorOrder`.
 */
export async function fetchLaatsteLevertijdWijziging(
  orderId: number,
): Promise<LevertijdWijzigingEvent | null> {
  const { data, error } = await supabase
    .from('order_events')
    .select('id, created_at, metadata')
    .eq('order_id', orderId)
    .eq('event_type', 'levertijd_gewijzigd_door_eta')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  return data as unknown as LevertijdWijzigingEvent
}
