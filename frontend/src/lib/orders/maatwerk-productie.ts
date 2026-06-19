// Productie-fase van een maatwerk-orderregel — puur display-hulpmiddel.
//
// `order_regels.te_leveren` staat voor maatwerk meteen op het orderaantal: de
// allocator slaat maatwerk bewust over (reserveert niet op voorraad/inkoop),
// dus het getal wordt nooit herberekend. De échte voortgang zit in de
// snijplannen (Wacht → Gepland → Snijden → Gesneden → In confectie → Gereed →
// Ingepakt). Deze helper raakt `te_leveren` NIET aan; hij vat de
// snijplan-statussen samen tot één productie-fase voor de "Te leveren"-kolom op
// order-detail.
//
// De fase-volgorde spiegelt de rang uit de pickbaarheid-view (mig 386); de
// status-namen komen uit de gedeelde snijplan-status-module (één bron). Bij
// meerdere stuks op één regel telt de TRAAGSTE (minst gevorderde) fase — net
// als `slechtste_rang` in die view.

import type { SnijplanStatus } from '@/lib/utils/snijplan-status'

/** Samenvattende productie-fase van een maatwerk-orderregel. */
export type MaatwerkFase =
  | 'te_plannen'
  | 'op_snijplanning'
  | 'gesneden'
  | 'in_afwerking'
  | 'klaar_voor_verzending'

/** Status die een snijplan buiten beschouwing laat (telt niet mee). */
const GENEGEERD_STATUS: SnijplanStatus = 'Geannuleerd'

// Elke snijplan-status → fase. Een Record over SnijplanStatus zodat de compiler
// afdwingt dat een nieuwe enum-waarde hier expliciet wordt ingedeeld.
const FASE_VOOR_STATUS: Record<SnijplanStatus, MaatwerkFase | null> = {
  Wacht: 'te_plannen',
  Gepland: 'op_snijplanning',
  Snijden: 'op_snijplanning',
  Gesneden: 'gesneden',
  'In confectie': 'in_afwerking',
  'In productie': 'in_afwerking',
  Gereed: 'in_afwerking',
  Ingepakt: 'klaar_voor_verzending',
  Geannuleerd: null,
}

// Volgorde van traag → klaar. De index bepaalt welke fase "wint" als stukken in
// verschillende fases zitten: de laagste (traagste) telt voor de regel.
const FASE_VOLGORDE: MaatwerkFase[] = [
  'te_plannen',
  'op_snijplanning',
  'gesneden',
  'in_afwerking',
  'klaar_voor_verzending',
]

/** Label + badge-kleur per fase, voor de "Te leveren"-kolom. */
export const MAATWERK_FASE_PRESENTATIE: Record<
  MaatwerkFase,
  { label: string; bg: string; text: string }
> = {
  te_plannen: { label: 'Te plannen', bg: 'bg-slate-100', text: 'text-slate-600' },
  op_snijplanning: { label: 'Op de snijplanning', bg: 'bg-blue-100', text: 'text-blue-700' },
  gesneden: { label: 'Gesneden', bg: 'bg-amber-100', text: 'text-amber-700' },
  in_afwerking: { label: 'In afwerking', bg: 'bg-purple-100', text: 'text-purple-700' },
  klaar_voor_verzending: {
    label: 'Klaar voor verzending',
    bg: 'bg-emerald-100',
    text: 'text-emerald-700',
  },
}

interface SnijplanLike {
  status: string
}

/**
 * Bepaalt de samenvattende productie-fase van een maatwerk-orderregel uit de
 * snijplan-statussen. Geannuleerde snijplannen tellen niet mee. Bij stukken in
 * verschillende fases wint de traagste. Geen (niet-geannuleerde) snijplannen →
 * 'te_plannen' (besteld, productie nog niet geregistreerd).
 */
export function bepaalMaatwerkFase(
  snijplannen: readonly SnijplanLike[] | null | undefined,
): MaatwerkFase {
  const fases = (snijplannen ?? [])
    .filter((sp) => sp.status !== GENEGEERD_STATUS)
    .map((sp) => FASE_VOOR_STATUS[sp.status as SnijplanStatus] ?? null)
    .filter((f): f is MaatwerkFase => f !== null)

  if (fases.length === 0) return 'te_plannen'

  return fases.reduce((traagste, fase) =>
    FASE_VOLGORDE.indexOf(fase) < FASE_VOLGORDE.indexOf(traagste) ? fase : traagste,
  )
}

/**
 * Of een maatwerk-orderregel volledig geproduceerd (klaar voor levering) is.
 * Dunne afgeleide van {@link bepaalMaatwerkFase}: alle stuks ingepakt =
 * 'klaar_voor_verzending'. Een regel zonder snijplannen is niet klaar.
 */
export function isMaatwerkProductieKlaar(
  snijplannen: readonly SnijplanLike[] | null | undefined,
): boolean {
  if (!snijplannen || snijplannen.length === 0) return false
  return bepaalMaatwerkFase(snijplannen) === 'klaar_voor_verzending'
}
