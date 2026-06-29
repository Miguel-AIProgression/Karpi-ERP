// Groepeerlogica voor de snijderij-werklijst.
//
// Primaire groepering: (kwaliteit_code, kleur_code) — zoals de snijderij werkt.
// Binnen elke groep:
//   1. Rollen: stukken die al een rol_id hebben (Gepland / Snijden)
//      - Per rol: shelves (zelfde positie_y_cm = naast-elkaar), restlengte, orderregels
//   2. Wacht op inkoop: stukken zonder rol, met IO-claim
//   3. Tekort: stukken zonder rol en zonder IO-claim
//
// Prioriteit (verzendweek): laagste numeriek (jaar×100+week) eerst.
// Jaar telt mee: 2026-wk10 vóór 2026-wk11.

import type { WerklijstRow } from '../queries/werklijst'
import type { HaalbaarheidStatus } from '@/lib/orders/snij-haalbaarheid'
import { bepaalHaalbaarheidStatus, bepaalSnijDeadline, type SnijDeadlineConfig } from '@/lib/orders/snij-haalbaarheid'
import type { Werktijden } from '@/lib/utils/bereken-agenda'

// ─── Geëxporteerde typen ────────────────────────────────────────────────────

/** Één stuk op een shelf (naast-elkaar op hetzelfde Y-punt op de rol). */
export interface WerklijstShelfStuk {
  snijplanId: number
  orderRegelId: number
  /** Breedte in rolbreedte-richting (X-as), incl. marge. */
  geplaatsteBreedteCm: number
  /** Diepte in rollengterichting (Y-as), incl. marge. */
  geplaatstelLengteCm: number
  xCm: number
  margeCm: number
  geroteerd: boolean
  klantNaam: string
  orderNr: string
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  maatwerk_vorm: string | null
  maatwerk_afwerking: string | null
}

/** Groep stukken op dezelfde Y-positie ("naast-elkaar"). */
export interface WerklijstShelf {
  /** Y-positie op de rol (startpunt snijlengte). */
  positieYCm: number
  /** Benodigde lengte voor deze shelf = max(positieY + geplaatstelLengteCm) per stuk. */
  eindYCm: number
  stukken: WerklijstShelfStuk[]
  /** Som van geplaatsteBreedteCm — mag de rolbreedte niet overschrijden. */
  gebruikteBreedteCm: number
}

/** Eén orderregel als rij in de werklijst. */
export interface WerklijstOrderregel {
  orderRegelId: number
  orderNr: string
  klantNaam: string
  /** Aantal snijplan-stukken (= het te snijden stuks-aantal). */
  aantalStuks: number
  /** Besteld stuks-aantal (orderaantal op de orderregel). */
  orderaantal: number | null
  maatwerk_lengte_cm: number | null
  maatwerk_breedte_cm: number | null
  maatwerk_vorm: string | null
  maatwerk_afwerking: string | null
  maatwerk_band_kleur: string | null
  verzendweek: string | null
  afleverdatum: string | null
  materiaalStatus: 'op_rol' | 'wacht_op_inkoop' | 'tekort'
  haalbaarheid: HaalbaarheidStatus | null
  express: boolean
  /** Aanwezig als materiaalStatus='op_rol'. */
  rolnummer: string | null
  is_handmatig_toegewezen: boolean
  /** IDs van de individuele snijplan-stukken (voor fase-c IO-koppeling). */
  snijplanIds: number[]
  /**
   * Conservatieve bijdrage aan de IO in cm = som van placed_breedte_cm per stuk.
   * MARGE-2.5CM: gebaseerd op stuk_snij_marge_cm (mig 464). Naast-elkaar-packing
   * kan de werkelijke bijdrage kleiner maken; auto-plan-groep herberekent exact.
   */
  totaalBijdrageCm: number
}

/** Eén rol met haar stukken, shelves en statistieken. */
export interface WerklijstRol {
  rolId: number
  rolnummer: string
  rolBreedteCm: number
  rolLengteCm: number
  /** Gebruikte rollengte = max(eindYCm) over alle shelves. */
  gebruikteLengteCm: number
  restLengteCm: number
  /** Vroegste afleverdatum van de stukken op deze rol (ISO). */
  vroegsteLeverdatum: string | null
  shelves: WerklijstShelf[]
  orderregels: WerklijstOrderregel[]
}

/** Eén kwaliteit/kleur-groep: het primaire accordeon-item in de werklijst. */
export interface WerklijstKwaliteitGroep {
  /** Combinatiesleutel voor React-keys en sortering. */
  sleutel: string
  kwaliteit_code: string
  kleur_code: string
  /** Weergavenaam, bijv. "LAGO 21". */
  productNaam: string
  rollen: WerklijstRol[]
  wachtOpInkoop: WerklijstOrderregel[]
  tekort: WerklijstOrderregel[]
  /** Vroegste verzendweek in de groep (voor sortering). */
  vroegsteVerzendweek: string | null
  /** Totale aantallen per materiaalstatus. */
  aantalOpRol: number
  aantalWachtOpInkoop: number
  aantalTekort: number
}

// ─── Hulpfuncties ───────────────────────────────────────────────────────────

/** Numerieke sorteringswaarde voor een verzendweek-string "YYYY-Www".
 *  Null-waarden krijgen een groot getal (achteraan). */
function verzendweekSorteerwaarde(week: string | null): number {
  if (!week) return 999999
  // Format: "2026-W28" of "2026-Www"
  const m = week.match(/^(\d{4})-W(\d{1,2})$/)
  if (!m) return 999999
  return parseInt(m[1]) * 100 + parseInt(m[2])
}

/** Vroegste verzendweek (laagste numeriek) uit een lijst regels. */
function vroegsteVerzendweek(regels: WerklijstOrderregel[]): string | null {
  let best: string | null = null
  let bestVal = Infinity
  for (const r of regels) {
    const v = verzendweekSorteerwaarde(r.verzendweek)
    if (v < bestVal) { bestVal = v; best = r.verzendweek }
  }
  return best
}

// ─── Hoofd-groepeerfunctie ──────────────────────────────────────────────────

export interface WerklijstGroeperingInput {
  stukken: WerklijstRow[]
  vandaag: string            // ISO YYYY-MM-DD
  werktijden: Werktijden
  snijDeadlineConfig: SnijDeadlineConfig
}

/**
 * Groepeert werklijst-stukken per (kwaliteit, kleur), dan per rol,
 * dan per shelf (naast-elkaar). Levertijd-haalbaarheid wordt per orderregel
 * berekend op basis van afleverdatum en vandaag (geen wachtrij-simulatie —
 * die komt in fase b).
 */
export function groepeerWerklijst(input: WerklijstGroeperingInput): WerklijstKwaliteitGroep[] {
  const { stukken, vandaag, werktijden, snijDeadlineConfig } = input

  // ── Stap 1: partitioneer per (kwaliteit, kleur) ──────────────────────────
  const groepMap = new Map<string, WerklijstRow[]>()
  for (const s of stukken) {
    const sleutel = `${s.kwaliteit_code ?? ''}|${s.kleur_code ?? ''}`
    const rij = groepMap.get(sleutel)
    if (rij) rij.push(s)
    else groepMap.set(sleutel, [s])
  }

  const resultaat: WerklijstKwaliteitGroep[] = []

  for (const [sleutel, groepStukken] of groepMap) {
    const [kwal, kleur] = sleutel.split('|')

    // ── Stap 2: partitioneer in rol / IO / tekort ─────────────────────────
    const opRol: WerklijstRow[] = []
    const ioStukken: WerklijstRow[] = []
    const tekortStukken: WerklijstRow[] = []

    for (const s of groepStukken) {
      if (s.rol_id != null) opRol.push(s)
      else if (s.verwacht_inkooporder_regel_id != null) ioStukken.push(s)
      else tekortStukken.push(s)
    }

    // ── Stap 3: bouw rollen (met shelves) ─────────────────────────────────
    const rolMap = new Map<number, WerklijstRow[]>()
    for (const s of opRol) {
      const r = rolMap.get(s.rol_id!)
      if (r) r.push(s)
      else rolMap.set(s.rol_id!, [s])
    }

    const rollen: WerklijstRol[] = []
    for (const [rolId, rolStukken] of rolMap) {
      const eersteSub = rolStukken[0]
      const rolBreedte = eersteSub.rol_breedte_cm ?? 400
      const rolLengte = eersteSub.rol_lengte_cm ?? 2000

      // Shelves: groepeer per positie_y_cm (null = nog geen positie → aparte bucket)
      const shelfMap = new Map<number, WerklijstRow[]>()
      const geenPositie: WerklijstRow[] = []
      for (const s of rolStukken) {
        if (s.positie_y_cm != null) {
          const sh = shelfMap.get(s.positie_y_cm)
          if (sh) sh.push(s)
          else shelfMap.set(s.positie_y_cm, [s])
        } else {
          geenPositie.push(s)
        }
      }

      const shelves: WerklijstShelf[] = []
      for (const [yPos, shStukken] of shelfMap) {
        // Sorteer op x-positie (links → rechts)
        shStukken.sort((a, b) => (a.positie_x_cm ?? 0) - (b.positie_x_cm ?? 0))
        // Helperfuncties: placed_lengte/breedte zijn altijd de ONGEROTEERDE afmetingen;
        // bij geroteerd=true draait X en Y om (breedte dwars op de rol, lengte langs de rol).
        const xExtent = (s: (typeof shStukken)[0]) =>
          s.geroteerd ? s.placed_breedte_cm : s.placed_lengte_cm
        const yExtent = (s: (typeof shStukken)[0]) =>
          s.geroteerd ? s.placed_lengte_cm : s.placed_breedte_cm

        const shelfStukken: WerklijstShelfStuk[] = shStukken.map((s) => ({
          snijplanId: s.id,
          orderRegelId: s.order_regel_id,
          geplaatsteBreedteCm: xExtent(s),  // X = dwars op de rolbreedte
          geplaatstelLengteCm: yExtent(s),  // Y = langs de rollengte
          xCm: s.positie_x_cm ?? 0,
          margeCm: s.marge_cm,
          geroteerd: s.geroteerd ?? false,
          klantNaam: s.klant_naam,
          orderNr: s.order_nr,
          maatwerk_lengte_cm: s.maatwerk_lengte_cm,
          maatwerk_breedte_cm: s.maatwerk_breedte_cm,
          maatwerk_vorm: s.maatwerk_vorm,
          maatwerk_afwerking: s.maatwerk_afwerking,
        }))
        const eindY = yPos + Math.max(...shStukken.map(yExtent))
        const gebruikteBreedte = shStukken.reduce((sum, s) => sum + xExtent(s), 0)
        shelves.push({ positieYCm: yPos, eindYCm: eindY, stukken: shelfStukken, gebruikteBreedteCm: gebruikteBreedte })
      }
      // Sorteer shelves op Y-positie (snijvolgorde)
      shelves.sort((a, b) => a.positieYCm - b.positieYCm)

      // Gebruikte rollengte = max eindYCm; stukken zonder positie tellen niet mee
      const gebruikteLengte = shelves.length > 0 ? Math.max(...shelves.map((sh) => sh.eindYCm)) : 0

      // Orderregels per rol (aggregeer per order_regel_id)
      const regelMap = new Map<number, WerklijstRow[]>()
      for (const s of rolStukken) {
        const r = regelMap.get(s.order_regel_id)
        if (r) r.push(s)
        else regelMap.set(s.order_regel_id, [s])
      }
      const orderregelRijen = Array.from(regelMap.values()).map((regelStukken) =>
        bouwOrderregelRij(regelStukken, 'op_rol', vandaag, werktijden, snijDeadlineConfig),
      )
      orderregelRijen.sort(sorteerOrderregel)

      const vroegsteLeverdatum = rolStukken
        .map((s) => s.afleverdatum)
        .filter(Boolean)
        .sort()[0] ?? null

      rollen.push({
        rolId,
        rolnummer: eersteSub.rolnummer ?? 'onbekend',
        rolBreedteCm: rolBreedte,
        rolLengteCm: rolLengte,
        gebruikteLengteCm: gebruikteLengte,
        restLengteCm: rolLengte - gebruikteLengte,
        vroegsteLeverdatum,
        shelves,
        orderregels: orderregelRijen,
      })
    }
    // Sorteer rollen: vroegste leverdatum eerst
    rollen.sort((a, b) => {
      if (!a.vroegsteLeverdatum && !b.vroegsteLeverdatum) return 0
      if (!a.vroegsteLeverdatum) return 1
      if (!b.vroegsteLeverdatum) return -1
      return a.vroegsteLeverdatum.localeCompare(b.vroegsteLeverdatum)
    })

    // ── Stap 4: IO-claim-rijen ─────────────────────────────────────────────
    const ioRegelMap = new Map<number, WerklijstRow[]>()
    for (const s of ioStukken) {
      const r = ioRegelMap.get(s.order_regel_id)
      if (r) r.push(s)
      else ioRegelMap.set(s.order_regel_id, [s])
    }
    const wachtOpInkoop = Array.from(ioRegelMap.values())
      .map((rs) => bouwOrderregelRij(rs, 'wacht_op_inkoop', vandaag, werktijden, snijDeadlineConfig))
      .sort(sorteerOrderregel)

    // ── Stap 5: tekort-rijen ──────────────────────────────────────────────
    const tekortRegelMap = new Map<number, WerklijstRow[]>()
    for (const s of tekortStukken) {
      const r = tekortRegelMap.get(s.order_regel_id)
      if (r) r.push(s)
      else tekortRegelMap.set(s.order_regel_id, [s])
    }
    const tekort = Array.from(tekortRegelMap.values())
      .map((rs) => bouwOrderregelRij(rs, 'tekort', vandaag, werktijden, snijDeadlineConfig))
      .sort(sorteerOrderregel)

    // ── Stap 6: groep-statistieken ────────────────────────────────────────
    const alleRegels = [...rollen.flatMap((r) => r.orderregels), ...wachtOpInkoop, ...tekort]
    const vw = vroegsteVerzendweek(alleRegels)

    resultaat.push({
      sleutel,
      kwaliteit_code: kwal,
      kleur_code: kleur,
      productNaam: kwal && kleur ? `${kwal} ${kleur}` : kwal ?? kleur ?? 'Onbekend',
      rollen,
      wachtOpInkoop,
      tekort,
      vroegsteVerzendweek: vw,
      aantalOpRol: rollen.reduce((s, r) => s + r.orderregels.reduce((a, rr) => a + rr.aantalStuks, 0), 0),
      aantalWachtOpInkoop: wachtOpInkoop.reduce((s, r) => s + r.aantalStuks, 0),
      aantalTekort: tekort.reduce((s, r) => s + r.aantalStuks, 0),
    })
  }

  // ── Stap 7: sorteer kwaliteitsgroepen (vroegste verzendweek → alfabet) ───
  resultaat.sort((a, b) => {
    const va = verzendweekSorteerwaarde(a.vroegsteVerzendweek)
    const vb = verzendweekSorteerwaarde(b.vroegsteVerzendweek)
    if (va !== vb) return va - vb
    if (a.kwaliteit_code !== b.kwaliteit_code)
      return (a.kwaliteit_code ?? '').localeCompare(b.kwaliteit_code ?? '')
    return (a.kleur_code ?? '').localeCompare(b.kleur_code ?? '')
  })

  return resultaat
}

// ─── Helper: bouw één orderregel-rij ────────────────────────────────────────

function bouwOrderregelRij(
  stukken: WerklijstRow[],
  materiaalStatus: WerklijstOrderregel['materiaalStatus'],
  vandaag: string,
  werktijden: Werktijden,
  config: SnijDeadlineConfig,
): WerklijstOrderregel {
  const eerste = stukken[0]
  let haalbaarheid: HaalbaarheidStatus | null = null
  if (eerste.afleverdatum) {
    const deadline = bepaalSnijDeadline(
      eerste.afleverdatum,
      eerste.lever_type,
      config,
      werktijden,
    )
    haalbaarheid = bepaalHaalbaarheidStatus(deadline, vandaag, werktijden)
  }
  return {
    orderRegelId: eerste.order_regel_id,
    orderNr: eerste.order_nr,
    klantNaam: eerste.klant_naam,
    aantalStuks: stukken.length,
    orderaantal: eerste.orderaantal,
    maatwerk_lengte_cm: eerste.maatwerk_lengte_cm,
    maatwerk_breedte_cm: eerste.maatwerk_breedte_cm,
    maatwerk_vorm: eerste.maatwerk_vorm,
    maatwerk_afwerking: eerste.maatwerk_afwerking,
    maatwerk_band_kleur: eerste.maatwerk_band_kleur,
    verzendweek: eerste.verzendweek,
    afleverdatum: eerste.afleverdatum,
    materiaalStatus,
    haalbaarheid,
    express: stukken.some((s) => s.express),
    rolnummer: eerste.rolnummer,
    is_handmatig_toegewezen: stukken.some((s) => s.is_handmatig_toegewezen),
    // Fase (c): snijplan-IDs + conservatieve bijdrage voor IO-koppeling
    snijplanIds: stukken.map((s) => s.id),
    // MARGE-2.5CM: placed_breedte_cm = breedte_cm + stuk_snij_marge_cm (mig 464)
    totaalBijdrageCm: Math.round(stukken.reduce((som, s) => som + s.placed_breedte_cm, 0)),
  }
}

/** Sorteert orderregelrijen: express eerst, dan verzendweek (laagst), dan alfabet klant. */
function sorteerOrderregel(a: WerklijstOrderregel, b: WerklijstOrderregel): number {
  if (a.express !== b.express) return a.express ? -1 : 1
  const va = verzendweekSorteerwaarde(a.verzendweek)
  const vb = verzendweekSorteerwaarde(b.verzendweek)
  if (va !== vb) return va - vb
  return a.klantNaam.localeCompare(b.klantNaam)
}
