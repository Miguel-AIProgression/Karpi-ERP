// Deno-port van frontend/src/lib/utils/bereken-agenda.ts.
// Berekent voor een lijst rollen wanneer ze sequentieel gesneden worden,
// gegeven werktijden + pauze. Gebruikt door check-levertijd om de werkelijke
// snij-datum van een matched rol te bepalen (niet alleen "afleverdatum − buffer").
//
// Gebruikt UTC-Date math i.p.v. local time (edge runtime ≠ Amsterdam tz);
// dat klopt voor datum-berekening, alleen het exacte uur wijkt af.

export interface Werktijden {
  /** ISO werkdagen 1=ma..7=zo */
  werkdagen: number[]
  startUur: number
  startMin: number
  eindUur: number
  eindMin: number
  pauzeStartUur: number
  pauzeStartMin: number
  pauzeEindUur: number
  pauzeEindMin: number
}

export const STANDAARD_WERKTIJDEN: Werktijden = {
  werkdagen: [1, 2, 3, 4, 5],
  startUur: 8, startMin: 0,
  eindUur: 17, eindMin: 0,
  pauzeStartUur: 12, pauzeStartMin: 0,
  pauzeEindUur: 12, pauzeEindMin: 30,
}

function isoWeekdag(d: Date): number {
  const js = d.getUTCDay()
  return js === 0 ? 7 : js
}

function isWerkdag(d: Date, w: Werktijden): boolean {
  return w.werkdagen.includes(isoWeekdag(d))
}

/** Eerste moment vanaf `vanaf` dat binnen werktijd valt. */
export function volgendeWerkminuut(vanaf: Date, w: Werktijden): Date {
  const d = new Date(vanaf.getTime())
  const heeftPauze = w.pauzeStartUur !== w.pauzeEindUur || w.pauzeStartMin !== w.pauzeEindMin

  for (let i = 0; i < 365; i++) {
    if (isWerkdag(d, w)) {
      const startDag = new Date(d); startDag.setUTCHours(w.startUur, w.startMin, 0, 0)
      const eindDag = new Date(d); eindDag.setUTCHours(w.eindUur, w.eindMin, 0, 0)
      if (d < startDag) d.setTime(startDag.getTime())
      if (d < eindDag) {
        if (heeftPauze) {
          const pS = new Date(d); pS.setUTCHours(w.pauzeStartUur, w.pauzeStartMin, 0, 0)
          const pE = new Date(d); pE.setUTCHours(w.pauzeEindUur, w.pauzeEindMin, 0, 0)
          if (d >= pS && d < pE) d.setTime(pE.getTime())
        }
        return d
      }
    }
    d.setUTCDate(d.getUTCDate() + 1)
    d.setUTCHours(0, 0, 0, 0)
  }
  return d
}

/** Tel netto werkminuten in [van, tot) — skipt avonden, weekenden, pauze. */
export function werkminutenTussen(van: Date, tot: Date, w: Werktijden): number {
  if (tot <= van) return 0
  const heeftPauze = w.pauzeStartUur !== w.pauzeEindUur || w.pauzeStartMin !== w.pauzeEindMin
  let totaal = 0
  const d = new Date(Date.UTC(van.getUTCFullYear(), van.getUTCMonth(), van.getUTCDate()))
  const einde = tot
  for (let i = 0; i < 400 && d.getTime() <= einde.getTime(); i++) {
    if (isWerkdag(d, w)) {
      const dagStart = new Date(d); dagStart.setUTCHours(w.startUur, w.startMin, 0, 0)
      const dagEind = new Date(d); dagEind.setUTCHours(w.eindUur, w.eindMin, 0, 0)
      const blokStart = van > dagStart ? van : dagStart
      const blokEind = einde < dagEind ? einde : dagEind
      if (blokEind > blokStart) {
        let mins = Math.floor((blokEind.getTime() - blokStart.getTime()) / 60_000)
        if (heeftPauze) {
          const pS = new Date(d); pS.setUTCHours(w.pauzeStartUur, w.pauzeStartMin, 0, 0)
          const pE = new Date(d); pE.setUTCHours(w.pauzeEindUur, w.pauzeEindMin, 0, 0)
          const overlapStart = blokStart > pS ? blokStart : pS
          const overlapEind = blokEind < pE ? blokEind : pE
          if (overlapEind > overlapStart) {
            mins -= Math.floor((overlapEind.getTime() - overlapStart.getTime()) / 60_000)
          }
        }
        if (mins > 0) totaal += mins
      }
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return totaal
}

/** Voeg N werkminuten toe (skipt avonden, weekenden, pauze). */
export function plusWerkminuten(start: Date, minuten: number, w: Werktijden): Date {
  let huidig = volgendeWerkminuut(start, w)
  let resterend = minuten
  const heeftPauze = w.pauzeStartUur !== w.pauzeEindUur || w.pauzeStartMin !== w.pauzeEindMin

  while (resterend > 0) {
    const eindDag = new Date(huidig); eindDag.setUTCHours(w.eindUur, w.eindMin, 0, 0)
    let blokEind = eindDag
    if (heeftPauze) {
      const pS = new Date(huidig); pS.setUTCHours(w.pauzeStartUur, w.pauzeStartMin, 0, 0)
      if (huidig < pS && pS < eindDag) blokEind = pS
    }
    const beschikbaar = Math.floor((blokEind.getTime() - huidig.getTime()) / 60000)
    if (resterend <= beschikbaar) {
      return new Date(huidig.getTime() + resterend * 60000)
    }
    resterend -= beschikbaar
    huidig = volgendeWerkminuut(new Date(blokEind.getTime() + 1), w)
  }
  return huidig
}

// ---------------------------------------------------------------------------
// Agenda-berekening per rol
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
  /**
   * True wanneer eind > (vroegsteAfleverdatum − snijLeverBufferDagen).
   * Betekent: rol wordt te laat gesneden voor de logistieke afhandeling.
   */
  teLaat: boolean
}

/**
 * Plan rollen sequentieel in een werkagenda.
 * Sorteer op vroegste afleverdatum, daarna rol_id voor stabiliteit.
 * `snijLeverBufferDagen` is het minimum aantal kalenderdagen tussen snij-eind
 * en leverdatum (default 2). Een rol wordt als `teLaat` gemarkeerd als de
 * berekende eind-tijd minder dan deze buffer vóór de leverdatum valt.
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
      const deadline = new Date(`${r.vroegsteAfleverdatum}T00:00:00Z`)
      deadline.setUTCDate(deadline.getUTCDate() - snijLeverBufferDagen)
      teLaat = eind > deadline
    }
    result.set(r.rolId, {
      start,
      eind,
      klaarDatum: eind.toISOString().slice(0, 10),
      teLaat,
    })
    cursor = eind
  }
  return result
}
