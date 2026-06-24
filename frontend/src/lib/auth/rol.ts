import type { User } from '@supabase/supabase-js'

/**
 * Externe vertegenwoordiger-rol (mig 489). Read-only, ziet alleen eigen klanten.
 * Single source of truth, gespiegeld in de SQL-helpers `is_externe_vertegenwoordiger()`
 * + `huidige_vertegenw_code()`. De rol leeft in app_metadata (alléén service-role kan
 * dat zetten), niet user_metadata — de rep kan zijn scope dus niet zelf ophogen.
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

/** Menu-items die de rep mag zien (paden). Bron voor sidebar-filter. */
export const REP_TOEGESTANE_PADEN = ['/', '/orders', '/facturatie', '/klanten'] as const

/**
 * Mag de rep dit pad bereiken? Read-only: schrijf-subroutes (/nieuw, /bewerken)
 * worden geweerd — die landen op SECURITY DEFINER-RPC's die RLS omzeilen, dus de
 * UI is hier de enige rem (zie de "bekende grens" in het plan). Bug-meldingen
 * (eigen RLS) blijft bereikbaar via het gebruikersmenu.
 */
export function repMagPad(pathname: string): boolean {
  if (pathname === '/' || pathname === '/meldingen') return true
  if (pathname.endsWith('/nieuw') || pathname.endsWith('/bewerken')) return false
  return ['/orders', '/klanten', '/facturatie'].some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
}
