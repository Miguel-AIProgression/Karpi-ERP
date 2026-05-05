import type { SnijplanRow } from '@/lib/types/productie'

export interface FeestdagVrij {
  datum: string
  naam?: string
}

export interface Werktijden {
  /** Werkdagen 1-7 (1=ma, 7=zo) */
  werkdagen: number[]
  /** Starttijd HH:mm */
  start: string
  /** Eindtijd HH:mm */
  eind: string
  /** Pauzestart HH:mm (leeg = geen pauze) */
  pauzeStart: string
  /** Pauze-eind HH:mm */
  pauzeEind: string
  /** Dagen die geblokkeerd zijn (feestdagen, vakantie). ISO YYYY-MM-DD. */
  vrij: FeestdagVrij[]
}

export const STANDAARD_WERKTIJDEN: Werktijden = {
  werkdagen: [1, 2, 3, 4, 5],
  start: '08:00',
  eind: '17:00',
  pauzeStart: '12:00',
  pauzeEind: '12:30',
  vrij: [],
}

function isoDatum(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export interface RolBlok {
  rolId: number
  rolnummer: string
  kwaliteitCode: string
  kleurCode: string
  stukken: SnijplanRow[]
  /** Vroegste leverdatum binnen deze rol (ISO) */
  vroegsteLeverdatum: string | null
  /** Starttijd van de rol in de agenda */
  start: Date
  /** Eindtijd van de rol in de agenda */
  eind: Date
  /** Duur in minuten */
  duurMinuten: number
  /** True als eind > vroegste leverdatum */
  teLaat: boolean
}

function parseHHmm(tijd: string): { uren: number; minuten: number } {
  const [h, m] = tijd.split(':').map(Number)
  return { uren: h || 0, minuten: m || 0 }
}

function isWerkdag(d: Date, werkdagen: number[], vrij?: FeestdagVrij[]): boolean {
  // JS: 0=zo, 1=ma ... 6=za → omzetten naar 1=ma .. 7=zo
  const js = d.getDay()
  const iso = js === 0 ? 7 : js
  if (!werkdagen.includes(iso)) return false
  if (vrij && vrij.length) {
    const iso10 = isoDatum(d)
    if (vrij.some((v) => v.datum === iso10)) return false
  }
  return true
}

/** Zoek volgend moment dat een werkminuut beschikbaar is (na dit moment). */
export function volgendeWerkminuut(vanaf: Date, w: Werktijden): Date {
  const d = new Date(vanaf)
  const { uren: sU, minuten: sM } = parseHHmm(w.start)
  const { uren: eU, minuten: eM } = parseHHmm(w.eind)
  const pStart = parseHHmm(w.pauzeStart)
  const pEind = parseHHmm(w.pauzeEind)

  const heeftPauze = w.pauzeStart && w.pauzeEind && w.pauzeStart !== w.pauzeEind

  for (let i = 0; i < 365; i++) {
    if (isWerkdag(d, w.werkdagen, w.vrij)) {
      const startDag = new Date(d); startDag.setHours(sU, sM, 0, 0)
      const eindDag = new Date(d); eindDag.setHours(eU, eM, 0, 0)
      if (d < startDag) d.setTime(startDag.getTime())
      if (d < eindDag) {
        if (heeftPauze) {
          const pS = new Date(d); pS.setHours(pStart.uren, pStart.minuten, 0, 0)
          const pE = new Date(d); pE.setHours(pEind.uren, pEind.minuten, 0, 0)
          if (d >= pS && d < pE) d.setTime(pE.getTime())
        }
        return d
      }
    }
    // Naar volgende dag 00:00
    d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
  }
  return d
}

/** Totaal aantal werkminuten in het halfopen interval [van, tot). */
export function werkminutenTussen(van: Date, tot: Date, w: Werktijden): number {
  if (tot <= van) return 0
  const { uren: sU, minuten: sM } = parseHHmm(w.start)
  const { uren: eU, minuten: eM } = parseHHmm(w.eind)
  const pStart = parseHHmm(w.pauzeStart)
  const pEind = parseHHmm(w.pauzeEind)
  const heeftPauze = w.pauzeStart && w.pauzeEind && w.pauzeStart !== w.pauzeEind
  const pauzeMin = heeftPauze ? (pEind.uren * 60 + pEind.minuten) - (pStart.uren * 60 + pStart.minuten) : 0

  let totaal = 0
  const d = new Date(van); d.setHours(0, 0, 0, 0)
  const einde = new Date(tot)
  for (let i = 0; i < 400 && d <= einde; i++) {
    if (isWerkdag(d, w.werkdagen, w.vrij)) {
      const dagStart = new Date(d); dagStart.setHours(sU, sM, 0, 0)
      const dagEind = new Date(d); dagEind.setHours(eU, eM, 0, 0)
      const blokStart = van > dagStart ? van : dagStart
      const blokEind = einde < dagEind ? einde : dagEind
      if (blokEind > blokStart) {
        let mins = Math.floor((blokEind.getTime() - blokStart.getTime()) / 60000)
        if (heeftPauze) {
          const pS = new Date(d); pS.setHours(pStart.uren, pStart.minuten, 0, 0)
          const pE = new Date(d); pE.setHours(pEind.uren, pEind.minuten, 0, 0)
          const overlapStart = blokStart > pS ? blokStart : pS
          const overlapEind = blokEind < pE ? blokEind : pE
          if (overlapEind > overlapStart) {
            mins -= Math.floor((overlapEind.getTime() - overlapStart.getTime()) / 60000)
          }
          // Fallback als van/tot pauze volledig overspant terwijl blok dat doet
          if (mins < 0) mins = 0
          void pauzeMin
        }
        totaal += mins
      }
    }
    d.setDate(d.getDate() + 1)
  }
  return totaal
}

/** Voeg N werkminuten toe aan een tijdstip, rekening houdend met werktijden + pauze. */
export function plusWerkminuten(start: Date, minuten: number, w: Werktijden): Date {
  let huidig = volgendeWerkminuut(start, w)
  let resterend = minuten
  const { uren: eU, minuten: eM } = parseHHmm(w.eind)
  const pStart = parseHHmm(w.pauzeStart)
  const heeftPauze = w.pauzeStart && w.pauzeEind && w.pauzeStart !== w.pauzeEind

  while (resterend > 0) {
    const eindDag = new Date(huidig); eindDag.setHours(eU, eM, 0, 0)
    let blokEind = eindDag

    if (heeftPauze) {
      const pS = new Date(huidig); pS.setHours(pStart.uren, pStart.minuten, 0, 0)
      if (huidig < pS && pS < eindDag) blokEind = pS
    }

    const beschikbaar = Math.floor((blokEind.getTime() - huidig.getTime()) / 60000)
    if (resterend <= beschikbaar) {
      return new Date(huidig.getTime() + resterend * 60000)
    }
    resterend -= beschikbaar
    // Spring naar volgend werkmoment na dit blok
    huidig = volgendeWerkminuut(new Date(blokEind.getTime() + 1), w)
  }
  return huidig
}

export interface PlanningConfigLite {
  snijtijd_minuten: number
  wisseltijd_minuten: number
}

/** Groepeer stukken per rol + plan sequentieel in werkagenda. */
export function berekenAgenda(
  stukken: SnijplanRow[],
  werktijden: Werktijden,
  planningConfig: PlanningConfigLite,
  startVanaf: Date = new Date(),
  snijLeverBufferDagen: number = 2,
): RolBlok[] {
  type Groep = {
    rolId: number
    rolnummer: string
    kwaliteitCode: string
    kleurCode: string
    stukken: SnijplanRow[]
    vroegsteLeverdatum: string | null
  }
  const map = new Map<number, Groep>()
  for (const s of stukken) {
    if (s.rol_id == null) continue
    let g = map.get(s.rol_id)
    if (!g) {
      g = {
        rolId: s.rol_id,
        rolnummer: s.rolnummer ?? '?',
        kwaliteitCode: s.kwaliteit_code ?? '',
        kleurCode: s.kleur_code ?? '',
        stukken: [],
        vroegsteLeverdatum: null,
      }
      map.set(s.rol_id, g)
    }
    g.stukken.push(s)
    if (s.afleverdatum && (!g.vroegsteLeverdatum || s.afleverdatum < g.vroegsteLeverdatum)) {
      g.vroegsteLeverdatum = s.afleverdatum
    }
  }

  // Sort-key blijft in sync met de Lijst-weergave (snijplanning-overview.tsx):
  // leverdatum → kwaliteit → kleur → rolnummer. Zo staan rollen van dezelfde
  // kwaliteit aaneengesloten in de agenda (gunstig voor wisseltijd) en klopt
  // de volgorde 1-op-1 met wat de planner in de Lijst ziet.
  //
  // Rol zonder afgesproken leverdatum (alleen NULL-stukken): behandelen we
  // als 'vandaag' voor de sort — wens is zsm snijden, dus niet achteraan
  // stoppen. Tie-break daaronder geeft rollen mét deadline voorrang bij
  // gelijke datum, zodat we nooit een afspraak verdringen.
  const vandaagIso = new Date().toISOString().slice(0, 10)
  const groepen = Array.from(map.values()).sort((a, b) => {
    const aD = a.vroegsteLeverdatum ?? vandaagIso
    const bD = b.vroegsteLeverdatum ?? vandaagIso
    if (aD !== bD) return aD.localeCompare(bD)
    // Bij gelijke effectieve datum: echte deadline vóór NULL.
    const nullA = a.vroegsteLeverdatum == null ? 1 : 0
    const nullB = b.vroegsteLeverdatum == null ? 1 : 0
    if (nullA !== nullB) return nullA - nullB
    const k = a.kwaliteitCode.localeCompare(b.kwaliteitCode)
    if (k !== 0) return k
    const c = a.kleurCode.localeCompare(b.kleurCode)
    if (c !== 0) return c
    return a.rolnummer.localeCompare(b.rolnummer)
  })

  const blokken: RolBlok[] = []
  let cursor = startVanaf
  for (const g of groepen) {
    const duur = planningConfig.wisseltijd_minuten
      + g.stukken.length * planningConfig.snijtijd_minuten
    const start = volgendeWerkminuut(cursor, werktijden)
    const eind = plusWerkminuten(start, duur, werktijden)
    // Te laat = snij-eind valt minder dan `snijLeverBufferDagen` voor leverdatum.
    // Anders is er geen tijd voor de logistieke afhandeling (afwerking + verzending).
    let teLaat = false
    if (g.vroegsteLeverdatum) {
      const deadline = new Date(g.vroegsteLeverdatum + 'T23:59:59')
      deadline.setDate(deadline.getDate() - snijLeverBufferDagen)
      teLaat = eind > deadline
    }
    blokken.push({
      rolId: g.rolId,
      rolnummer: g.rolnummer,
      kwaliteitCode: g.kwaliteitCode,
      kleurCode: g.kleurCode,
      stukken: g.stukken,
      vroegsteLeverdatum: g.vroegsteLeverdatum,
      start,
      eind,
      duurMinuten: duur,
      teLaat,
    })
    cursor = eind
  }
  return blokken
}

export interface LaneBlok<TItem> {
  item: TItem
  start: Date
  eind: Date
  duurMinuten: number
}

export interface BerekenLanesOpties<TItem, TKey> {
  laneKey: (item: TItem) => TKey
  duur: (item: TItem) => number
  sortKey: (item: TItem) => string | number
  startVanaf?: Date
  /** Minimum-starttijd per item (bv. rol-klaar + buffer). Lane-cursor wordt hiermee opgetrokken. */
  minStart?: (item: TItem) => Date | null | undefined
}

/**
 * Generieke lanes-planner: groepeert items per laneKey en plant binnen elke lane
 * sequentieel in de werkagenda. Lanes lopen onafhankelijk parallel (elk met eigen cursor).
 */
export function berekenLanes<TItem, TKey>(
  items: TItem[],
  werktijden: Werktijden,
  opties: BerekenLanesOpties<TItem, TKey>,
): Map<TKey, Array<LaneBlok<TItem>>> {
  const { laneKey, duur, sortKey, minStart, startVanaf = new Date() } = opties

  const perLane = new Map<TKey, TItem[]>()
  for (const it of items) {
    const key = laneKey(it)
    const lijst = perLane.get(key) ?? []
    lijst.push(it)
    perLane.set(key, lijst)
  }

  const resultaat = new Map<TKey, Array<LaneBlok<TItem>>>()
  for (const [key, lijst] of perLane) {
    const gesorteerd = [...lijst].sort((a, b) => {
      const sa = sortKey(a)
      const sb = sortKey(b)
      if (sa === sb) return 0
      if (typeof sa === 'number' && typeof sb === 'number') return sa - sb
      return String(sa).localeCompare(String(sb))
    })
    const blokken: Array<LaneBlok<TItem>> = []
    let cursor = startVanaf
    for (const item of gesorteerd) {
      const d = duur(item)
      const ms = minStart?.(item)
      const vanaf = ms && ms > cursor ? ms : cursor
      const start = volgendeWerkminuut(vanaf, werktijden)
      const eind = plusWerkminuten(start, d, werktijden)
      blokken.push({ item, start, eind, duurMinuten: d })
      cursor = eind
    }
    resultaat.set(key, blokken)
  }
  return resultaat
}
