// supabase/functions/_shared/btw.ts
// Eén bron-van-waarheid voor het effectieve BTW-percentage van een debiteur.
// Spiegelt de SQL-helper `effectief_btw_pct` (mig 371) — seam-patroon zoals
// _shared/debiteur-matcher.ts. De verlegd-vlag (intracommunautaire B2B-levering)
// wint altijd van het per-debiteur percentage; `btw_percentage` blijft het
// NL-tarief en wordt bij verlegd genegeerd.

export interface BtwDebiteur {
  btw_verlegd_intracom?: boolean | null
  btw_percentage?: number | string | null
}

export function isBtwVerlegd(deb: BtwDebiteur | null | undefined): boolean {
  return deb?.btw_verlegd_intracom === true
}

export function effectiefBtwPct(deb: BtwDebiteur | null | undefined): number {
  if (isBtwVerlegd(deb)) return 0
  if (deb?.btw_percentage == null) return 21
  // Number('') is 0, niet NaN — lege string mag nooit stil 0% opleveren.
  if (typeof deb.btw_percentage === 'string' && deb.btw_percentage.trim() === '') return 21
  const pct = Number(deb.btw_percentage)
  return Number.isFinite(pct) ? pct : 21
}
