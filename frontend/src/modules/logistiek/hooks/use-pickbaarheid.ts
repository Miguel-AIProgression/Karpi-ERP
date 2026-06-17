// usePickbaarheid — gedeelde pickbaarheid-/blokkade-resolutie voor de Pick &
// Ship start-/print-acties. Vóór 2026-06-17 stond deze logica duplicaat in
// `StartPickrondesButton` én `StartWeekButton` (de "consolidatie volgt na
// merge"-TODO in StartWeekButton). De nieuwe bulk-actiebalk wil exact dezelfde
// filtering, dus nu één bron.
//
// Een order is **pickbaar-en-startbaar** als:
//   - er geen lopende pickronde is (`!actieve_pickronde`) én
//   - alle regels pickbaar zijn (view `order_pickbaarheid`, mig 386) én
//   - de order niet geblokkeerd is door:
//       · geen vervoerder  — niet-afhaal-order met ≥1 regel bron='geen'
//         (server-side gespiegeld in start_pickronden, mig 373)
//       · afleveradres incompleet (mig 395) of prijs ontbreekt (mig 396)
//         (server-side _valideer_intake_gates — laat de hele batch falen als
//         één order erdoorheen glipt, daarom hier vóóraf eruit gefilterd).
//
// De vervoerder-resolutie komt uit de gedeelde batch (mig 401,
// `VervoerderResolutieProvider`); buiten een provider valt de hook terug op een
// eigen batch-call over de orders die niet door de context gedekt zijn.
import { useMemo } from 'react'
import {
  useVervoerderResolutieContext,
  useEffectieveVervoerderVoorOrders,
} from '../context/vervoerder-resolutie-context'
import type { PickShipOrder } from '@/modules/magazijn'

export interface PickbaarheidResultaat {
  /** Orders die direct een pickronde kunnen starten (pickbaar + niet geblokkeerd). */
  pickbareOrders: PickShipOrder[]
  /** Set met alle `pickbareOrders`-ids — handig voor snelle lookups. */
  pickbareIds: Set<number>
  /** Ids per blokkade-reden (alleen orders die anders pickbaar zouden zijn). */
  geenVervoerderIds: Set<number>
  aflAdresIds: Set<number>
  prijsIds: Set<number>
  /** Tellingen per blokkade-reden (= grootte van de sets hierboven). */
  aantalGeenVervoerder: number
  aantalAflAdres: number
  aantalPrijs: number
  aantalGeblokkeerd: number
  /** Laadt de vervoerder-resolutie nog? Voedt de disable van de knoppen. */
  vervoerderResolutieLaadt: boolean
}

function isPickbaar(o: PickShipOrder): boolean {
  if (o.actieve_pickronde) return false
  // Order-niveau-predicaat uit view `order_pickbaarheid` (mig 386) — niet
  // client-side herleiden uit regels. False dekt ook "geen regels".
  return o.alle_regels_pickbaar
}

export function usePickbaarheid(orders: PickShipOrder[]): PickbaarheidResultaat {
  const verzendOrders = useMemo(() => orders.filter((o) => !o.afhalen), [orders])
  const batchCtx = useVervoerderResolutieContext()
  const idsZonderContext = useMemo(
    () =>
      verzendOrders
        .map((o) => o.order_id)
        .filter((id) => !(batchCtx?.heeftOrder(id) ?? false)),
    [verzendOrders, batchCtx],
  )
  const fallbackQuery = useEffectieveVervoerderVoorOrders(idsZonderContext)

  const geenVervoerderIds = useMemo(() => {
    const set = new Set<number>()
    verzendOrders.forEach((o) => {
      if (!isPickbaar(o)) return
      const regels = batchCtx?.heeftOrder(o.order_id)
        ? batchCtx.getRegels(o.order_id)
        : fallbackQuery.data?.get(o.order_id)
      if (regels?.some((r) => r.bron === 'geen')) set.add(o.order_id)
    })
    return set
  }, [verzendOrders, batchCtx, fallbackQuery.data])

  const aflAdresIds = useMemo(() => {
    const set = new Set<number>()
    orders.forEach((o) => {
      if (isPickbaar(o) && o.afl_adres_incompleet_sinds) set.add(o.order_id)
    })
    return set
  }, [orders])

  const prijsIds = useMemo(() => {
    const set = new Set<number>()
    orders.forEach((o) => {
      if (isPickbaar(o) && o.prijs_ontbreekt_sinds) set.add(o.order_id)
    })
    return set
  }, [orders])

  const pickbareOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          isPickbaar(o) &&
          !geenVervoerderIds.has(o.order_id) &&
          !aflAdresIds.has(o.order_id) &&
          !prijsIds.has(o.order_id),
      ),
    [orders, geenVervoerderIds, aflAdresIds, prijsIds],
  )

  const pickbareIds = useMemo(
    () => new Set(pickbareOrders.map((o) => o.order_id)),
    [pickbareOrders],
  )

  const vervoerderResolutieLaadt =
    (batchCtx?.isLoading ?? false) || fallbackQuery.isLoading

  return {
    pickbareOrders,
    pickbareIds,
    geenVervoerderIds,
    aflAdresIds,
    prijsIds,
    aantalGeenVervoerder: geenVervoerderIds.size,
    aantalAflAdres: aflAdresIds.size,
    aantalPrijs: prijsIds.size,
    aantalGeblokkeerd: geenVervoerderIds.size + aflAdresIds.size + prijsIds.size,
    vervoerderResolutieLaadt,
  }
}
