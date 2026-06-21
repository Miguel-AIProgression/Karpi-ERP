// ----------------------------------------------------------------------------
// EIGENAAR-MODULE: werkdag- en werkagenda-rekenkunde — de enige implementatie.
// ----------------------------------------------------------------------------
// Tot 2026-06 leefde deze rekenkunde op drie plekken (SQL mig 279 — nul
// callers, gedropt in mig 383; dit bestand; frontend bereken-agenda.ts).
// Sinds plan 2026-06-12-werkagenda-een-bron is dít de enige bron: de frontend
// importeert deze module direct (patroon: order-lifecycle/derive-status).
// Er is géén mirror meer om bij te houden. Contract: __tests__/werkagenda.
// golden.json, getoetst door Deno- én Vitest-test.
//
// Tijdzone: alle functies rekenen in LOKALE tijd (getDay/setHours). In de
// edge-runtime is TZ=UTC, dus daar identiek aan de oude UTC-variant; in de
// browser betekent 'start: 08:00' Amsterdamse tijd. Voor pure datum-functies
// (werkdagMinN) maakt de tijdzone niet uit.
//
// Feestdagen/vrije dagen: dagen in `Werktijden.vrij` tellen NIET als werkdag.
// De configuratie leeft in app_config sleutel 'werkagenda' (mig 384) — edge
// én frontend lezen dezelfde rij.
//
// teLaat-semantiek (besluit B4, 2026-06-12): strikt — deadline is 00:00 van
// (leverdatum − bufferDagen), zodat er minimaal `buffer` volle kalenderdagen
// tussen snij-eind en leverdatum zitten. UI en check-levertijd zeggen nu
// hetzelfde.
//
// Bekende, bewuste divergentie (B6): berekenSnijAgenda (hier) sorteert op
// leverdatum→rolId met NULL achteraan; de UI-`berekenAgenda` (frontend
// bereken-agenda.ts) sorteert in sync met de Lijst-weergave (leverdatum→
// kwaliteit→kleur→rolnummer, NULL als vandaag). Unificatie vergt verrijking
// van fetchWerkagendaInput in check-levertijd — eigen plan.

export interface FeestdagVrij {
  /** ISO YYYY-MM-DD */
  datum: string
  naam?: string
}

export interface Pauze {
  /** Pauzestart 'HH:mm' */
  start: string
  /** Pauze-eind 'HH:mm' */
  eind: string
}

export interface Werktijden {
  /** ISO werkdagen 1=ma..7=zo */
  werkdagen: number[]
  /** Starttijd 'HH:mm' */
  start: string
  /** Eindtijd 'HH:mm' */
  eind: string
  /** Pauzes per werkdag (leeg = geen pauze). Mogen niet overlappen. */
  pauzes: Pauze[]
  /** Geblokkeerde dagen (feestdagen, vakantie) */
  vrij: FeestdagVrij[]
}

export const STANDAARD_WERKTIJDEN: Werktijden = {
  werkdagen: [1, 2, 3, 4, 5],
  start: '08:00',
  eind: '17:00',
  pauzes: [
    { start: '09:30', eind: '09:45' },
    { start: '12:00', eind: '12:30' },
    { start: '14:30', eind: '14:45' },
  ],
  vrij: [],
}

/** Lokale kalenderdatum als ISO YYYY-MM-DD (géén toISOString — die is UTC). */
export function isoDatum(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseHHmm(tijd: string): { uren: number; minuten: number } {
  // Lege string is legaal voor pauze-velden (geparstePauzes filtert die
  // dan weg); een gevulde maar onparseerbare tijd is een config-fout
  // die NIET stil op 00:00 mag landen (app_config-gedreven sinds mig 384).
  if (!tijd) return { uren: 0, minuten: 0 }
  const m = /^(\d{1,2}):(\d{2})$/.exec(tijd)
  if (!m) throw new Error(`werkagenda: ongeldige HH:mm-tijd '${tijd}'`)
  return { uren: Number(m[1]), minuten: Number(m[2]) }
}

interface GeparsteUur { uren: number; minuten: number }
interface GeparstePauze { start: GeparsteUur; eind: GeparsteUur }

/** Geldige pauzes (niet-leeg, start !== eind), geparsed — negeert kapotte/lege rijen. */
function geparstePauzes(w: Werktijden): GeparstePauze[] {
  return (w.pauzes ?? [])
    .filter((p) => p.start && p.eind && p.start !== p.eind)
    .map((p) => ({ start: parseHHmm(p.start), eind: parseHHmm(p.eind) }))
}

/** Eerstvolgende pauzestart ná `vanaf` op dezelfde kalenderdag, of null. */
function volgendePauzeStart(vanaf: Date, pauzes: GeparstePauze[]): Date | null {
  let beste: Date | null = null
  for (const p of pauzes) {
    const pS = new Date(vanaf); pS.setHours(p.start.uren, p.start.minuten, 0, 0)
    if (pS > vanaf && (!beste || pS < beste)) beste = pS
  }
  return beste
}

export function isWerkdag(d: Date, w: Werktijden): boolean {
  const js = d.getDay() // 0=zo..6=za
  const iso = js === 0 ? 7 : js
  if (!w.werkdagen.includes(iso)) return false
  if (w.vrij && w.vrij.length) {
    const dag = isoDatum(d)
    if (w.vrij.some((v) => v.datum === dag)) return false
  }
  return true
}

/**
 * Trek N werkdagen af van een ISO-datum (YYYY-MM-DD). Een werkdag = dag in
 * `werkdagen` én niet in `vrij`. Voor dag-orders (ADR 0014): pick-horizon =
 * werkdagMinN(afleverdatum, 1); kritieke snij-deadline = werkdagMinN(
 * afleverdatum, dag_order_snij_buffer_werkdagen).
 *
 * N=0 retourneert de input. Max 60 stappen veiligheidsrem; ongeldige datum
 * retourneert de input ongewijzigd.
 */
export function werkdagMinN(iso: string, n: number, w: Werktijden = STANDAARD_WERKTIJDEN): string {
  const start = new Date(`${iso}T00:00:00`)
  if (isNaN(start.getTime())) return iso
  const d = new Date(start)
  let resterend = n
  let stappen = 0
  while (resterend > 0 && stappen < 60) {
    d.setDate(d.getDate() - 1)
    stappen += 1
    if (isWerkdag(d, w)) resterend -= 1
  }
  return isoDatum(d)
}

/**
 * Tel het aantal werkdagen tussen twee ISO-datums (YYYY-MM-DD) — de keerzijde
 * van `werkdagMinN`: telt werkdagen ná `van` t/m (incl.) `tot`. `van >= tot`
 * geeft 0 (zowel "vandaag is de deadline" als "deadline ligt al achter ons"
 * geven dus 0 — onderscheid daartussen maakt de caller zelf via een directe
 * datumvergelijking, dit telt alleen de resterende marge).
 */
export function werkdagenTussen(van: string, tot: string, w: Werktijden = STANDAARD_WERKTIJDEN): number {
  const start = new Date(`${van}T00:00:00`)
  const eind = new Date(`${tot}T00:00:00`)
  if (isNaN(start.getTime()) || isNaN(eind.getTime()) || eind <= start) return 0
  const d = new Date(start)
  let aantal = 0
  let stappen = 0
  while (d.getTime() < eind.getTime() && stappen < 1000) {
    d.setDate(d.getDate() + 1)
    stappen += 1
    if (isWerkdag(d, w)) aantal += 1
  }
  return aantal
}

/**
 * Aantal werkdagen in de ISO-week die op `maandagIso` begint (normaliter 5,
 * minder bij een feestdagen-week). Gebruikt om een per-dag-streefwaarde
 * (bv. max rolwissels/dag) te vertalen naar een week-grens zonder een
 * vaste ×5 te hardcoden (Fase 3 productiecapaciteit).
 */
export function werkdagenInIsoWeek(maandagIso: string, w: Werktijden = STANDAARD_WERKTIJDEN): number {
  const d = new Date(`${maandagIso}T00:00:00`)
  if (isNaN(d.getTime())) return 5
  let aantal = 0
  for (let i = 0; i < 7; i++) {
    if (isWerkdag(d, w)) aantal += 1
    d.setDate(d.getDate() + 1)
  }
  return aantal
}

/** Eerste moment vanaf `vanaf` dat binnen werktijd valt. */
export function volgendeWerkminuut(vanaf: Date, w: Werktijden): Date {
  const d = new Date(vanaf.getTime())
  const { uren: sU, minuten: sM } = parseHHmm(w.start)
  const { uren: eU, minuten: eM } = parseHHmm(w.eind)
  const pauzes = geparstePauzes(w)

  for (let i = 0; i < 365; i++) {
    if (isWerkdag(d, w)) {
      const startDag = new Date(d); startDag.setHours(sU, sM, 0, 0)
      const eindDag = new Date(d); eindDag.setHours(eU, eM, 0, 0)
      if (d < startDag) d.setTime(startDag.getTime())
      if (d < eindDag) {
        // Pauzes zijn niet-overlappend, maar na het skippen van de ene
        // kan d in een latere pauze terechtkomen — loop tot stabiel.
        let veranderd = true
        while (veranderd) {
          veranderd = false
          for (const p of pauzes) {
            const pS = new Date(d); pS.setHours(p.start.uren, p.start.minuten, 0, 0)
            const pE = new Date(d); pE.setHours(p.eind.uren, p.eind.minuten, 0, 0)
            if (d >= pS && d < pE) { d.setTime(pE.getTime()); veranderd = true }
          }
        }
        return d
      }
    }
    d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
  }
  return d
}

/** Tel netto werkminuten in [van, tot) — skipt avonden, weekenden, vrije dagen, pauze. */
export function werkminutenTussen(van: Date, tot: Date, w: Werktijden): number {
  if (tot <= van) return 0
  const { uren: sU, minuten: sM } = parseHHmm(w.start)
  const { uren: eU, minuten: eM } = parseHHmm(w.eind)
  const pauzes = geparstePauzes(w)

  let totaal = 0
  const d = new Date(van); d.setHours(0, 0, 0, 0)
  const einde = tot
  for (let i = 0; i < 400 && d.getTime() <= einde.getTime(); i++) {
    if (isWerkdag(d, w)) {
      const dagStart = new Date(d); dagStart.setHours(sU, sM, 0, 0)
      const dagEind = new Date(d); dagEind.setHours(eU, eM, 0, 0)
      const blokStart = van > dagStart ? van : dagStart
      const blokEind = einde < dagEind ? einde : dagEind
      if (blokEind > blokStart) {
        let mins = Math.floor((blokEind.getTime() - blokStart.getTime()) / 60_000)
        for (const p of pauzes) {
          const pS = new Date(d); pS.setHours(p.start.uren, p.start.minuten, 0, 0)
          const pE = new Date(d); pE.setHours(p.eind.uren, p.eind.minuten, 0, 0)
          const overlapStart = blokStart > pS ? blokStart : pS
          const overlapEind = blokEind < pE ? blokEind : pE
          if (overlapEind > overlapStart) {
            mins -= Math.floor((overlapEind.getTime() - overlapStart.getTime()) / 60_000)
          }
        }
        if (mins > 0) totaal += mins
      }
    }
    d.setDate(d.getDate() + 1)
  }
  return totaal
}

/** Voeg N werkminuten toe (skipt avonden, weekenden, vrije dagen, pauze). */
export function plusWerkminuten(start: Date, minuten: number, w: Werktijden): Date {
  let huidig = volgendeWerkminuut(start, w)
  let resterend = minuten
  const { uren: eU, minuten: eM } = parseHHmm(w.eind)
  const pauzes = geparstePauzes(w)

  while (resterend > 0) {
    const eindDag = new Date(huidig); eindDag.setHours(eU, eM, 0, 0)
    const pStart = volgendePauzeStart(huidig, pauzes)
    const blokEind = pStart && pStart < eindDag ? pStart : eindDag
    const beschikbaar = Math.floor((blokEind.getTime() - huidig.getTime()) / 60_000)
    if (resterend <= beschikbaar) {
      return new Date(huidig.getTime() + resterend * 60_000)
    }
    // beschikbaar kan 0 zijn (huidig exact op blokEind); de +1ms-nudge
    // hieronder duwt volgendeWerkminuut dan voorbij de grens — geen hang.
    resterend -= beschikbaar
    huidig = volgendeWerkminuut(new Date(blokEind.getTime() + 1), w)
  }
  return huidig
}

// ---------------------------------------------------------------------------
// Agenda-berekening per rol (edge: check-levertijd)
// ---------------------------------------------------------------------------

export interface RolAgendaInput {
  rolId: number
  /** Vroegste afleverdatum binnen deze rol (ISO YYYY-MM-DD), null = laatst */
  vroegsteAfleverdatum: string | null
  /** Geschatte snijduur in minuten (= wisseltijd + stuks × snijtijd) */
  duurMinuten: number
}

export interface RolAgendaSlot {
  start: Date
  eind: Date
  /** ISO YYYY-MM-DD van het EIND van het rol-blok (= klaar-datum) */
  klaarDatum: string
  /** True wanneer eind > 00:00 van (vroegsteAfleverdatum − snijLeverBufferDagen). */
  teLaat: boolean
}

/**
 * Plan rollen sequentieel in een werkagenda. Sorteert op vroegste
 * afleverdatum, daarna rolId (NULL-leverdatum achteraan — zie B6-noot boven).
 */
export function berekenSnijAgenda(
  rollen: RolAgendaInput[],
  werktijden: Werktijden,
  startVanaf: Date,
  snijLeverBufferDagen: number = 2,
): Map<number, RolAgendaSlot> {
  const gesorteerd = [...rollen].sort((a, b) => {
    if (a.vroegsteAfleverdatum === b.vroegsteAfleverdatum) return a.rolId - b.rolId
    if (!a.vroegsteAfleverdatum) return 1
    if (!b.vroegsteAfleverdatum) return -1
    return a.vroegsteAfleverdatum.localeCompare(b.vroegsteAfleverdatum)
  })

  const result = new Map<number, RolAgendaSlot>()
  let cursor = startVanaf
  for (const r of gesorteerd) {
    const start = volgendeWerkminuut(cursor, werktijden)
    const eind = plusWerkminuten(start, r.duurMinuten, werktijden)
    let teLaat = false
    if (r.vroegsteAfleverdatum) {
      const deadline = new Date(`${r.vroegsteAfleverdatum}T00:00:00`)
      deadline.setDate(deadline.getDate() - snijLeverBufferDagen)
      teLaat = eind > deadline
    }
    result.set(r.rolId, { start, eind, klaarDatum: isoDatum(eind), teLaat })
    cursor = eind
  }
  return result
}
