import type { User } from '@supabase/supabase-js'

/**
 * Externe vertegenwoordiger-rol (mig 490 e.v.). Read-only: de rep ziet ALLES
 * behalve systeembeheer (Instellingen/Gebruikers/Vertegenwoordigers), en mag
 * nergens muteren. Single source of truth, gespiegeld in de SQL-helper
 * `is_externe_vertegenwoordiger()`. De rol leeft in app_metadata (alléén
 * service-role kan dat zetten), niet user_metadata — de rep kan zijn scope dus
 * niet zelf ophogen.
 */
export const ROL_EXTERN_REP = 'vertegenwoordiger_extern'

export interface AppRol {
  rol: string | null
  vertegenwCode: string | null
}

export function leesAppRol(user: User | null | undefined): AppRol {
  const m = (user?.app_metadata ?? {}) as Record<string, unknown>
  return {
    rol: typeof m.rol === 'string' ? m.rol : null,
    vertegenwCode: typeof m.vertegenw_code === 'string' ? m.vertegenw_code : null,
  }
}

/** TRUE als de ingelogde gebruiker de externe vertegenwoordiger is (read-only). */
export function isExterneVertegenwoordiger(user: User | null | undefined): boolean {
  return leesAppRol(user).rol === ROL_EXTERN_REP
}

/**
 * Systeembeheer-paden die een externe vertegenwoordiger NIET mag zien/bereiken:
 * Instellingen (incl. alle subpagina's), Gebruikersbeheer en het beheer van
 * vertegenwoordigers zelf. Gedeelde denylist voor sidebar én route-guard.
 */
export const REP_SYSTEEMBEHEER_PADEN = ['/instellingen', '/vertegenwoordigers'] as const

/** TRUE als het pad onder systeembeheer valt (denylist voor de rep). */
export function isSysteembeheerPad(pathname: string): boolean {
  return REP_SYSTEEMBEHEER_PADEN.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
}

/**
 * Mag de rep dit pad bereiken? Denylist: alles mag (read-only) BEHALVE
 * systeembeheer en de schrijf-subroutes (/nieuw, /bewerken) — die landen op
 * SECURITY DEFINER-RPC's die RLS omzeilen, dus de UI is daar de enige rem.
 */
export function repMagPad(pathname: string): boolean {
  if (pathname.endsWith('/nieuw') || pathname.endsWith('/bewerken')) return false
  if (isSysteembeheerPad(pathname)) return false
  return true
}
