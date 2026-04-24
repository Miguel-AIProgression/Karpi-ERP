export interface RolSchatting {
  strekkende_m: number | null
  aantal_rollen: number | null
  breedte_cm: number | null
}

/**
 * Leidt strekkende meters + rollen-schatting af van een m²-waarde.
 *
 * - Als `breedte_cm` onbekend is → alles null (UI toont alleen m²).
 * - Als `typische_lengte_cm` onbekend is → strekkende meters bekend, rollen null.
 */
export function afleidRolSchatting(
  m2: number,
  breedte_cm: number | null | undefined,
  typische_lengte_cm: number | null | undefined,
): RolSchatting {
  if (!breedte_cm || breedte_cm <= 0 || !Number.isFinite(m2) || m2 <= 0) {
    return { strekkende_m: null, aantal_rollen: null, breedte_cm: breedte_cm ?? null }
  }
  const strekkende_m = m2 / (breedte_cm / 100)
  if (!typische_lengte_cm || typische_lengte_cm <= 0) {
    return { strekkende_m, aantal_rollen: null, breedte_cm }
  }
  const aantal_rollen = Math.max(1, Math.ceil(strekkende_m / (typische_lengte_cm / 100)))
  return { strekkende_m, aantal_rollen, breedte_cm }
}
