// ----------------------------------------------------------------------------
// Dunne UI-laag bovenop de werkagenda-KERNEL — géén eigen rekenkunde meer.
// ----------------------------------------------------------------------------
// De werkdag-/werkminuten-rekenkunde leeft sinds plan 2026-06-12-werkagenda-
// een-bron uitsluitend in supabase/functions/_shared/werkagenda.ts en wordt
// hier direct geïmporteerd (patroon: derive-status; vite server.fs.allow
// staat de cross-root-import toe). Contract: werkagenda.golden.json, getoetst
// in __tests__/werkagenda.contract.test.ts (Vitest) én Deno-kant.
//
// Wat hier WEL leeft: de UI-specifieke groepering/sortering van snijplan-
// stukken (berekenAgenda — sort in sync met de Lijst-weergave) en de
// generieke lanes-planner (berekenLanes, confectie).

import type { SnijplanRow } from '@/lib/types/productie'
import {
  type Werktijden,
  volgendeWerkminuut,
  plusWerkminuten,
  isoDatum,
} from '../../../../supabase/functions/_shared/werkagenda'

export type { Werktijden, FeestdagVrij } from '../../../../supabase/functions/_shared/werkagenda'
export {
  STANDAARD_WERKTIJDEN,
  isoDatum,
  isWerkdag,
  werkdagMinN,
  werkdagenTussen,
  volgendeWerkminuut,
  plusWerkminuten,
  werkminutenTussen,
} from '../../../../supabase/functions/_shared/werkagenda'

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
  /** True als eind > 00:00 van (leverdatum − buffer) — strikt, zoals check-levertijd (B4) */
  teLaat: boolean
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
  //
  // NB: dit wijkt bewust af van de kernel-`berekenSnijAgenda` (B6) — zie de
  // header van _shared/werkagenda.ts.
  const vandaagIso = isoDatum(new Date())
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
    // teLaat strikt (B4): deadline = 00:00 van (leverdatum − buffer), zodat er
    // minimaal `buffer` volle kalenderdagen tussen snij-eind en lever zitten.
    // Identiek aan kernel-berekenSnijAgenda → UI en check-levertijd zeggen
    // nu hetzelfde.
    let teLaat = false
    if (g.vroegsteLeverdatum) {
      const deadline = new Date(g.vroegsteLeverdatum + 'T00:00:00')
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
