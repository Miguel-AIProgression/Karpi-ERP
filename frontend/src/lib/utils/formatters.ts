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

/** Format a date + time in NL: 07-06-2026 14:03 (of 14:03:25 met `seconds`). */
export function formatDateTime(
  date: string | null | undefined,
  opts?: { seconds?: boolean }
): string {
  if (!date) return '—'
  const d = new Date(date)
  const datum = d.toLocaleDateString('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  const tijd = d.toLocaleTimeString('nl-NL', {
    hour: '2-digit',
    minute: '2-digit',
    ...(opts?.seconds ? { second: '2-digit' } : {}),
  })
  return `${datum} ${tijd}`
}

/** Format a percentage: 21,5% */
export function formatPercentage(pct: number | null | undefined): string {
  if (pct == null) return '—'
  return `${pct.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}%`
}

/** Format a number with Dutch locale: 1.234. Pass `decimals` to fix fractie-digits (1.234,56). */
export function formatNumber(n: number | null | undefined, decimals?: number): string {
  if (n == null) return '—'
  if (decimals == null) return n.toLocaleString('nl-NL')
  return n.toLocaleString('nl-NL', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}
