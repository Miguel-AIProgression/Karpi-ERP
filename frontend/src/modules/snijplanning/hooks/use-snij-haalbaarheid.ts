// Gedeelde afleiding "wanneer wordt dit maatwerk-stuk echt gesneden, en halen
// we de deadline" — geëxtraheerd uit de Haalbaarheid-pagina (was daar inline)
// zodat order-detail en het orderoverzicht dezelfde, in productie geteste
// queue-simulatie (`berekenAgenda`) kunnen hergebruiken i.p.v. zelf een eigen
// (en mogelijk afwijkende) afleiding te bouwen.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePlanningConfig } from '@/hooks/use-planning-config'
import { fetchWerkagendaConfig } from '@/lib/supabase/queries/werkagenda'
import { bepaalSnijDeadline, bepaalHaalbaarheidStatus, type HaalbaarheidStatus } from '@/lib/orders/snij-haalbaarheid'
import { berekenAgenda, isoDatum, werkdagenTussen } from '@/lib/utils/bereken-agenda'
import { leverdatumVoorSnijDatum } from '@/lib/orders/levertijd-match'
import { useMaatwerkHaalbaarheid, useVormSnijtijden, useMoeilijkeKwaliteiten } from './use-snijplanning'
import type { MaatwerkHaalbaarheidRow, InkoopRegelInfo } from '../queries/haalbaarheid'

export interface HaalbaarheidsRij extends MaatwerkHaalbaarheidRow {
  snijDeadline: string
  /** ISO-datum, of null als dit stuk nog geen rol heeft (niet gepland). */
  geplandeSnijDatum: string | null
  margeWerkdagen: number
  haalbaarheidStatus: HaalbaarheidStatus
  inkoopInfo?: InkoopRegelInfo
}

export interface OrderRij {
  orderId: number
  orderNr: string
  klantNaam: string
  afleverdatum: string | null
  leverType: 'week' | 'datum'
  kwaliteitKleurLabel: string
  aantalStukken: number
  aantalGepland: number
  /** Laatste (meest kritieke) geplande snijdatum onder de al-geplande stukken. NULL = geen enkel stuk gepland. */
  geplandeDatum: string | null
  /** Unieke rolnummers van de al-geplaatste stukken van deze order. */
  rolnummers: string[]
  margeWerkdagen: number
  haalbaarheidStatus: HaalbaarheidStatus
  /**
   * Realistische verzenddatum = geplande snijdatum + buffer (confectie + klaarleggen) —
   * alleen gevuld wanneer ALLE stukken van de order al een rol hebben: bij een
   * deels geplande order zou de projectie te optimistisch zijn (de nog niet
   * geplande stukken kunnen de werkelijke datum nog verder naar achteren duwen).
   */
  verwachteVerzendDatum: string | null
  /** Calendar-dagen verschil tussen verwachteVerzendDatum en de gevraagde afleverdatum. Positief = later dan gevraagd. */
  vertragingDagen: number | null
  stukken: HaalbaarheidsRij[]
}

export interface SnijHaalbaarheid {
  /** Per snijplan-id (zelfde id als `OrderRegelSnijplan.id`). */
  perStuk: Map<number, HaalbaarheidsRij>
  /** Per order_id. */
  perOrder: Map<number, OrderRij>
  isLoading: boolean
}

const STATUS_VOLGORDE: Record<HaalbaarheidStatus, number> = { rood: 0, oranje: 1, groen: 2 }

/**
 * Eén globale agenda over ALLE al-geplande stukken (alle kwaliteit/kleur-groepen
 * samen, ongebonden door een horizon) — exact de wachtrij zoals de snijder hem
 * doorwerkt. `berekenAgenda` plant vanaf "nu", wat vanzelf op de eerstvolgende
 * werkdag landt. Levert per rol een echte eind-datum: de kern van "wanneer wordt
 * dit nou echt gesneden", die nergens als los veld in de data bestaat.
 */
export function useSnijHaalbaarheid(): SnijHaalbaarheid {
  const { data: haalbaarheid, isLoading: haalbaarheidLoading } = useMaatwerkHaalbaarheid()
  const { data: planningConfig } = usePlanningConfig()
  const { data: werktijden } = useQuery({ queryKey: ['werkagenda-config'], queryFn: fetchWerkagendaConfig })
  const { data: vormTarieven } = useVormSnijtijden()
  const { data: moeilijkeKwaliteiten } = useMoeilijkeKwaliteiten()

  const rolEindMap = useMemo(() => {
    if (!haalbaarheid || !planningConfig || !werktijden || !vormTarieven || !moeilijkeKwaliteiten) return new Map<number, Date>()
    const blokken = berekenAgenda(haalbaarheid.rows, werktijden, planningConfig, vormTarieven, moeilijkeKwaliteiten)
    return new Map(blokken.map((b) => [b.rolId, b.eind]))
  }, [haalbaarheid, planningConfig, werktijden, vormTarieven, moeilijkeKwaliteiten])

  const rijen = useMemo<HaalbaarheidsRij[]>(() => {
    if (!haalbaarheid || !planningConfig || !werktijden) return []
    const vandaag = isoDatum(new Date())
    return haalbaarheid.rows
      .filter((r) => r.afleverdatum != null)
      .map((r) => {
        const snijDeadline = bepaalSnijDeadline(r.afleverdatum!, r.lever_type ?? 'week', planningConfig, werktijden)
        const eind = r.rol_id != null ? rolEindMap.get(r.rol_id) ?? null : null
        const geplandeSnijDatum = eind ? isoDatum(eind) : null
        // Geen rol → er is geen agenda-positie, dus terugvallen op de letterlijke
        // datum van vandaag (ongewijzigd Fase-1-gedrag voor niet-geplande stukken).
        const referentieDatum = geplandeSnijDatum ?? vandaag
        const margeWerkdagen = werkdagenTussen(referentieDatum, snijDeadline, werktijden)
        const status = bepaalHaalbaarheidStatus(snijDeadline, referentieDatum, werktijden)
        const inkoopInfo = r.verwacht_inkooporder_regel_id != null
          ? haalbaarheid.inkoopInfo.get(r.verwacht_inkooporder_regel_id)
          : undefined
        return { ...r, snijDeadline, geplandeSnijDatum, margeWerkdagen, haalbaarheidStatus: status, inkoopInfo }
      })
  }, [haalbaarheid, planningConfig, werktijden, rolEindMap])

  const perStuk = useMemo(() => {
    return new Map(rijen.map((r) => [r.id, r]))
  }, [rijen])

  // Groepeer per order — een order met meerdere maatwerk-regels toont het
  // slechtste oordeel onder zijn stukken (rood > oranje > groen) en de laatste
  // (meest kritieke) geplande datum.
  const perOrder = useMemo(() => {
    if (!planningConfig || !werktijden) return new Map<number, OrderRij>()
    const groepen = new Map<number, HaalbaarheidsRij[]>()
    for (const r of rijen) {
      const lijst = groepen.get(r.order_id) ?? []
      lijst.push(r)
      groepen.set(r.order_id, lijst)
    }
    const result = new Map<number, OrderRij>()
    for (const [orderId, stukken] of groepen) {
      const eerste = stukken[0]
      const leverType = eerste.lever_type ?? 'week'
      const aantalGepland = stukken.filter((s) => s.rol_id != null).length
      const geplandeDatums = stukken
        .map((s) => s.geplandeSnijDatum)
        .filter((d): d is string => d != null)
      const geplandeDatum = geplandeDatums.length > 0
        ? geplandeDatums.reduce((a, b) => (a > b ? a : b))
        : null
      const rolnummers = Array.from(
        new Set(stukken.map((s) => s.rolnummer).filter((rn): rn is string => rn != null)),
      )
      const status = stukken.reduce<HaalbaarheidStatus>(
        (worst, s) => (STATUS_VOLGORDE[s.haalbaarheidStatus] < STATUS_VOLGORDE[worst] ? s.haalbaarheidStatus : worst),
        'groen',
      )
      const margeWerkdagen = Math.min(...stukken.map((s) => s.margeWerkdagen))
      const combinaties = Array.from(
        new Set(stukken.map((s) => `${s.kwaliteit_code ?? '—'} · ${s.kleur_code ?? '—'}`)),
      )

      // Realistische verzenddatum: alleen geprojecteerd als ALLE stukken al een
      // rol hebben — bij een deels geplande order zouden de nog te plannen
      // stukken de werkelijke datum nog verder naar achteren kunnen duwen, dus
      // zou de projectie hier valse precisie suggereren.
      const volledigGepland = aantalGepland === stukken.length && geplandeDatum != null
      const bufferDagen = leverType === 'datum'
        ? planningConfig.dag_order_snij_buffer_werkdagen
        : planningConfig.logistieke_buffer_dagen
      const verwachteVerzendDatum = volledigGepland
        ? leverdatumVoorSnijDatum(geplandeDatum!, bufferDagen, werktijden)
        : null
      let vertragingDagen: number | null = null
      if (verwachteVerzendDatum && eerste.afleverdatum) {
        const verwacht = new Date(`${verwachteVerzendDatum}T00:00:00Z`).getTime()
        const gevraagd = new Date(`${eerste.afleverdatum}T00:00:00Z`).getTime()
        vertragingDagen = Math.round((verwacht - gevraagd) / 86_400_000)
      }

      result.set(orderId, {
        orderId,
        orderNr: eerste.order_nr,
        klantNaam: eerste.klant_naam,
        afleverdatum: eerste.afleverdatum,
        leverType,
        kwaliteitKleurLabel: combinaties.length > 1 ? `${combinaties[0]} +${combinaties.length - 1}` : combinaties[0],
        aantalStukken: stukken.length,
        aantalGepland,
        geplandeDatum,
        rolnummers,
        margeWerkdagen,
        haalbaarheidStatus: status,
        verwachteVerzendDatum,
        vertragingDagen,
        stukken,
      })
    }
    return result
  }, [rijen, planningConfig, werktijden])

  return { perStuk, perOrder, isLoading: haalbaarheidLoading }
}
