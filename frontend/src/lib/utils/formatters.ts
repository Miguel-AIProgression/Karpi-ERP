/** Format a number as Euro currency: € 1.234,56 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return '—'
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
  }).format(amount)
}

/** Format a date string as DD-MM-YYYY */
export function formatDate(date: string | null | undefined): string {
  if (!date) return '—'
  return new Intl.DateTimeFormat('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(date))
}

/** Format a percentage: 21,5% */
export function formatPercentage(pct: number | null | undefined): string {
  if (pct == null) return '—'
  return `${pct.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}%`
}

/** Format a number with Dutch locale: 1.234 */
export function formatNumber(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('nl-NL')
}
