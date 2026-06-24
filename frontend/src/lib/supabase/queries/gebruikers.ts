// Query-laag voor gebruikersbeheer (inlog-accounts / auth.users).
//
// Alle acties lopen via de edge function `gebruikers-beheer` (service-role,
// zie supabase/functions/gebruikers-beheer/index.ts) — de frontend heeft enkel
// de publishable/anon-key en kan auth.users niet direct beheren.

import { supabase } from '@/lib/supabase/client'

export interface GebruikerRow {
  id: string
  email: string | null
  aangemaakt_op: string | null
  laatste_login: string | null
  email_bevestigd: boolean
  /** Uitgenodigd maar nog nooit ingelogd / wachtwoord gezet. */
  uitnodiging_openstaand: boolean
  geblokkeerd: boolean
}

/** Roept de edge function aan en normaliseert de foutafhandeling. */
async function roepBeheer<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('gebruikers-beheer', { body })
  if (error) {
    // Edge-functie geeft fouten als JSON-body terug; haal de boodschap eruit.
    let melding = error.message
    try {
      const ctx = (error as { context?: Response }).context
      const json = ctx ? await ctx.json() : null
      if (json?.error) melding = json.error
    } catch {
      // negeer — val terug op error.message
    }
    throw new Error(melding)
  }
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error))
  }
  return data as T
}

/** URL waar de invite-/recovery-link op landt (set-password-pagina). */
function redirectNaarWachtwoordPagina(): string {
  return `${window.location.origin}/wachtwoord-instellen`
}

export async function fetchGebruikers(): Promise<GebruikerRow[]> {
  const data = await roepBeheer<{ gebruikers: GebruikerRow[] }>({ actie: 'lijst' })
  return data.gebruikers ?? []
}

export async function uitnodigenGebruiker(email: string): Promise<void> {
  await roepBeheer({
    actie: 'uitnodigen',
    email,
    redirect_to: redirectNaarWachtwoordPagina(),
  })
}

export interface LoginLink {
  link: string
  /** 'invite' = nieuw account aangemaakt, 'recovery' = bestaand account. */
  type: 'invite' | 'recovery'
}

/** Optionele rol-toewijzing bij aanmaken (externe vertegenwoordiger, mig 489). */
export interface RolToewijzing {
  rol: 'vertegenwoordiger_extern'
  vertegenw_code: string
}

/**
 * Maakt een deelbare wachtwoord-link aan zónder mail te sturen — de operator
 * kopieert de link en stuurt 'm zelf naar de collega. Nieuw e-mailadres → de
 * gebruiker wordt aangemaakt (invite-link); bestaand → recovery-link. Optioneel
 * krijgt het account meteen een rol (app_metadata, alleen service-role).
 */
export async function genereerLoginLink(
  email: string,
  rolToewijzing?: RolToewijzing,
): Promise<LoginLink> {
  const data = await roepBeheer<{ link: string | null; type: 'invite' | 'recovery' }>({
    actie: 'genereer-link',
    email,
    redirect_to: redirectNaarWachtwoordPagina(),
    ...(rolToewijzing ?? {}),
  })
  if (!data.link) throw new Error('Geen link ontvangen van de server')
  return { link: data.link, type: data.type }
}

export async function wachtwoordResetGebruiker(email: string): Promise<void> {
  await roepBeheer({
    actie: 'wachtwoord-reset',
    email,
    redirect_to: redirectNaarWachtwoordPagina(),
  })
}

export async function blokkeerGebruiker(id: string, blokkeren: boolean): Promise<void> {
  await roepBeheer({ actie: blokkeren ? 'blokkeren' : 'deblokkeren', id })
}

export async function verwijderGebruiker(id: string): Promise<void> {
  await roepBeheer({ actie: 'verwijderen', id })
}
