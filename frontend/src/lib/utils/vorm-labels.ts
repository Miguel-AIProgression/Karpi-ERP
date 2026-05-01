/**
 * Centrale mapping van vorm-code → display label + kleur.
 * Wordt gebruikt door snijplanning, stickers, order-regels, etc.
 * Valt terug op de code zelf als de vorm onbekend is.
 *
 * Sync met maatwerk_vormen in DB (mig 179 / 181).
 */

interface VormDisplay {
  label: string
  kort: string
  bg: string
  text: string
  isRond: boolean
}

const BEKENDE_VORMEN: Record<string, VormDisplay> = {
  rechthoek:        { label: 'Rechthoek',              kort: 'RECHT',  bg: 'bg-slate-100',  text: 'text-slate-600',  isRond: false },
  rond:             { label: 'Rond',                   kort: 'ROND',   bg: 'bg-purple-100', text: 'text-purple-700', isRond: true  },
  ovaal:            { label: 'Ovaal',                  kort: 'OVAAL',  bg: 'bg-pink-100',   text: 'text-pink-700',   isRond: false },
  organisch_a:      { label: 'Organisch A',            kort: 'ORG-A',  bg: 'bg-amber-100',  text: 'text-amber-700',  isRond: false },
  organisch_b_sp:   { label: 'Organisch B gespiegeld', kort: 'ORG-B',  bg: 'bg-amber-100',  text: 'text-amber-700',  isRond: false },
  pebble:           { label: 'Pebble',                 kort: 'PEB',    bg: 'bg-teal-100',   text: 'text-teal-700',   isRond: false },
  ellips:           { label: 'Ellips',                 kort: 'ELL',    bg: 'bg-pink-100',   text: 'text-pink-600',   isRond: true  },
  afgeronde_hoeken: { label: 'Afgeronde hoeken',       kort: 'AFR',    bg: 'bg-slate-100',  text: 'text-slate-500',  isRond: false },
}

const FALLBACK: VormDisplay = {
  label: 'Onbekend', kort: '???', bg: 'bg-gray-100', text: 'text-gray-500', isRond: false,
}

export function getVormDisplay(vormCode: string | null | undefined): VormDisplay {
  if (!vormCode) return BEKENDE_VORMEN.rechthoek
  return BEKENDE_VORMEN[vormCode] ?? { ...FALLBACK, label: vormCode, kort: vormCode.toUpperCase().slice(0, 6) }
}

export function isRondeVorm(vormCode: string | null | undefined): boolean {
  return getVormDisplay(vormCode).isRond
}
