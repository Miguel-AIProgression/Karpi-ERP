// Reststuk- en aanbreek-drempels voor de snijplanner — ÉÉN bron (ADR-0033).
//
// Deze waarden bepalen welke vrije rol-ruimte als herbruikbaar reststuk telt
// (kwalificatie-drempel) en wanneer een rol-rest nog "aangebroken" mag blijven.
// Ze zaten vroeger hand-gesynct in 4 bestanden met een "wijzig je dit, wijzig
// dan óók die 3 andere"-comment (klassieke shallow-spread). Nu leven ze hier
// éénmaal; consumers importeren cross-root:
//   - supabase/functions/_shared/guillotine-packing.ts   (packer-scoring)
//   - supabase/functions/_shared/compute-reststukken.ts   (backend reststuk-geometrie)
//   - frontend/src/modules/snijplanning/lib/compute-reststukken.ts (re-export-shim)
//
// De benchmark `scripts/vergelijk-snijalgoritmes.mjs` is een standalone Node-
// dev-tool (geen Deno/TS-loader) en houdt bewust een eigen kopie met verwijzing
// hierheen — geen productie-pad.
//
// Geen app_config-seam: anders dan de FIFO-parameters (ADR-0021, runtime
// tunebaar) zijn dit geometrie-drempels gekoppeld aan ADR-0025 (shape-bias);
// wijzigen = recompile/deploy. Bewuste keuze (Miguel 13-06-2026).

/**
 * Reststuk-kwalificatie: een vrije rechthoek telt pas als herbruikbaar reststuk
 * als de korte zijde ≥ RESTSTUK_MIN_SHORT én de lange zijde ≥ RESTSTUK_MIN_LONG
 * (cm). Smallere/kortere resten zijn afval. Drempel blijft 50×100 (ADR-0025).
 */
export const RESTSTUK_MIN_SHORT = 50
export const RESTSTUK_MIN_LONG = 100

/**
 * Minimale rol-rest (cm) om een rol nog als "aangebroken" terug te zetten.
 * Blijft er minder dan dit over na snijden, dan is de rol-rest verspild tenzij
 * die rest zelf als reststuk kwalificeert (≥ RESTSTUK_MIN_SHORT × RESTSTUK_MIN_LONG).
 * Gebruikt in de packer-scoring (dead-zone grens) én in de
 * reststuk-/aangebroken-/afval-classificatie van de rol-uitvoer-modal.
 */
export const AANGEBROKEN_MIN_LENGTE = 100

/**
 * Extra snijmarge (cm) voor ronde stukken: diameter + 5 cm in beide richtingen.
 * Gereserveerd — nog niet door het packer-algoritme geconsumeerd; bewaard hier
 * zodat de bedrijfsregel op één plek gedocumenteerd staat als rond-snijden
 * later wordt geïmplementeerd.
 */
export const ROND_SNIJ_MARGE = 5
