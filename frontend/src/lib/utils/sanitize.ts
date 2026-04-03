/** Escape special PostgREST filter characters to prevent filter injection */
export function sanitizeSearch(input: string): string {
  return input
    .replace(/[\\%_]/g, '\\$&')  // escape SQL LIKE wildcards
    .replace(/[,.()"]/g, '')      // strip PostgREST filter syntax chars
    .trim()
}

/**
 * Past multi-term productzoekopdracht toe op een Supabase query (server-side, AND per term).
 * Korte getallen (kleurcodes zoals "16") worden niet in het artikelnummer gezocht
 * om false positives te voorkomen (bijv. "526100016" matcht anders ook op "16").
 */
export function applyProductSearch<T>(
  query: T & { or: (filter: string) => T },
  search: string
): T {
  const terms = search
    .split(/\s+/)
    .map(t => sanitizeSearch(t))
    .filter(Boolean)

  for (const term of terms) {
    const zoekInArtikelnr = !(/^\d{1,3}$/.test(term))
    const fields = zoekInArtikelnr
      ? `artikelnr.ilike.%${term}%,karpi_code.ilike.%${term}%,omschrijving.ilike.%${term}%,zoeksleutel.ilike.%${term}%`
      : `karpi_code.ilike.%${term}%,omschrijving.ilike.%${term}%,zoeksleutel.ilike.%${term}%`
    query = query.or(fields)
  }

  return query
}

/**
 * Client-side word-boundary filter.
 * Zorgt dat "16" niet matcht in "160 ROND" — alleen als heel woord.
 * Gebruik na server-side applyProductSearch om false positives te verwijderen.
 */
export function filterProductsWordBoundary<T extends {
  artikelnr: string
  karpi_code: string | null
  omschrijving: string
  zoeksleutel?: string | null
}>(items: T[], search: string): T[] {
  const terms = search.split(/\s+/).map(t => sanitizeSearch(t)).filter(Boolean)
  return items.filter(item =>
    terms.every(term => {
      if (/^\d{1,3}$/.test(term)) {
        const re = new RegExp(`\\b${term}\\b`, 'i')
        return re.test(item.omschrijving) || re.test(item.karpi_code ?? '') || re.test(item.zoeksleutel ?? '')
      }
      const t = term.toLowerCase()
      return item.omschrijving.toLowerCase().includes(t) ||
             (item.karpi_code ?? '').toLowerCase().includes(t) ||
             item.artikelnr.toLowerCase().includes(t) ||
             (item.zoeksleutel ?? '').toLowerCase().includes(t)
    })
  )
}
