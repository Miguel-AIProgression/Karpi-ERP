// Deno-spiegel van frontend/src/lib/utils/snijplan-status.ts. Tot de Fase 3-
// shim Deno↔Vite koppelt, houden we beide handmatig synchroon; de waarden
// worden geankerd door supabase/migrations/342 (enum) en de Deno-test hiernaast.

export const SNIJPLAN_STATUSSEN = [
  'Wacht', 'Gepland', 'In productie', 'Snijden', 'Gesneden',
  'In confectie', 'Gereed', 'Ingepakt', 'Geannuleerd',
] as const
export type SnijplanStatus = (typeof SNIJPLAN_STATUSSEN)[number]

/** Rol fysiek bevroren: operator is bezig of klaar — niet opnieuw packen. */
export const ROL_FYSIEK_BEZET = ['Snijden', 'Gesneden'] as const satisfies readonly SnijplanStatus[]

/** Snijplannen die nog gesneden moeten worden — voedt de snijplanning-pool. */
export const TE_SNIJDEN = ['Gepland', 'Snijden'] as const satisfies readonly SnijplanStatus[]
