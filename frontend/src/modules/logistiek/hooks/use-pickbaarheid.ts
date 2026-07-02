// usePickbaarheid — gedeelde pickbaarheid-/blokkade-resolutie voor de Pick &
// Ship start-/print-acties (StartPickrondesButton, StartWeekButton, bulkbalk).
//
// Sinds ADR-0037 is dit een **dunne wrapper** rond de pure module
// [`startbaarheid.ts`](../lib/startbaarheid.ts): de hook resolveert per order de
// vervoerder-regels (gedeelde batch, mig 401; buiten een provider een eigen
// fallback-call) en mapt elke order via `bepaalStartbaarheid` naar één canonieke
// status. De publieke velden hieronder zijn pure afleidingen uit die status-map
// — de prioriteit (in_pickronde > niet_pickbaar > afl_adres > prijs >
// geen_vervoerder) reproduceert exact het oude isPickbaar-guarded gedrag:
//   - `pickbareOrders`   = status 'startbaar'
//   - `geenVervoerderIds`/`aflAdresIds`/`prijsIds` = de gelijknamige statussen
// De server-poort `_valideer_intake_gates` (mig 395/396) + de geen-vervoerder-
// guard in `start_pickronden` (mig 373) blijven de autoritaire hard-block; deze
// hook is de UX-spiegel.
import { useMemo } from 'react'
import {
  useVervoerderResolutieContext,
  useEffectieveVervoerderVoorOrders,
} from '../context/vervoerder-resolutie-context'
import { bepaalStartbaarheid, heeftGeenVervoerder, type StartStatus } from '../lib/startbaarheid'
import type { PickShipOrder } from '@/modules/magazijn'

export interface PickbaarheidResultaat {
  /** Orders die direct een pickronde kunnen starten (status 'startbaar'). */
  pickbareOrders: PickShipOrder[]
  /** Set met alle `pickbareOrders`-ids — handig voor snelle lookups. */
  pickbareIds: Set<number>
  /** Ids per blokkade-reden — wederzijds exclusief (één status per order). */
  geenVervoerderIds: Set<number>
  aflAdresIds: Set<number>
  aflGlnIds: Set<number>
  prijsIds: Set<number>
  /** Tellingen per blokkade-reden (= grootte van de sets hierboven). */
  aantalGeenVervoerder: number
  aantalAflAdres: number
  aantalAflGln: number
  aantalPrijs: number
  aantalGeblokkeerd: number
  /** Laadt de vervoerder-resolutie nog? Voedt de disable van de knoppen. */
  vervoerderResolutieLaadt: boolean
}

export function usePickbaarheid(orders: PickShipOrder[]): PickbaarheidResultaat {
  const batchCtx = useVervoerderResolutieContext()
  // Alleen niet-afhaal-orders kunnen een vervoerder-blokkade hebben; vraag voor
  // wat de context niet dekt een eigen batch-resolutie (zelfde queryKey → React
  // Query dedupliceert naar één fetch).
  const idsZonderContext = useMemo(
    () =>
      orders
        .filter((o) => !o.afhalen && !(batchCtx?.heeftOrder(o.order_id) ?? false))
        .map((o) => o.order_id),
    [orders, batchCtx],
  )
  const fallbackQuery = useEffectieveVervoerderVoorOrders(idsZonderContext)

  // Eén canonieke status per order (ADR-0037) — de single source waaruit alle
  // afgeleide sets hieronder volgen.
  const statusPerOrder = useMemo(() => {
    const map = new Map<number, StartStatus>()
    for (const o of orders) {
      const regels = batchCtx?.heeftOrder(o.order_id)
        ? batchCtx.getRegels(o.order_id)
        : fallbackQuery.data?.get(o.order_id)
      map.set(
        o.order_id,
        bepaalStartbaarheid({
          order_id: o.order_id,
          afhalen: o.afhalen,
          alle_regels_pickbaar: o.alle_regels_pickbaar,
          heeft_gepland_zending: o.heeft_gepland_zending,
          afl_adres_incompleet_sinds: o.afl_adres_incompleet_sinds,
          afl_gln_ongekoppeld_sinds: o.afl_gln_ongekoppeld_sinds,
          afl_gln_gecontroleerd_op: o.afl_gln_gecontroleerd_op,
          prijs_ontbreekt_sinds: o.prijs_ontbreekt_sinds,
          in_pickronde: o.actieve_pickronde !== null,
          geen_vervoerder: heeftGeenVervoerder(o.afhalen, regels),
        }).status,
      )
    }
    return map
  }, [orders, batchCtx, fallbackQuery.data])

  const pickbareOrders = useMemo(
    () => orders.filter((o) => statusPerOrder.get(o.order_id) === 'startbaar'),
    [orders, statusPerOrder],
  )
  const pickbareIds = useMemo(() => new Set(pickbareOrders.map((o) => o.order_id)), [pickbareOrders])

  // De drie blokkade-sets in één pass uit de status-map (statussen zijn
  // wederzijds exclusief). Eén useMemo i.p.v. een gedeelde closure — anders kan
  // de React Compiler de memoization niet behouden.
  const { geenVervoerderIds, aflAdresIds, aflGlnIds, prijsIds } = useMemo(() => {
    const geen = new Set<number>()
    const adres = new Set<number>()
    const gln = new Set<number>()
    const prijs = new Set<number>()
    for (const [id, status] of statusPerOrder) {
      if (status === 'geen_vervoerder') geen.add(id)
      else if (status === 'afl_adres') adres.add(id)
      else if (status === 'afl_gln') gln.add(id)
      else if (status === 'prijs') prijs.add(id)
    }
    return { geenVervoerderIds: geen, aflAdresIds: adres, aflGlnIds: gln, prijsIds: prijs }
  }, [statusPerOrder])

  const vervoerderResolutieLaadt =
    (batchCtx?.isLoading ?? false) || fallbackQuery.isLoading

  return {
    pickbareOrders,
    pickbareIds,
    geenVervoerderIds,
    aflAdresIds,
    aflGlnIds,
    prijsIds,
    aantalGeenVervoerder: geenVervoerderIds.size,
    aantalAflAdres: aflAdresIds.size,
    aantalAflGln: aflGlnIds.size,
    aantalPrijs: prijsIds.size,
    // Statussen zijn wederzijds exclusief → de som telt elke geblokkeerde order
    // exact één keer (voedt `alleenGeblokkeerd` in de knop).
    aantalGeblokkeerd: geenVervoerderIds.size + aflAdresIds.size + aflGlnIds.size + prijsIds.size,
    vervoerderResolutieLaadt,
  }
}
