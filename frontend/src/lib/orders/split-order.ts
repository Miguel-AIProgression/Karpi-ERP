// Pure split-/toewijzing-helpers voor de handmatige order-commit (order-form).
// Geëxtraheerd uit saveMutation.mutationFn zodat de geld-rekenende logica
// los testbaar is. Geen React, geen I/O.

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
