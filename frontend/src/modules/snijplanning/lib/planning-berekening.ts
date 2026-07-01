// Pure planningsberekening voor de snijderij-werklijst.
//
// Verdeelt alle openstaande maatwerk-sessies over werkdagen,
// startend vanaf een door de gebruiker gekozen datum.
//
// Planningseenheid: (kwaliteit_code, kleur_code, rol_id).
//   - Eén sessie per aanwezige rol (rol_id IS NOT NULL).
//   - IO-wacht sessies: één per unieke verwacht_inkooporder_regel_id,
//     planbaar vanaf verwacht_datum + 14 dagen.
//   - Tekort-stukken: niet planbaar — aparte lijst onderaan.
//
// Capaciteitslimieten:
//   - Per dag: netto werkdag-minuten (uit werkagenda: 08:00-17:00 minus pauzes)
//   - Per dag: max 20 rollen (streef, niet hard geblokkeerd)
//   - Per week: 350 stuks (streef) / 400 stuks (max) — informatief
//
// Sortering sessies: express eerst → vroegste verzendweek → kwaliteit + kleur.

import type { WerklijstKwaliteitGroep, WerklijstOrderregel } from './werklijst-groepering'
import type { WerklijstRow } from '../queries/werklijst'
import type { Werktijden } from '@/lib/utils/bereken-agenda'
import { bepaalSnijtijdMinuten } from './snijtijd'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlanningConfig {
  wisseltijd_minuten: number          // 10
  capaciteit_per_week_streef: number  // 350
  capaciteit_per_week_max: number     // 400
  max_rollen_per_dag: number          // 20
}

export interface PlanningSession {
  // Identiteit
  sleutel: string                  // unieke key voor React
  kwaliteit_code: string
  kleur_code: string
  /** Rolnummer als het een rol-sessie is. */
  rolnummer: string | null
  rol_id: number | null
  /** IO-regelId als het een IO-wacht-sessie is. */
  io_regel_id: number | null
  /** Datum waarop IO-materiaal verwacht binnenkomt. */
  io_verwacht_datum: string | null
  /** Eerste dag waarop dit gepland mag worden (= io_verwacht_datum + 14 dgn). */
  io_planbaar_vanaf: string | null

  // Inhoud
  orderregels: WerklijstOrderregel[]
  aantalStuks: number

  // Tijdsinschatting
  snijMinuten: number               // SUM(snijtijd per stuk)
  duurMinuten: number               // snijMinuten + wisseltijd

  // Sortering
  heeftExpress: boolean
  vroegsteVerzendweek: string | null

  // Actuele status (van de DB-stukken)
  isInBewerking: boolean            // ≥1 stuk heeft status 'Snijden'

  // Planningsresultaat (null = tekort / niet planbaar)
  geplandeDag: string | null        // ISO YYYY-MM-DD
  dagStartMinuut: number | null     // minuten vanaf 00:00 (werkdag-start)
  dagEindMinuut: number | null

  // Weekcapaciteit-info (ingevuld na inplanning)
  weekLabel: string | null          // "2026-W27"
  weekStuks: number                 // stuks in dezelfde week
  weekIsOverbelast: boolean         // weekStuks > capaciteit_per_week_max
}

export interface PlanningDag {
  datum: string                     // ISO YYYY-MM-DD
  sessies: PlanningSession[]
  gebruikteMinuten: number
  nettoMinuten: number              // max beschikbaar deze dag
  aantalRollen: number
  aantalStuks: number
  isDagVol: boolean                 // gebruikteMinuten >= nettoMinuten
  rollenWaarschuwing: boolean       // aantalRollen > max_rollen_per_dag
}

export interface PlanningWeek {
  weekLabel: string                 // "2026-W27"
  maandag: string                   // ISO YYYY-MM-DD
  dagen: PlanningDag[]
  aantalStuks: number
  binnenStreef: boolean
  binnenMax: boolean
}

export interface TekortGroep {
  kwaliteit_code: string
  kleur_code: string
  aantalStuks: number
  orderregels: WerklijstOrderregel[]
}

export interface PlanningResultaat {
  weken: PlanningWeek[]
  sessiesGepland: number
  sessiesTekort: number
  stukkenGepland: number
  stukkenTekort: number
  tekortGroepen: TekortGroep[]
  eersteSnijdatum: string | null
  laatsteSnijdatum: string | null
}

// ─── Hulpfuncties ────────────────────────────────────────────────────────────

/** Minuten-offset (van middernacht) voor een "HH:mm"-string. */
function tijdNaarMinuten(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Netto beschikbare werkminuten per dag (totaal minus pauzes). */
function nettoDagMinuten(w: Werktijden): number {
  const totaal = tijdNaarMinuten(w.eind) - tijdNaarMinuten(w.start)
  const pauze = (w.pauzes ?? []).reduce((s, p) => {
    if (!p.start || !p.eind || p.start === p.eind) return s
    return s + tijdNaarMinuten(p.eind) - tijdNaarMinuten(p.start)
  }, 0)
  return Math.max(0, totaal - pauze)
}

/** ISO-weekgetal (jaar × 100 + week) voor sortering. */
function verzendweekNaarGetal(week: string | null): number {
  if (!week) return 999999
  const m = week.match(/^(\d{4})-W(\d{1,2})$/)
  return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 999999
}

/** ISO-weeklabel "YYYY-Www" voor een datum. */
function weekLabelVanDatum(datum: string): string {
  // Supabase/Postgres-afgeleid ISO-weeknummer via Date
  const d = new Date(`${datum}T12:00:00Z`)
  // ISO-week: maandag = dag 1 van de week
  const dag = (d.getUTCDay() + 6) % 7  // 0=ma..6=zo
  const maandag = new Date(d)
  maandag.setUTCDate(d.getUTCDate() - dag)
  maandag.setUTCHours(0, 0, 0, 0)
  // ISO-weeknummer van maandag
  const dJan4 = new Date(Date.UTC(maandag.getUTCFullYear(), 0, 4))
  const dagJan4 = (dJan4.getUTCDay() + 6) % 7
  const eersteMondag = new Date(dJan4)
  eersteMondag.setUTCDate(dJan4.getUTCDate() - dagJan4)
  const weekNr = Math.round((maandag.getTime() - eersteMondag.getTime()) / 604_800_000) + 1
  let jaar = maandag.getUTCFullYear()
  if (weekNr === 0) { jaar -= 1; return weekLabelVanDatum(new Date(maandag.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)) }
  if (weekNr > 52) {
    // Controleer of het week 53 of week 1 van het volgende jaar is
    const dJan4Volgend = new Date(Date.UTC(jaar + 1, 0, 4))
    const dagJan4Volgend = (dJan4Volgend.getUTCDay() + 6) % 7
    const eersteMandagVolgend = new Date(dJan4Volgend)
    eersteMandagVolgend.setUTCDate(dJan4Volgend.getUTCDate() - dagJan4Volgend)
    if (maandag >= eersteMandagVolgend) return `${jaar + 1}-W01`
  }
  return `${jaar}-W${String(weekNr).padStart(2, '0')}`
}

/** Maandag van een week-label "YYYY-Www" als ISO-datumstring. */
function maandagVanWeekLabel(label: string): string {
  const m = label.match(/^(\d{4})-W(\d{1,2})$/)
  if (!m) return label
  const jaar = parseInt(m[1])
  const week = parseInt(m[2])
  const d4jan = new Date(Date.UTC(jaar, 0, 4))
  const dag4jan = (d4jan.getUTCDay() + 6) % 7
  const eersteMondag = new Date(d4jan)
  eersteMondag.setUTCDate(d4jan.getUTCDate() - dag4jan)
  const maandag = new Date(eersteMondag)
  maandag.setUTCDate(eersteMondag.getUTCDate() + (week - 1) * 7)
  return maandag.toISOString().slice(0, 10)
}

/** Voeg N kalenderdagen toe aan een ISO-datumstring. */
function addDagen(datum: string, n: number): string {
  const d = new Date(`${datum}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Is dit een werkdag (gebaseerd op dag-van-de-week + vrije dagen)? */
function isWerkdag(datum: string, w: Werktijden): boolean {
  const d = new Date(`${datum}T12:00:00Z`)
  const iso = (d.getUTCDay() + 6) % 7 + 1  // 1=ma..7=zo
  if (!w.werkdagen.includes(iso)) return false
  // Vrije dagen (feestdagen)
  for (const v of w.vrij ?? []) {
    if (v.datum && v.datum.slice(0, 10) === datum) return false
  }
  return true
}

/** Volgende werkdag op of na `datum`. */
function volgendeWerkdag(datum: string, w: Werktijden): string {
  let d = datum
  while (!isWerkdag(d, w)) d = addDagen(d, 1)
  return d
}

/** Volgende werkdag NA `datum` (niet dezelfde dag). */
function eersteWerkdagNa(datum: string, w: Werktijden): string {
  return volgendeWerkdag(addDagen(datum, 1), w)
}

// ─── Sessie-bouwers ───────────────────────────────────────────────────────────

function bouwRolSessie(
  groep: WerklijstKwaliteitGroep,
  rol: WerklijstKwaliteitGroep['rollen'][number],
  rawStukken: WerklijstRow[],
  wisseltijd_minuten: number,
  vormTarieven: Map<string, number>,
  moeilijkeKwaliteiten: Set<string>,
): PlanningSession {
  const rolStukken = rawStukken.filter((s) => s.rol_id === rol.rolId)
  const snijMinuten = rolStukken.reduce(
    (s, r) => s + bepaalSnijtijdMinuten(r.maatwerk_vorm ?? null, r.kwaliteit_code ?? null, vormTarieven, moeilijkeKwaliteiten),
    0,
  )
  const isInBewerking = rolStukken.some((s) => s.status === 'Snijden')
  const vroegsteVerzendweek = vroegsteWeekUitRegels(rol.orderregels)
  const heeftExpress = rolStukken.some((s) => s.express)

  return {
    sleutel: `${groep.sleutel}|rol:${rol.rolId}`,
    kwaliteit_code: groep.kwaliteit_code,
    kleur_code: groep.kleur_code,
    rolnummer: rol.rolnummer,
    rol_id: rol.rolId,
    io_regel_id: null,
    io_verwacht_datum: null,
    io_planbaar_vanaf: null,
    orderregels: rol.orderregels,
    aantalStuks: rolStukken.length,
    snijMinuten,
    duurMinuten: snijMinuten + wisseltijd_minuten,
    heeftExpress,
    vroegsteVerzendweek,
    isInBewerking,
    geplandeDag: null,
    dagStartMinuut: null,
    dagEindMinuut: null,
    weekLabel: null,
    weekStuks: 0,
    weekIsOverbelast: false,
  }
}

function bouwIoSessie(
  groep: WerklijstKwaliteitGroep,
  ioRegelId: number,
  ioRegels: WerklijstOrderregel[],
  rawStukken: WerklijstRow[],
  wisseltijd_minuten: number,
  vormTarieven: Map<string, number>,
  moeilijkeKwaliteiten: Set<string>,
  ioVerwachtDatums: Map<number, string | null>,
): PlanningSession {
  const ioStukken = rawStukken.filter((s) => s.verwacht_inkooporder_regel_id === ioRegelId)
  const snijMinuten = ioStukken.reduce(
    (s, r) => s + bepaalSnijtijdMinuten(r.maatwerk_vorm ?? null, r.kwaliteit_code ?? null, vormTarieven, moeilijkeKwaliteiten),
    0,
  )
  const isInBewerking = ioStukken.some((s) => s.status === 'Snijden')
  const heeftExpress = ioStukken.some((s) => s.express)
  const vroegsteVerzendweek = vroegsteWeekUitRegels(ioRegels)
  const ioDatum = ioVerwachtDatums.get(ioRegelId) ?? null
  const planbaar = ioDatum ? addDagen(ioDatum, 14) : null

  return {
    sleutel: `${groep.sleutel}|io:${ioRegelId}`,
    kwaliteit_code: groep.kwaliteit_code,
    kleur_code: groep.kleur_code,
    rolnummer: null,
    rol_id: null,
    io_regel_id: ioRegelId,
    io_verwacht_datum: ioDatum,
    io_planbaar_vanaf: planbaar,
    orderregels: ioRegels,
    aantalStuks: ioStukken.length,
    snijMinuten,
    duurMinuten: snijMinuten + wisseltijd_minuten,
    heeftExpress,
    vroegsteVerzendweek,
    isInBewerking,
    geplandeDag: null,
    dagStartMinuut: null,
    dagEindMinuut: null,
    weekLabel: null,
    weekStuks: 0,
    weekIsOverbelast: false,
  }
}

function vroegsteWeekUitRegels(regels: WerklijstOrderregel[]): string | null {
  let best: string | null = null
  let bestVal = Infinity
  for (const r of regels) {
    const v = verzendweekNaarGetal(r.verzendweek)
    if (v < bestVal) { bestVal = v; best = r.verzendweek }
  }
  return best
}

// ─── Hoofd-algoritme ──────────────────────────────────────────────────────────

/**
 * Berekent een snijplanning: verdeelt alle openstaande sessies over werkdagen
 * startend vanaf `startdatum`. Pure functie — geen side effects, geen DB.
 *
 * De planning is een PROJECTIE op basis van de huidige data. "In bewerking"-
 * sessies (status=Snijden) worden getoond zonder nieuwe dag-toewijzing
 * (ze lopen al).
 */
export function berekenPlanning(
  groepen: WerklijstKwaliteitGroep[],
  rawStukken: WerklijstRow[],
  ioVerwachtDatums: Map<number, string | null>,
  startdatum: string,
  cfg: PlanningConfig,
  werktijden: Werktijden,
  vormTarieven: Map<string, number>,
  moeilijkeKwaliteiten: Set<string>,
): PlanningResultaat {
  const netto = nettoDagMinuten(werktijden)
  const eersteWerkdag = volgendeWerkdag(startdatum, werktijden)

  // ── Stap 1: Bouw sessies ───────────────────────────────────────────────────

  const sessies: PlanningSession[] = []
  const tekortGroepen: TekortGroep[] = []

  for (const groep of groepen) {
    // Rol-sessies
    for (const rol of groep.rollen) {
      sessies.push(bouwRolSessie(groep, rol, rawStukken, cfg.wisseltijd_minuten, vormTarieven, moeilijkeKwaliteiten))
    }

    // IO-sessies: groepeer per verwacht_inkooporder_regel_id
    if (groep.wachtOpInkoop.length > 0) {
      const ioGroepen = new Map<number, WerklijstOrderregel[]>()
      // Wij hebben de rawStukken; haal ioRegelId per orderregel op
      for (const rij of groep.wachtOpInkoop) {
        // Zoek de io_regel_id voor deze orderregel (uit rawStukken)
        const rawVoorRegel = rawStukken.filter(
          (s) => s.order_regel_id === rij.orderRegelId && s.verwacht_inkooporder_regel_id != null,
        )
        for (const raw of rawVoorRegel) {
          const ioId = raw.verwacht_inkooporder_regel_id!
          const bestaande = ioGroepen.get(ioId) ?? []
          if (!bestaande.find((r) => r.orderRegelId === rij.orderRegelId)) {
            bestaande.push(rij)
          }
          ioGroepen.set(ioId, bestaande)
        }
      }
      for (const [ioRegelId, ioRegels] of ioGroepen) {
        sessies.push(bouwIoSessie(groep, ioRegelId, ioRegels, rawStukken, cfg.wisseltijd_minuten, vormTarieven, moeilijkeKwaliteiten, ioVerwachtDatums))
      }
    }

    // Tekort: niet planbaar
    if (groep.tekort.length > 0) {
      tekortGroepen.push({
        kwaliteit_code: groep.kwaliteit_code,
        kleur_code: groep.kleur_code,
        aantalStuks: groep.aantalTekort,
        orderregels: groep.tekort,
      })
    }
  }

  // ── Stap 2: Sorteer sessies ────────────────────────────────────────────────
  // Express eerst → vroegste verzendweek → kwaliteit → kleur
  sessies.sort((a, b) => {
    if (a.heeftExpress !== b.heeftExpress) return a.heeftExpress ? -1 : 1
    const va = verzendweekNaarGetal(a.vroegsteVerzendweek)
    const vb = verzendweekNaarGetal(b.vroegsteVerzendweek)
    if (va !== vb) return va - vb
    if (a.kwaliteit_code !== b.kwaliteit_code) return a.kwaliteit_code.localeCompare(b.kwaliteit_code)
    return a.kleur_code.localeCompare(b.kleur_code)
  })

  // ── Stap 3: Inplan per dag ────────────────────────────────────────────────
  // State: per dag bijhouden hoeveel minuten en rollen gebruikt zijn
  const dagMinuten = new Map<string, number>()
  const dagRollen = new Map<string, number>()
  const dagSessies = new Map<string, PlanningSession[]>()

  const dagStarttijd = tijdNaarMinuten(werktijden.start)

  for (const sessie of sessies) {
    // "In bewerking" = al aan de gang, geen nieuwe dag nodig
    if (sessie.isInBewerking) {
      sessie.geplandeDag = eersteWerkdag  // show at top of planning
      sessie.dagStartMinuut = dagStarttijd
      sessie.dagEindMinuut = dagStarttijd
      continue
    }

    // Bepaal vroegste beschikbare dag
    const minDag = sessie.io_planbaar_vanaf
      ? volgendeWerkdag(sessie.io_planbaar_vanaf, werktijden)
      : eersteWerkdag
    const startDag = minDag > eersteWerkdag ? minDag : eersteWerkdag

    // Zoek eerste dag die past
    let dag = startDag
    let geplaatst = false

    for (let poging = 0; poging < 365; poging++) {
      const minutenGebruikt = dagMinuten.get(dag) ?? 0
      const rollenGebruikt = dagRollen.get(dag) ?? 0

      if (minutenGebruikt + sessie.duurMinuten <= netto) {
        // Past! Inplannen.
        const startMin = dagStarttijd + minutenGebruikt
        sessie.geplandeDag = dag
        sessie.dagStartMinuut = startMin
        sessie.dagEindMinuut = startMin + sessie.duurMinuten

        dagMinuten.set(dag, minutenGebruikt + sessie.duurMinuten)
        dagRollen.set(dag, rollenGebruikt + 1)

        const lijst = dagSessies.get(dag) ?? []
        lijst.push(sessie)
        dagSessies.set(dag, lijst)
        geplaatst = true
        break
      }

      dag = eersteWerkdagNa(dag, werktijden)
    }

    if (!geplaatst) {
      // Kan nergens in (extreem grote sessie) — zet op volgende werkdag als indicatie
      const fallbackDag = eersteWerkdagNa(startDag, werktijden)
      sessie.geplandeDag = fallbackDag
      sessie.dagStartMinuut = dagStarttijd
      sessie.dagEindMinuut = dagStarttijd + sessie.duurMinuten

      const lijst = dagSessies.get(fallbackDag) ?? []
      lijst.push(sessie)
      dagSessies.set(fallbackDag, lijst)
    }
  }

  // ── Stap 4: Groepeer per dag, dan per week ────────────────────────────────

  const alleDagen = Array.from(dagSessies.keys()).sort()
  const weekMap = new Map<string, PlanningDag[]>()

  for (const datum of alleDagen) {
    const sss = dagSessies.get(datum) ?? []
    const gebruikteMin = dagMinuten.get(datum) ?? 0
    const aantalRollen = dagRollen.get(datum) ?? 0
    const aantalStuks = sss.reduce((s, sess) => s + sess.aantalStuks, 0)

    const dag: PlanningDag = {
      datum,
      sessies: sss,
      gebruikteMinuten: gebruikteMin,
      nettoMinuten: netto,
      aantalRollen,
      aantalStuks,
      isDagVol: gebruikteMin >= netto,
      rollenWaarschuwing: aantalRollen > cfg.max_rollen_per_dag,
    }

    const weekLabel = weekLabelVanDatum(datum)
    const weekDagen = weekMap.get(weekLabel) ?? []
    weekDagen.push(dag)
    weekMap.set(weekLabel, weekDagen)
  }

  // ── Stap 5: Bouw weken + weekcapaciteitsinfo ──────────────────────────────

  const weken: PlanningWeek[] = []
  for (const [weekLabel, dagen] of weekMap) {
    const aantalStuks = dagen.reduce((s, d) => s + d.aantalStuks, 0)
    const week: PlanningWeek = {
      weekLabel,
      maandag: maandagVanWeekLabel(weekLabel),
      dagen: dagen.sort((a, b) => a.datum.localeCompare(b.datum)),
      aantalStuks,
      binnenStreef: aantalStuks <= cfg.capaciteit_per_week_streef,
      binnenMax: aantalStuks <= cfg.capaciteit_per_week_max,
    }
    weken.push(week)

    // Annoteer elke sessie met weekinfo
    for (const dag of week.dagen) {
      for (const sessie of dag.sessies) {
        sessie.weekLabel = weekLabel
        sessie.weekStuks = aantalStuks
        sessie.weekIsOverbelast = !week.binnenMax
      }
    }
  }
  weken.sort((a, b) => a.weekLabel.localeCompare(b.weekLabel))

  // ── Stap 6: Statistieken ──────────────────────────────────────────────────

  const geplandeSessies = sessies.filter((s) => s.geplandeDag != null)
  const alle_datums = geplandeSessies.map((s) => s.geplandeDag!).filter(Boolean)

  return {
    weken,
    sessiesGepland: geplandeSessies.length,
    sessiesTekort: tekortGroepen.length,
    stukkenGepland: geplandeSessies.reduce((s, sess) => s + sess.aantalStuks, 0),
    stukkenTekort: tekortGroepen.reduce((s, g) => s + g.aantalStuks, 0),
    tekortGroepen,
    eersteSnijdatum: alle_datums.length > 0 ? alle_datums.sort()[0] : null,
    laatsteSnijdatum: alle_datums.length > 0 ? alle_datums.sort().at(-1)! : null,
  }
}
