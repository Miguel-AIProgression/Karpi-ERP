import type { HaalbaarheidStatus } from './snij-haalbaarheid'

/** Kleurcodering groen/oranje/rood — gedeeld tussen de Haalbaarheid-pagina,
 *  order-detail en het orderoverzicht zodat dezelfde status overal hetzelfde
 *  oogt (zie `useSnijHaalbaarheid`). */
export const HAALBAARHEID_STATUS_STYLE: Record<HaalbaarheidStatus, { bg: string; text: string; label: string }> = {
  rood: { bg: 'bg-red-100', text: 'text-red-700', label: 'Niet haalbaar' },
  oranje: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Risico' },
  groen: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Oké' },
}
