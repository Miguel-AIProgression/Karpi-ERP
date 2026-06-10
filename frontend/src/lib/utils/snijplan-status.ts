// Single source of truth voor snijplan-/confectie-status (spiegelt DB-enums).
// Toets-anker: status-enums.contract.test.ts (TS ≡ snapshot) +
// supabase/migrations/344 (snapshot ≡ DB). Wijzig je een DB-enum, werk dan
// status-enums.golden.json + deze arrays + mig 344 samen bij.

export const SNIJPLAN_STATUSSEN = [
  'Wacht',
  'Gepland',
  'In productie',
  'Snijden',
  'Gesneden',
  'In confectie',
  'Gereed',
  'Ingepakt',
  'Geannuleerd',
] as const
export type SnijplanStatus = (typeof SNIJPLAN_STATUSSEN)[number]

export const CONFECTIE_STATUSSEN = [
  'Wacht op materiaal',
  'In productie',
  'Kwaliteitscontrole',
  'Gereed',
  'Geannuleerd',
] as const
export type ConfectieStatus = (typeof CONFECTIE_STATUSSEN)[number]

// === Semantische groepen (vervangen losse magic-string-arrays) ===

/** Snijplannen die nog gesneden moeten worden — voedt de snijplanning-pool. */
export const TE_SNIJDEN = ['Gepland', 'Snijden'] as const satisfies readonly SnijplanStatus[]

/** Rol fysiek bevroren: operator is bezig of klaar — niet opnieuw packen. */
export const ROL_FYSIEK_BEZET = ['Snijden', 'Gesneden'] as const satisfies readonly SnijplanStatus[]

/** Stukken die ingepakt mogen/kunnen worden (na snijden, door confectie heen). */
export const INPAK_KANDIDAAT = ['Gesneden', 'In confectie', 'Gereed'] as const satisfies readonly SnijplanStatus[]

/** Stukken die de confectie-pijplijn instromen. */
export const CONFECTIE_INSTROOM = ['Gesneden', 'In confectie'] as const satisfies readonly SnijplanStatus[]

/** Auto-planner bronpool: nog in te plannen (Gepland) + legacy Wacht-rijen (mig 069). */
export const PLANBAAR = ['Gepland', 'Wacht'] as const satisfies readonly SnijplanStatus[]

export const isSnijplanStatus = (s: string): s is SnijplanStatus =>
  (SNIJPLAN_STATUSSEN as readonly string[]).includes(s)
