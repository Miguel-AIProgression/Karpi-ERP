import type { User } from '@supabase/supabase-js'

/**
 * Bug-beheerder = Miguel. Single source of truth, gespiegeld in de SQL-helper
 * `is_bug_beheerder()` (mig 342). Wijzig je dit, wijzig dan ook die functie.
 */
export const BUG_BEHEERDER_EMAIL = 'miguel@aiprogression.nl'

/** TRUE als de ingelogde gebruiker de bug-beheerder is. */
export function isBugBeheerder(user: User | null | undefined): boolean {
  return user?.email?.toLowerCase() === BUG_BEHEERDER_EMAIL
}
