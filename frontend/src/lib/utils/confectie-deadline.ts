/**
 * Confectie moet afgerond zijn op uiterlijk de **vrijdag van de week
 * voorafgaand aan de leverweek**. Voorbeeld: leverdatum dinsdag 2026-02-03
 * (week 6) → deadline vrijdag 2026-01-30 (week 5).
 *
 * Formule: leverdatum − (isoWeekdag + 2) dagen.
 *  - Ma (1) → -3 = vr vorige week ✓
 *  - Vr (5) → -7 = vr vorige week ✓
 *  - Zo (7) → -9 = vr vorige week ✓
 *
 * Eind van de werkdag (23:59:59) zodat eind van een blok dat nog op vrijdag
 * valt niet ten onrechte als te laat wordt gemarkeerd.
 */
export function confectieDeadline(leverdatum: string | null | undefined): Date | null {
  if (!leverdatum) return null
  const d = new Date(leverdatum + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  const js = d.getDay()
  const iso = js === 0 ? 7 : js
  d.setDate(d.getDate() - (iso + 2))
  d.setHours(23, 59, 59, 999)
  return d
}
