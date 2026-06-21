// Pure split-/toewijzing-helpers voor de handmatige order-commit (order-form).
// Geëxtraheerd uit saveMutation.mutationFn zodat de geld-rekenende logica
// los testbaar is. Geen React, geen I/O.
import type { OrderRegelFormData } from '@/lib/supabase/queries/order-mutations'
import { round2 } from '@/lib/utils/formatters'

/** Minimaal contract: alles wat een 'bedrag' draagt kan toegewezen worden. */
interface MetBedrag {
  bedrag?: number | null
}

function totaal(regels: { bedrag?: number | null }[]): number {
  return regels.reduce((s, r) => s + (r.bedrag ?? 0), 0)
}

/**
 * Wijst de verzendregel toe aan de DUURSTE van twee sub-orders (issue #33).
 * Bij gelijke totalen gaat de verzendregel naar deelA (= standaard/directe deel),
 * consistent met het oorspronkelijke `totaalX > totaalY`-gedrag in order-form.
 * Pure functie: retourneert nieuwe arrays, muteert niets.
 */
export function wijsVerzendNaarDuurste<T extends MetBedrag>(
  deelA: T[],
  deelB: T[],
  shipping: T | null | undefined,
): { deelA: T[]; deelB: T[] } {
  if (!shipping) return { deelA, deelB }
  return totaal(deelB) > totaal(deelA)
    ? { deelA, deelB: [...deelB, shipping] }
    : { deelA: [...deelA, shipping], deelB }
}

/** Dekkings-uitsplitsing van één regel (spiegelt berekenRegelDekking-output). */
export interface RegelDekking {
  direct: number
  uitwisselbaar: number
  ioTekort: number
}

/**
 * Splitst één orderregel in een direct-leverbaar deel en een IO-deel op basis
 * van de dekking. Herberekent `bedrag` proportioneel (prijs × aantal × (1−korting),
 * afgerond op centen). Het IO-deel krijgt `id: undefined` (nieuwe regel) en lege
 * uitwisselbaar-keuzes. Geëxtraheerd uit order-form mutationFn (regels 487-513).
 */
export function splitRegelOpDekking(
  regel: OrderRegelFormData,
  dekking: RegelDekking,
): { directeRegel: OrderRegelFormData | null; ioRegel: OrderRegelFormData | null } {
  const directDeel = dekking.direct + dekking.uitwisselbaar

  if (dekking.ioTekort === 0) {
    return { directeRegel: regel, ioRegel: null }
  }
  if (directDeel === 0) {
    return { directeRegel: null, ioRegel: { ...regel, uitwisselbaar_keuzes: [] } }
  }

  const prijs = regel.prijs ?? 0
  const korting = (regel.korting_pct ?? 0) / 100
  const bedragVoor = (aantal: number) => round2(prijs * aantal * (1 - korting))

  return {
    directeRegel: {
      ...regel,
      orderaantal: directDeel,
      te_leveren: directDeel,
      bedrag: bedragVoor(directDeel),
    },
    ioRegel: {
      ...regel,
      id: undefined,
      orderaantal: dekking.ioTekort,
      te_leveren: dekking.ioTekort,
      uitwisselbaar_keuzes: [],
      bedrag: bedragVoor(dekking.ioTekort),
    },
  }
}
