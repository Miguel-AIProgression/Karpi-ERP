/** Escape special PostgREST filter characters to prevent filter injection */
export function sanitizeSearch(input: string): string {
  return input
    .replace(/[\\%_]/g, '\\$&')  // escape SQL LIKE wildcards
    .replace(/[,.()"]/g, '')      // strip PostgREST filter syntax chars
    .trim()
}
